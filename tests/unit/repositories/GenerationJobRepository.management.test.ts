import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';

describe('PostgresGenerationJobRepository job management', () => {
  // MOB-STORY-006: the scoped job query is the authorization boundary; only its
  // job_id-scoped ledger aggregate may determine the client-visible settlement.
  it('derives settlement states from the authorized job ledger aggregate', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(queryResult(jobRow({ status: 'failed', credit_cost: 999, charged_credits: '0', refunded_credits: '0' })))
      .mockResolvedValueOnce(queryResult(jobRow({ status: 'processing', credit_cost: 999, charged_credits: '5', refunded_credits: '0' })))
      .mockResolvedValueOnce(queryResult(jobRow({ status: 'failed', credit_cost: 999, charged_credits: '5', refunded_credits: '0' })))
      .mockResolvedValueOnce(queryResult(jobRow({ status: 'failed', credit_cost: 999, charged_credits: '5', refunded_credits: '5' })))
      .mockResolvedValueOnce(queryResult(jobRow({ status: 'failed', credit_cost: 999, charged_credits: '5', refunded_credits: '2' })));
    const repository = new PostgresGenerationJobRepository({ query });
    const input = {
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: null,
      capability: 'view_work' as const,
      jobId: '33333333-3333-4333-8333-333333333333',
    };

    const settlements = await Promise.all([
      repository.findByIdForScope(input),
      repository.findByIdForScope(input),
      repository.findByIdForScope(input),
      repository.findByIdForScope(input),
      repository.findByIdForScope(input),
    ]);

    expect(settlements.map((job) => job?.creditSettlement)).toEqual([
      { chargedCredits: 0, refundedCredits: 0, netCredits: 0, status: 'not_charged' },
      { chargedCredits: 5, refundedCredits: 0, netCredits: 5, status: 'charged' },
      { chargedCredits: 5, refundedCredits: 0, netCredits: 5, status: 'refund_pending' },
      { chargedCredits: 5, refundedCredits: 5, netCredits: 0, status: 'refunded' },
      { chargedCredits: 5, refundedCredits: 2, netCredits: 3, status: 'partially_refunded' },
    ]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH scoped_job AS');
    expect(sql).toContain('credit_ledger.job_id = scoped_job.id');
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE credit_ledger\.type = 'consume'/);
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE credit_ledger\.type = 'refund'/);
    expect(sql).toContain('credit_ledger.organization_id IS NULL');
    expect(sql).not.toContain('description');
    expect(sql).not.toContain('provider');
  });
  it('一覧は active jobs を先頭にし、tenant と user history hide を SQL で絞る', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresGenerationJobRepository({ query });

    await (repository as unknown as {
      listForScope: (input: unknown) => Promise<unknown>;
    }).listForScope({
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      capability: 'view_work',
      limit: 25,
      cursor: null,
      statuses: [],
      jobTypes: [],
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("CASE WHEN generation_jobs.status IN ('queued', 'processing') THEN 0 ELSE 1 END");
    expect(sql).toContain('generation_job_history_hides');
    expect(sql).toContain('organization_members');
    expect(sql).toContain("'viewer'");
    expect(sql).toContain('ORDER BY active_rank ASC, created_at DESC, id DESC');
    expect(sql).toContain('settled_jobs AS');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('credit_ledger.job_id = visible_jobs.id');
  });

  it('処理中の停止依頼後もMobile必須のクレジット精算集計を返す', async () => {
    const client = new ProcessingCancellationClient();
    const repository = new PostgresGenerationJobRepository(client);

    const result = await repository.cancelForScope({
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: null,
      capability: 'generate',
      jobId: '33333333-3333-4333-8333-333333333333',
    });

    expect(result.kind).toBe('requested');
    if (result.kind !== 'requested') {
      throw new Error('expected a processing cancellation request');
    }
    expect(result.job.creditSettlement).toEqual({
      chargedCredits: 0,
      refundedCredits: 0,
      netCredits: 0,
      status: 'not_charged',
    });
  });
});

class ProcessingCancellationClient implements DatabaseClient, TransactionRunner {
  private cancellationRequested = false;

  public async transaction<T>(
    work: (transactionClient: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
  ): Promise<QueryResult<T>> {
    if (sql.includes('UPDATE generation_jobs') && sql.includes('cancel_requested_at')) {
      this.cancellationRequested = true;
      return queryResult(jobRow({
        status: 'processing',
        credit_cost: 0,
        cancel_requested_at: new Date('2026-07-25T00:05:00.000Z'),
        cancel_requested_by: '11111111-1111-4111-8111-111111111111',
      })) as QueryResult<T>;
    }
    if (sql.includes('WITH scoped_job AS')) {
      return queryResult(jobRow({
        status: 'processing',
        credit_cost: 0,
        charged_credits: '0',
        refunded_credits: '0',
        cancel_requested_at: this.cancellationRequested
          ? new Date('2026-07-25T00:05:00.000Z')
          : null,
        cancel_requested_by: this.cancellationRequested
          ? '11111111-1111-4111-8111-111111111111'
          : null,
      })) as QueryResult<T>;
    }
    return emptyQueryResult<T>();
  }
}

function queryResult(row: Record<string, unknown>): QueryResult<QueryResultRow> {
  return {
    command: 'SELECT',
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [row],
  };
}

function emptyQueryResult<T extends QueryResultRow>(): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };
}

function jobRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: '11111111-1111-4111-8111-111111111111',
    organization_id: null,
    job_type: 'page_generate',
    status: 'failed',
    generation_mode: 'standard',
    credit_cost: 3,
    params: {},
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    retry_count: 0,
    created_at: new Date('2026-07-25T00:00:00.000Z'),
    started_at: null,
    completed_at: new Date('2026-07-25T00:01:00.000Z'),
    expires_at: null,
    ...overrides,
  };
}
