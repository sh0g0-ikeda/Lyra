import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

const jobId = '33333333-3333-4333-8333-333333333333';
const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

class CancellationTransactionClient {
  public readonly queries: string[] = [];

  public async transaction<T>(work: (client: this) => Promise<T>): Promise<T> {
    return await work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    if (text.includes('FROM generation_jobs') && text.includes('SELECT *')) {
      return result(jobRow()) as QueryResult<T>;
    }
    if (text.includes("SET status = 'cancelled'")) {
      return result(jobRow({ status: 'cancelled', completed_at: new Date('2026-07-25T00:05:00.000Z') })) as QueryResult<T>;
    }
    if (text.includes('SUM(amount) FILTER')) {
      return result({
        consumed_amount: '-3', refunded_amount: '0', consumed_monthly_delta: '-2', consumed_purchased_delta: '-1',
        refunded_monthly_delta: '0', refunded_purchased_delta: '0', consumed_entry_count: '1', refunded_entry_count: '0',
        consumed_complete_entry_count: '1', refunded_complete_entry_count: '0',
      }) as QueryResult<T>;
    }
    if (text.includes('SELECT monthly_credits, purchased_credits')) {
      return result({ monthly_credits: 5, purchased_credits: 4, monthly_expires_at: null }) as QueryResult<T>;
    }
    return emptyResult<T>();
  }
}

describe('PostgresGenerationJobRepository processing cancellation', () => {
  it('cancellation checkpoint locks balance before job, terminalizes once, refunds once, and records organization evidence', async () => {
    const client = new CancellationTransactionClient();
    const repository = new PostgresGenerationJobRepository(client);

    await expect(repository.finalizeCancellationIfRequested(jobId)).resolves.toBe(true);

    const balanceLockIndex = client.queries.findIndex((sql) => sql.includes('FROM organization_credit_balances') && sql.includes('FOR UPDATE'));
    const jobLockIndex = client.queries.findIndex((sql) => sql.includes('FROM generation_jobs') && sql.includes('FOR UPDATE'));
    expect(balanceLockIndex).toBeGreaterThan(-1);
    expect(jobLockIndex).toBeGreaterThan(balanceLockIndex);
    expect(client.queries.filter((sql) => sql.includes("SET status = 'cancelled'"))).toHaveLength(1);
    expect(client.queries.filter((sql) => sql.includes('INSERT INTO credit_ledger'))).toHaveLength(1);
    expect(client.queries.some((sql) => sql.includes("'generation.canceled'"))).toBe(true);
    expect(client.queries.some((sql) => sql.includes('INSERT INTO organization_audit_logs'))).toBe(true);
  });

  it('does not terminalize or refund when cancellation has not been requested', async () => {
    const client = new CancellationTransactionClient();
    const repository = new PostgresGenerationJobRepository(client);
    const originalQuery = client.query.bind(client);
    client.query = async <T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> => {
      if (text.includes('FROM generation_jobs') && text.includes('SELECT *')) {
        return result(jobRow({ cancel_requested_at: null, cancel_requested_by: null })) as QueryResult<T>;
      }
      return await originalQuery<T>(text);
    };

    await expect(repository.finalizeCancellationIfRequested(jobId)).resolves.toBe(false);
    expect(client.queries.some((sql) => sql.includes("SET status = 'cancelled'"))).toBe(false);
    expect(client.queries.some((sql) => sql.includes('INSERT INTO credit_ledger'))).toBe(false);
  });

  it('all four execution repositories refuse completion and failure publication after a cancellation request', async () => {
    const files = [
      'PageGenerationExecutionRepository.ts',
      'EntityGenerationExecutionRepository.ts',
      'EpisodeStoryAutofillExecutionRepository.ts',
      'EpisodePageSkeletonExecutionRepository.ts',
    ];
    for (const file of files) {
      const source = await readFile(join(process.cwd(), 'src', 'repositories', file), 'utf8');
      expect(source).toMatch(/status = 'processing'[\s\S]{0,120}cancel_requested_at IS NULL/u);
      expect(source).toMatch(/status IN \('queued', 'processing'\)[\s\S]{0,120}cancel_requested_at IS NULL/u);
    }
  });
});

function result(row: Record<string, unknown>): QueryResult<QueryResultRow> {
  return { command: 'SELECT', rowCount: 1, oid: 0, fields: [], rows: [row] as QueryResultRow[] };
}

function emptyResult<T extends QueryResultRow>(): QueryResult<T> {
  return { command: 'OK', rowCount: 0, oid: 0, fields: [], rows: [] };
}

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: jobId, user_id: userId, organization_id: organizationId, job_type: 'page_generate', status: 'processing',
    generation_mode: 'standard', credit_cost: 3, params: {}, result: null, sqs_message_id: null,
    openai_request_id: null, error_message: null,
    cancel_requested_at: new Date('2026-07-25T00:01:00.000Z'), cancel_requested_by: userId,
    retry_count: 0, created_at: new Date('2026-07-25T00:00:00.000Z'), started_at: new Date('2026-07-25T00:00:30.000Z'),
    completed_at: null, expires_at: null, ...overrides,
  };
}
