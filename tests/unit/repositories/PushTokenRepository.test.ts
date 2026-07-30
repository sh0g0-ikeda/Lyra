import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPushTokenRepository } from '../../../src/repositories/PushTokenRepository.js';

const input = {
  userId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  platform: 'ios' as const,
  locale: 'ja' as const,
  tokenHash: 'a'.repeat(64),
  tokenCiphertext: `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(22)}`,
  encryptionKeyId: 'push-key:v1',
};

describe('PostgresPushTokenRepository', () => {
  it('registryをlockして旧登録削除とupsertを同一transactionで行う', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([], [], [registrationRow()]);
    const repository = new PostgresPushTokenRepository(database);

    const result = await repository.upsertForUser(input);

    expect(database.transactionCount).toBe(1);
    expect(database.queries).toHaveLength(3);
    expect(database.queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(database.queries[0]?.values).toEqual(['mobile-push-token-registry:v1']);
    expect(database.queries[1]?.text).toContain('DELETE FROM mobile_push_tokens');
    expect(database.queries[1]?.text).toContain('installation_id = $1::uuid');
    expect(database.queries[1]?.text).toContain('OR token_hash = $3');
    expect(database.queries[1]?.text).toContain('user_id IS DISTINCT FROM $2::uuid');
    expect(database.queries[2]?.text).toContain('ON CONFLICT (token_hash)');
    expect(database.queries[2]?.text).not.toContain('user_id = EXCLUDED.user_id');
    expect(database.queries[2]?.text).not.toContain('installation_id = EXCLUDED.installation_id');
    expect(database.queries[2]?.values).toEqual([
      input.userId,
      input.installationId,
      input.platform,
      input.locale,
      input.tokenHash,
      input.tokenCiphertext,
      input.encryptionKeyId,
    ]);
    expect(result).toMatchObject({
      userId: input.userId,
      installationId: input.installationId,
      platform: 'ios',
      locale: 'ja',
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('tokenCiphertext');
  });

  it('logout解除はuserとinstallationの両方でscopeする', async () => {
    const database = new RecordingTransactionDatabase();
    database.rowCounts.push(0, 1);
    const repository = new PostgresPushTokenRepository(database);

    await expect(repository.deleteForUser(input.userId, input.installationId)).resolves.toBe(true);

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.values).toEqual(['mobile-push-token-registry:v1']);
    expect(database.queries[1]?.text).toContain('WHERE user_id = $1::uuid');
    expect(database.queries[1]?.text).toContain('AND installation_id = $2::uuid');
    expect(database.queries[1]?.values).toEqual([input.userId, input.installationId]);
  });

  it('登録が存在しないlogout解除もfalseで冪等に完了する', async () => {
    const database = new RecordingTransactionDatabase();
    database.rowCounts.push(0, 0);
    const repository = new PostgresPushTokenRepository(database);

    await expect(repository.deleteForUser(input.userId, input.installationId)).resolves.toBe(false);
  });

  it('upsertがrowを返さない場合は未保存登録を公開しない', async () => {
    const database = new RecordingTransactionDatabase();
    database.responses.push([], [], []);
    const repository = new PostgresPushTokenRepository(database);

    await expect(repository.upsertForUser(input)).rejects.toThrow(
      'Push token registration was not persisted',
    );
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

function registrationRow(): QueryResultRow {
  return {
    user_id: input.userId,
    installation_id: input.installationId,
    platform: input.platform,
    locale: input.locale,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    updated_at: new Date('2026-07-31T00:00:00.000Z'),
  };
}
