import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresUserRepository } from '../../../src/repositories/UserRepository.js';

class RecordingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    return {
      command: text.includes('UPDATE') ? 'UPDATE' : 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        supabase_id: 'identity-1',
        email: 'user@example.invalid',
        display_name: null,
        plan_code: 'free',
      } as unknown as T],
    };
  }
}

/** Legacy status is authoritative: blocked remains usable; only active/final deletion denies normal use. */
describe('PostgresUserRepository legacy schema profile', () => {
  it('旧users列を参照せずrequest statusだけでloginとemail更新を保護する', async () => {
    const client = new RecordingClient();
    const repository = new PostgresUserRepository(client, 'legacy_2debe_v1');
    await repository.findBySupabaseId('identity-1');
    await repository.findByEmail('user@example.invalid');
    await repository.updateEmail('identity-1', 'next@example.invalid');
    const sql = client.queries.join('\n');
    expect(sql).not.toContain('account_deletion_started_at');
    expect(sql).not.toContain('account_deleted_at');
    expect(sql).toContain("status IN ('processing', 'pending_external_action', 'completed')");
    expect(sql).not.toMatch(/status IN \([^)]*blocked/u);
  });
});
