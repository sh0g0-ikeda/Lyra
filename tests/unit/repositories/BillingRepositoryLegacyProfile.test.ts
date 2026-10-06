import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresBillingRepository } from '../../../src/repositories/BillingRepository.js';

class RecordingClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> { return work(this); }
  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = text.includes('SELECT') ? [{
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.invalid',
      stripe_customer_id: 'cus_legacy',
      plan_code: 'standard',
      account_deletion_started_at: null,
      account_deleted_at: null,
      legacy_account_deleted: true,
    } as unknown as T] : [];
    return { command: text.includes('UPDATE') ? 'UPDATE' : 'SELECT', rowCount: rows.length || 1, oid: 0, fields: [], rows };
  }
}

describe('PostgresBillingRepository legacy schema profile', () => {
  it('旧request statusをaccountDeletedへ投影しcustomerとplan更新を同じstatusで保護する', async () => {
    const client = new RecordingClient();
    const repository = new PostgresBillingRepository(client, client, 'legacy_2debe_v1');
    const profile = await repository.findBillingUserProfile('11111111-1111-4111-8111-111111111111');
    await repository.setStripeCustomerId('11111111-1111-4111-8111-111111111111', 'cus_next');
    await repository.updateUserPlanCode('11111111-1111-4111-8111-111111111111', 'premium', client);
    const sql = client.queries.join('\n');
    expect(profile?.accountDeleted).toBe(true);
    expect(sql).not.toContain('users.account_deletion_started_at');
    expect(sql).not.toContain('users.account_deleted_at');
    expect(sql.match(/status IN \('processing', 'pending_external_action', 'completed'\)/gu)?.length).toBe(3);
    expect(sql).not.toMatch(/status IN \([^)]*blocked/u);
  });
});
