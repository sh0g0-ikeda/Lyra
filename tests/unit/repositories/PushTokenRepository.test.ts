import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  PostgresPushTokenRepository,
} from '../../../src/repositories/PushTokenRepository.js';

class RecordingDatabase implements DatabaseClient, TransactionRunner {
  public queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public responses: Array<{ rows: QueryResultRow[]; rowCount?: number }> = [];
  public transactionCount = 0;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, values });
    const response = this.responses.shift() ?? { rows: [] };
    return {
      command: 'SELECT',
      rowCount: response.rowCount ?? response.rows.length,
      oid: 0,
      fields: [],
      rows: response.rows as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }
}

const input = {
  userId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  platform: 'ios' as const,
  locale: 'en' as const,
  tokenCiphertext: 'encrypted:v1:opaque',
  tokenHash: 'hmac-sha256:0123456789abcdef0123456789abcdef',
  encryptionKeyId: 'push-key-v1',
};

describe('PostgresPushTokenRepository', () => {
  it('transaction lock後に同じinstallationの旧user/tokenを除きhashでupsertする', async () => {
    const database = new RecordingDatabase();
    database.responses.push(
      { rows: [] },
      { rows: [] },
      { rows: [buildRow()] },
    );
    const repository = new PostgresPushTokenRepository(database, database);

    await expect(repository.upsertForUser(input)).resolves.toEqual({
      userId: input.userId,
      installationId: input.installationId,
      platform: 'ios',
      locale: 'en',
      createdAt: new Date('2026-07-25T00:00:00.000Z'),
      updatedAt: new Date('2026-07-25T00:01:00.000Z'),
    });

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(database.queries[0]?.values).toContain(`push-installation:${input.installationId}`);
    expect(database.queries[0]?.values).not.toContain(
      `push-installation:${input.userId}:${input.installationId}`,
    );
    expect(database.queries[1]?.text).toContain('DELETE FROM mobile_push_tokens');
    expect(database.queries[1]?.text).toContain('installation_id = $1::uuid');
    expect(database.queries[1]?.text).toContain('user_id <> $2::uuid');
    expect(database.queries[1]?.text).toContain('token_hash <> $3');
    expect(database.queries[1]?.values).toEqual([
      input.installationId,
      input.userId,
      input.tokenHash,
    ]);
    expect(database.queries[2]?.text).toContain('INSERT INTO mobile_push_tokens');
    expect(database.queries[2]?.text).toContain('ON CONFLICT (token_hash)');
    expect(database.queries[2]?.text).not.toContain('native-provider-token');
    expect(database.queries[2]?.values).toEqual([
      input.userId,
      input.installationId,
      input.platform,
      input.locale,
      input.tokenHash,
      input.tokenCiphertext,
      input.encryptionKeyId,
    ]);
  });

  it('RETURNINGでciphertextとhashを読み出さない', async () => {
    const database = new RecordingDatabase();
    database.responses.push({ rows: [] }, { rows: [] }, { rows: [buildRow()] });
    const repository = new PostgresPushTokenRepository(database, database);

    await repository.upsertForUser(input);

    const returningSql = database.queries[2]?.text ?? '';
    const returningClause = returningSql.slice(returningSql.indexOf('RETURNING'));
    expect(returningClause).toContain('installation_id');
    expect(returningClause).not.toContain('token_ciphertext');
    expect(returningClause).not.toContain('token_hash');
  });

  it('削除はuser_idとinstallation_idの両方が一致する行だけを対象にする', async () => {
    const database = new RecordingDatabase();
    database.responses.push({ rows: [], rowCount: 0 });
    const repository = new PostgresPushTokenRepository(database, database);

    await expect(
      repository.deleteForUser(input.userId, input.installationId),
    ).resolves.toBe(false);
    expect(database.queries[0]?.text).toContain('DELETE FROM mobile_push_tokens');
    expect(database.queries[0]?.text).toContain('user_id = $1');
    expect(database.queries[0]?.text).toContain('installation_id = $2::uuid');
    expect(database.queries[0]?.values).toEqual([input.userId, input.installationId]);
  });
});

function buildRow(): QueryResultRow {
  return {
    user_id: input.userId,
    installation_id: input.installationId,
    platform: input.platform,
    locale: input.locale,
    created_at: new Date('2026-07-25T00:00:00.000Z'),
    updated_at: new Date('2026-07-25T00:01:00.000Z'),
  };
}
