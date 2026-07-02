import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageGenerationRecoveryRepository } from '../../../src/repositories/PageGenerationRecoveryRepository.js';

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
      rows: [stalePageJobRow()] as unknown as T[],
    };
  }
}

describe('PostgresPageGenerationRecoveryRepository', () => {
  it('processing と queued の stale page generation job を回収対象にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);
    const cutoff = new Date('2026-06-08T00:00:00.000Z');

    const jobs = await repository.listStaleProcessingJobs(cutoff, 100);

    expect(client.queryText).toContain("generation_jobs.status = 'processing'");
    expect(client.queryText).toContain("generation_jobs.status IN ('processing', 'queued')");
    expect(client.queryText).toContain("generation_jobs.result->>'progress_updated_at'");
    expect(client.queryText).toContain("THEN (generation_jobs.result->>'progress_updated_at')::timestamptz");
    expect(client.queryText).toContain('created_at < $1');
    expect(client.queryText).toContain('ELSE COALESCE(generation_jobs.started_at, generation_jobs.created_at)');
    expect(client.queryText).toContain('AND stale_at < $1');
    expect(client.queryText).toContain('ORDER BY stale_at ASC, created_at ASC');
    expect(client.queryText).toContain('LIMIT $2');
    expect(client.values).toEqual([cutoff, 100]);
    expect(jobs[0]).toMatchObject({
      jobId: 'job-1',
      pageId: 'page-1',
      staleAt: new Date('2026-06-07T23:30:00.000Z'),
    });
  });

  it('page 指定回収では user_id と page_id を条件に追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);
    const cutoff = new Date('2026-06-08T00:00:00.000Z');

    await repository.listStaleProcessingJobsForPage('user-1', 'page-1', cutoff, 50);

    expect(client.queryText).toContain('generation_jobs.user_id = $2');
    expect(client.queryText).toContain("generation_jobs.params->>'page_id' = $3");
    expect(client.queryText).toContain('LIMIT $5');
    expect(client.values).toEqual([cutoff, 'user-1', 'page-1', null, 50]);
  });

  it('page指定回収では組織ジョブにactive member条件を追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);
    const cutoff = new Date('2026-06-08T00:00:00.000Z');

    await repository.listStaleProcessingJobsForPage(
      'user-1',
      'page-1',
      cutoff,
      50,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queryText).toContain('FROM organization_members');
    expect(client.queryText).toContain('organization_members.user_id = $2');
    expect(client.queryText).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      cutoff,
      'user-1',
      'page-1',
      '11111111-1111-4111-8111-111111111111',
      50,
    ]);
  });

  it('failed だが refund 台帳がない page generation job を返金対象にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);

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

  it('page 指定の未返金 failed job 回収では user_id と page_id を条件に追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefundForPage('user-1', 'page-1', 50);

    expect(client.queryText).toContain('generation_jobs.user_id = $1');
    expect(client.queryText).toContain("generation_jobs.params->>'page_id' = $2");
    expect(client.queryText).toContain('LIMIT $4');
    expect(client.values).toEqual(['user-1', 'page-1', null, 50]);
  });

  it('page指定の未返金failed job回収では組織ジョブにactive member条件を追加する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageGenerationRecoveryRepository(client);

    await repository.listFailedJobsMissingRefundForPage(
      'user-1',
      'page-1',
      50,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queryText).toContain('FROM organization_members');
    expect(client.queryText).toContain('organization_members.user_id = $1');
    expect(client.queryText).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      'user-1',
      'page-1',
      '11111111-1111-4111-8111-111111111111',
      50,
    ]);
  });
});

function stalePageJobRow(): Record<string, unknown> {
  return {
    job_id: 'job-1',
    user_id: 'user-1',
    credit_cost: 1,
    page_id: 'page-1',
    previous_page_status: 'designing',
    previous_generation_mode: null,
    stale_at: new Date('2026-06-07T23:30:00.000Z'),
  };
}
