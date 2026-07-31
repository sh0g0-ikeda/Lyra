import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPushNotificationOutboxRepository } from '../../../src/repositories/PushNotificationOutboxRepository.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const outboxId = '44444444-4444-4444-8444-444444444444';

describe('PostgresPushNotificationOutboxRepository', () => {
  it('terminal jobをlockしtoken snapshotまで同一transactionでenqueueする', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push(
      [],
      [jobRow('completed')],
      [outboxRow('completed')],
      [],
    );
    database.rowCounts.push(1, 1, 1, 2);
    const repository = new PostgresPushNotificationOutboxRepository(database);

    const result = await repository.enqueueForTerminalJob(jobId);

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.values).toEqual(['mobile-push-token-registry:v1']);
    expect(database.queries[1]?.text).toContain('FROM generation_jobs');
    expect(database.queries[1]?.text).toContain('FOR UPDATE');
    expect(database.queries[2]?.text).toContain('INSERT INTO mobile_push_notification_outbox');
    expect(database.queries[2]?.text).toContain('ON CONFLICT');
    expect(database.queries[2]?.text).toContain('generation_retry_count');
    expect(database.queries[3]?.text).toContain('INSERT INTO mobile_push_notification_deliveries');
    expect(database.queries[3]?.text).toContain('mobile_push_tokens.user_id = $2::uuid');
    expect(result).toEqual({
      outboxId,
      terminalStatus: 'completed',
      created: true,
      deliveryCount: 2,
    });
  });

  it.each(['queued', 'processing', 'cancelled'] as const)(
    '%s jobはoutboxを作らない',
    async (status) => {
      const database = new RecordingTransactionDatabase();
      database.responses.push([], [jobRow(status)]);
      const repository = new PostgresPushNotificationOutboxRepository(database);

      await expect(repository.enqueueForTerminalJob(jobId)).resolves.toBeNull();

      expect(database.queries).toHaveLength(2);
    },
  );

  it.each([
    [
      'cancel request',
      {
        cancel_requested_at: new Date('2026-07-31T00:01:00.000Z'),
        cancelled_at: null,
      },
    ],
    [
      'cancelled timestamp',
      {
        cancel_requested_at: null,
        cancelled_at: new Date('2026-07-31T00:02:00.000Z'),
      },
    ],
  ])('%sがあるfailed jobはoutboxを作らない', async (_label, cancellationMetadata) => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([], [jobRow('failed', cancellationMetadata)]);
    const repository = new PostgresPushNotificationOutboxRepository(database);

    await expect(repository.enqueueForTerminalJob(jobId)).resolves.toBeNull();

    expect(database.queries).toHaveLength(2);
    expect(database.queries[1]?.text).toContain('cancel_requested_at');
    expect(database.queries[1]?.text).toContain('cancelled_at');
  });

  it('同じterminal eventの再実行は既存outboxを返してdeliveryを増やさない', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push(
      [],
      [jobRow('failed')],
      [],
      [outboxRow('failed')],
    );
    const repository = new PostgresPushNotificationOutboxRepository(database);

    const result = await repository.enqueueForTerminalJob(jobId);

    expect(database.queries).toHaveLength(4);
    expect(database.queries[3]?.text).toContain('SELECT id, terminal_status');
    expect(database.queries[3]?.text).toContain('generation_retry_count');
    expect(database.queries[3]?.values).toEqual([jobId, 'failed', 0]);
    expect(database.queries[3]?.text).not.toContain('mobile_push_notification_deliveries');
    expect(result).toEqual({
      outboxId,
      terminalStatus: 'failed',
      created: false,
      deliveryCount: 0,
    });
  });

  it('unknown jobはoutboxを作らない', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([], []);
    const repository = new PostgresPushNotificationOutboxRepository(database);

    await expect(repository.enqueueForTerminalJob(jobId)).resolves.toBeNull();
  });
});

class RecordingTransactionDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public readonly responses: QueryResultRow[][] = [];
  public readonly rowCounts: number[] = [];
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
    const rowCount = this.rowCounts.shift() ?? rows.length;
    return {
      command: 'SELECT',
      rowCount,
      oid: 0,
      fields: [],
      rows,
    };
  }
}

function jobRow(
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled',
  overrides: QueryResultRow = {},
): QueryResultRow {
  return {
    id: jobId,
    user_id: userId,
    organization_id: organizationId,
    status,
    cancel_requested_at: null,
    cancelled_at: null,
    retry_count: 0,
    ...overrides,
  };
}

function outboxRow(terminalStatus: 'completed' | 'failed'): QueryResultRow {
  return {
    id: outboxId,
    terminal_status: terminalStatus,
  };
}
