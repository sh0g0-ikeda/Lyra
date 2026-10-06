import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  LegacyAccountDeletionWriteBlockedError,
  assertLegacyPersonalWriteAllowed,
} from '../../../src/repositories/LegacyAccountDeletionWriteFence.js';

class Client implements DatabaseClient {
  public readonly queries: string[] = [];
  public userExists = true;
  public status: string | null = null;

  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows: unknown[] = text.includes('FROM users')
      ? this.userExists ? [{ id: 'user-1' }] : []
      : this.status === null ? [] : [{ status: this.status }];
    return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows: rows as T[] };
  }
}

describe('LegacyAccountDeletionWriteFence', () => {
  it.each(['processing', 'pending_external_action', 'completed'])(
    '旧profileの個人writeはusersからrequestの順でlockし退会状態%sを403拒否する',
    async (status) => {
      const client = new Client();
      client.status = status;
      let observed: unknown;
      try {
        await assertLegacyPersonalWriteAllowed(client, { userId: 'user-1', organizationId: null });
      } catch (error: unknown) {
        observed = error;
      }
      expect(observed).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(client.queries).toHaveLength(2);
      expect(client.queries[0]).toContain('FROM users WHERE id = $1::uuid FOR UPDATE');
      expect(client.queries[1]).toContain('account_deletion_requests WHERE user_id = $1::uuid FOR UPDATE');
    },
  );

  it('旧profileの法人scopeはqueryせず個人blockedとrequest無しを許可する', async () => {
    const client = new Client();
    await assertLegacyPersonalWriteAllowed(client, { userId: 'user-1', organizationId: 'org-1' });
    expect(client.queries).toEqual([]);
    client.status = 'blocked';
    await assertLegacyPersonalWriteAllowed(client, { userId: 'user-1', organizationId: null });
  });

  it('旧profileの個人writeはusers行が無ければfail closedする', async () => {
    const client = new Client();
    client.userExists = false;
    let observed: unknown;
    try {
      await assertLegacyPersonalWriteAllowed(client, { userId: 'missing', organizationId: null });
    } catch (error: unknown) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(LegacyAccountDeletionWriteBlockedError);
    expect(client.queries).toHaveLength(1);
  });
});
