import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-07-31T00:00:00.000Z');

describe('PostgresGenerationJobRepository cancellation settlement', () => {
  it('queued page jobを残高→jobの順にlockしてcancel・page復元・refundを同一transactionで行う', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push(
      [jobRow({ status: 'queued' })],
      [personalBalanceRow()],
      [jobRow({ status: 'queued' })],
      [jobRow({
        status: 'cancelled',
        cancel_requested_at: new Date('2026-07-31T00:01:00.000Z'),
        cancel_requested_by: userId,
        cancelled_at: new Date('2026-07-31T00:01:00.000Z'),
        completed_at: new Date('2026-07-31T00:01:00.000Z'),
      })],
      [],
      [ledgerSummaryRow()],
      [],
      [],
    );
    const repository = new PostgresGenerationJobRepository(database);

    const result = await repository.requestCancellation(jobId, userId);

    expect(result?.status).toBe('cancelled');
    expect(database.transactionCount).toBe(1);
    const balanceLockIndex = database.queries.findIndex(
      (query) => query.text.includes('FROM credit_balances') && query.text.includes('FOR UPDATE'),
    );
    const jobLockIndex = database.queries.findIndex(
      (query) => query.text.includes('FROM generation_jobs') && query.text.includes('FOR UPDATE'),
    );
    expect(balanceLockIndex).toBeGreaterThanOrEqual(0);
    expect(jobLockIndex).toBeGreaterThan(balanceLockIndex);
    expect(database.queries.some((query) =>
      query.text.includes('UPDATE pages')
      && query.text.includes("status = 'generating'")
      && query.text.includes("params->>'previous_page_status'"),
    )).toBe(true);
    expect(database.queries.some((query) =>
      query.text.includes('INSERT INTO credit_ledger')
      && query.text.includes("'refund'"),
    )).toBe(true);
  });

  it('processing jobはcommit開始前だけ停止要求を保存し、その場では返金しない', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push(
      [jobRow({ status: 'processing', started_at: createdAt })],
      [jobRow({
        status: 'processing',
        started_at: createdAt,
        cancel_requested_at: new Date('2026-07-31T00:01:00.000Z'),
        cancel_requested_by: userId,
      })],
    );
    const repository = new PostgresGenerationJobRepository(database);

    const result = await repository.requestCancellation(jobId, userId);

    expect(result?.status).toBe('processing');
    expect(result?.cancelRequestedAt).not.toBeNull();
    expect(database.queries.some((query) => query.text.includes('INSERT INTO credit_ledger'))).toBe(false);
    expect(database.queries.some((query) => query.text.includes('commit_started_at IS NULL'))).toBe(true);
  });

  it('processing cancellationをworker checkpointでcancelledへ確定して残額だけ返金する', async () => {
    const requestedAt = new Date('2026-07-31T00:01:00.000Z');
    const database = new RecordingTransactionDatabase();
    database.responses.push(
      [jobRow({
        status: 'processing',
        started_at: createdAt,
        cancel_requested_at: requestedAt,
        cancel_requested_by: userId,
      })],
      [personalBalanceRow()],
      [jobRow({
        status: 'processing',
        started_at: createdAt,
        cancel_requested_at: requestedAt,
        cancel_requested_by: userId,
      })],
      [jobRow({
        status: 'cancelled',
        started_at: createdAt,
        cancel_requested_at: requestedAt,
        cancel_requested_by: userId,
        cancelled_at: new Date('2026-07-31T00:02:00.000Z'),
        completed_at: new Date('2026-07-31T00:02:00.000Z'),
      })],
      [],
      [ledgerSummaryRow({ refunded_amount: '1', refunded_purchased_delta: '1' })],
      [],
      [],
    );
    const repository = new PostgresGenerationJobRepository(database);

    await expect(repository.finalizeCancellation(jobId)).resolves.toBe(true);

    expect(database.transactionCount).toBe(1);
    const refundInsert = database.queries.find((query) =>
      query.text.includes('INSERT INTO credit_ledger') && query.text.includes("'refund'"),
    );
    expect(refundInsert?.values).toContain(2);
  });

  it('beginCommitはprocessingかつ停止要求なしの場合だけ保存開始を確定する', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([
      jobRow({
        status: 'processing',
        started_at: createdAt,
        commit_started_at: new Date('2026-07-31T00:03:00.000Z'),
      }),
    ]);
    const repository = new PostgresGenerationJobRepository(database);

    await expect(repository.beginCommit(jobId)).resolves.toBe(true);

    expect(database.queries[0]?.text).toContain('SET commit_started_at = NOW()');
    expect(database.queries[0]?.text).toContain("status = 'processing'");
    expect(database.queries[0]?.text).toContain('cancel_requested_at IS NULL');
  });

  it('法人jobは法人残高をlockし、同じjobの未返金分だけ返してauditを残す', async () => {
    const organizationId = '44444444-4444-4444-8444-444444444444';
    const database = new RecordingTransactionDatabase();
    const organizationJob = jobRow({
      organization_id: organizationId,
      job_type: 'entity_generate',
      params: { entity_id: '55555555-5555-4555-8555-555555555555' },
      status: 'queued',
    });
    database.responses.push(
      [organizationJob],
      [personalBalanceRow()],
      [organizationJob],
      [jobRow({
        ...organizationJob,
        status: 'cancelled',
        cancel_requested_at: new Date('2026-07-31T00:01:00.000Z'),
        cancel_requested_by: userId,
        cancelled_at: new Date('2026-07-31T00:01:00.000Z'),
        completed_at: new Date('2026-07-31T00:01:00.000Z'),
      })],
      [ledgerSummaryRow({ refunded_amount: '1', refunded_purchased_delta: '1' })],
      [],
      [],
      [],
      [],
    );
    const repository = new PostgresGenerationJobRepository(database);

    await expect(
      repository.requestCancellation(jobId, userId, organizationId),
    ).resolves.toMatchObject({ status: 'cancelled', organizationId });

    expect(database.queries.some((query) =>
      query.text.includes('FROM organization_credit_balances')
      && query.text.includes('FOR UPDATE'),
    )).toBe(true);
    expect(database.queries.some((query) => query.text.includes('FROM credit_balances'))).toBe(false);
    const refundInsert = database.queries.find((query) =>
      query.text.includes('INSERT INTO credit_ledger') && query.text.includes("'refund'"),
    );
    expect(refundInsert?.values).toContain(organizationId);
    expect(refundInsert?.values).toContain(2);
    expect(database.queries.some((query) => query.text.includes('INSERT INTO organization_audit_logs'))).toBe(true);
  });

  it('既にcancelledのjobをworkerが再確認してもrefundを重ねない', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([
      jobRow({
        status: 'cancelled',
        cancel_requested_at: new Date('2026-07-31T00:01:00.000Z'),
        cancel_requested_by: userId,
        cancelled_at: new Date('2026-07-31T00:02:00.000Z'),
        completed_at: new Date('2026-07-31T00:02:00.000Z'),
      }),
    ]);
    const repository = new PostgresGenerationJobRepository(database);

    await expect(repository.finalizeCancellation(jobId)).resolves.toBe(true);

    expect(database.transactionCount).toBe(0);
    expect(database.queries.some((query) => query.text.includes('INSERT INTO credit_ledger'))).toBe(false);
  });
});

class RecordingTransactionDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public readonly responses: QueryResultRow[][] = [];
  public transactionCount = 0;

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, values });
    const rows = (this.responses.shift() ?? []) as T[];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows,
    };
  }
}

function jobRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: jobId,
    user_id: userId,
    organization_id: null,
    job_type: 'page_generate',
    status: 'queued',
    generation_mode: 'standard',
    credit_cost: 3,
    params: {
      page_id: pageId,
      previous_page_status: 'designing',
      previous_generation_mode: null,
    },
    result: {},
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
    expires_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancelled_at: null,
    commit_started_at: null,
    ...overrides,
  };
}

function personalBalanceRow(): QueryResultRow {
  return {
    monthly_credits: 4,
    purchased_credits: 6,
    monthly_expires_at: new Date('2026-08-31T00:00:00.000Z'),
  };
}

function ledgerSummaryRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    consumed_amount: '-3',
    refunded_amount: '0',
    consumed_monthly_delta: '-1',
    consumed_purchased_delta: '-2',
    refunded_monthly_delta: '0',
    refunded_purchased_delta: '0',
    consumed_entry_count: '1',
    refunded_entry_count: '0',
    consumed_complete_entry_count: '1',
    refunded_complete_entry_count: '0',
    ...overrides,
  };
}
