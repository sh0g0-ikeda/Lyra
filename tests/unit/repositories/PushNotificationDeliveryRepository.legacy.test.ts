import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPushNotificationDeliveryRepository } from '../../../src/repositories/PushNotificationDeliveryRepository.js';

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  public async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

/**
 * Legacy 2debe has a one-job outbox and no outbox retry/organization or user deletion columns;
 * authorization uses the old deletion request status, while invalid claims terminate as `dead`.
 */
describe('PostgresPushNotificationDeliveryRepository legacy schema profile', () => {
  it('旧schemaに無い列を参照せず無効leaseをdeadへ終端する', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresPushNotificationDeliveryRepository(
      database,
      database,
      'legacy_2debe_v1',
    );

    await repository.claimPending(1);
    await repository.isDeliveryCurrent(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );

    const sql = database.queries.join('\n');
    expect(sql).not.toContain('outbox.generation_retry_count');
    expect(sql).not.toContain('outbox.organization_id');
    expect(sql).not.toContain('users.account_deletion_started_at');
    expect(sql).not.toContain("status='canceled'");
    expect(sql).toContain("status='dead'");
    expect(sql).toContain("status IN ('processing', 'pending_external_action', 'completed')");
    expect(sql).toContain('FOR UPDATE OF deliveries SKIP LOCKED');
  });
});
