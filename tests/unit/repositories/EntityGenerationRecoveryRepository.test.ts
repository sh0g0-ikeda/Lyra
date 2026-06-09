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

    const jobs = await repository.listStaleProcessingJobs(cutoff);

    expect(client.queryText).toContain("generation_jobs.status = 'processing'");
    expect(client.queryText).toContain("generation_jobs.status = 'queued'");
    expect(client.queryText).toContain('generation_jobs.created_at < $1');
    expect(client.queryText).toContain('COALESCE(generation_jobs.started_at, generation_jobs.created_at) AS stale_at');
    expect(client.values).toEqual([cutoff]);
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

    await repository.listStaleProcessingJobsForEntity('user-1', 'entity-1', cutoff);

    expect(client.queryText).toContain('generation_jobs.user_id = $2');
    expect(client.queryText).toContain("generation_jobs.params->>'entity_id' = $3");
    expect(client.values).toEqual([cutoff, 'user-1', 'entity-1']);
  });

  it('failed だが refund 台帳がない entity generation job を再返金対象にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefund();

    expect(client.queryText).toContain("generation_jobs.status = 'failed'");
    expect(client.queryText).toContain('generation_jobs.credit_cost > 0');
    expect(client.queryText).toContain('NOT EXISTS');
    expect(client.queryText).toContain('FROM credit_ledger');
    expect(client.queryText).toContain("credit_ledger.type = 'refund'");
  });

  it('entity 指定の未返金 failed job 回収では user_id と entity_id を条件に追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefundForEntity('user-1', 'entity-1');

    expect(client.queryText).toContain('generation_jobs.user_id = $1');
    expect(client.queryText).toContain("generation_jobs.params->>'entity_id' = $2");
    expect(client.values).toEqual(['user-1', 'entity-1']);
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
