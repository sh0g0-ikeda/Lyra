import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresAccountDeletionRepository } from '../../../src/repositories/AccountDeletionRepository.js';

class RecordingClient implements DatabaseClient, TransactionRunner {
  public queryText = '';
  public params: readonly unknown[] = [];
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> { return work(this); }
  public async query<T extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    this.queryText = text;
    this.params = params ?? [];
    return { command: 'SELECT', rowCount: 1, oid: 0, fields: [], rows: [{ found: true } as unknown as T] };
  }
}

describe('PostgresAccountDeletionRepository legacy identity profile', () => {
  it('identity_keyを参照せずraw identity_idとstatusだけで再provisionを拒否する', async () => {
    const client = new RecordingClient();
    const repository = new PostgresAccountDeletionRepository(client, client, 'legacy_2debe_v1');
    const blocked = await repository.hasBlockedIdentity({ identityId: 'identity-1', identityKey: null });
    expect(blocked).toBe(true);
    expect(client.queryText).toContain('identity_id = $1');
    expect(client.queryText).not.toContain('identity_key');
    expect(client.queryText).toContain("status IN ('processing', 'pending_external_action', 'completed')");
    expect(client.queryText).not.toMatch(/status IN \([^)]*blocked/u);
    expect(client.params).toEqual(['identity-1']);
  });

  it('legacy profileでcanonical key専用aliasを誤使用した場合はquery前に明示拒否する', async () => {
    const client = new RecordingClient();
    const repository = new PostgresAccountDeletionRepository(client, client, 'legacy_2debe_v1');
    const error = await rejectionOf(repository.hasBlockedIdentityKey('canonical-key'));
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(client.queryText).toBe('');
  });
});

async function rejectionOf(operation: PromiseLike<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected operation to reject');
}
