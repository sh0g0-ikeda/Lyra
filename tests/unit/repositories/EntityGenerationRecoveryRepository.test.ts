import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEntityGenerationRecoveryRepository } from '../../../src/repositories/EntityGenerationRecoveryRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queryText: string | null = null;
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queryText = text;
    this.values = values;

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [staleEntityJobRow()] as unknown as T[],
    };
  }
}

describe('PostgresEntityGenerationRecoveryRepository', () => {
  it('processing と queued の stale entity generation job を回収対象にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);
    const cutoff = new Date('2026-06-08T00:00:00.000Z');

    const jobs = await repository.listStaleProcessingJobs(cutoff, 100);

    expect(client.queryText).toContain("generation_jobs.status = 'processing'");
    expect(client.queryText).toContain("generation_jobs.status = 'queued'");
    expect(client.queryText).toContain('generation_jobs.created_at < $1');
    expect(client.queryText).toContain('COALESCE(generation_jobs.started_at, generation_jobs.created_at) AS stale_at');
    expect(client.queryText).toContain('ORDER BY stale_at ASC, generation_jobs.created_at ASC');
    expect(client.queryText).toContain('LIMIT $2');
    expect(client.values).toEqual([cutoff, 100]);
    expect(jobs[0]).toMatchObject({
      jobId: 'job-1',
      entityId: 'entity-1',
      staleAt: new Date('2026-06-07T23:30:00.000Z'),
    });
  });

  it('entity 指定回収では user_id と entity_id を条件に追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);
    const cutoff = new Date('2026-06-08T00:00:00.000Z');

    await repository.listStaleProcessingJobsForEntity('user-1', 'entity-1', cutoff, 50);

    expect(client.queryText).toContain('generation_jobs.user_id = $2');
    expect(client.queryText).toContain("generation_jobs.params->>'entity_id' = $3");
    expect(client.queryText).toContain('LIMIT $4');
    expect(client.values).toEqual([cutoff, 'user-1', 'entity-1', 50]);
  });

  it('failed だが refund 台帳がない entity generation job を返金対象にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefund(100);

    expect(client.queryText).toContain("generation_jobs.status = 'failed'");
    expect(client.queryText).toContain('generation_jobs.credit_cost > 0');
    expect(client.queryText).toContain('NOT EXISTS');
    expect(client.queryText).toContain('FROM credit_ledger');
    expect(client.queryText).toContain("credit_ledger.type = 'refund'");
    expect(client.queryText).toContain('ORDER BY generation_jobs.completed_at ASC NULLS FIRST, generation_jobs.created_at ASC');
    expect(client.queryText).toContain('LIMIT $1');
    expect(client.values).toEqual([100]);
  });

  it('entity 指定の未返金 failed job 回収では user_id と entity_id を条件に追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefundForEntity('user-1', 'entity-1', 50);

    expect(client.queryText).toContain('generation_jobs.user_id = $1');
    expect(client.queryText).toContain("generation_jobs.params->>'entity_id' = $2");
    expect(client.queryText).toContain('LIMIT $3');
    expect(client.values).toEqual(['user-1', 'entity-1', 50]);
  });
});

function staleEntityJobRow(): Record<string, unknown> {
  return {
    job_id: 'job-1',
    user_id: 'user-1',
    credit_cost: 1,
    entity_id: 'entity-1',
    stale_at: new Date('2026-06-07T23:30:00.000Z'),
  };
}
