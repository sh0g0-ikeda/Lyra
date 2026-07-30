import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEntityReferenceUploadTokenRepository } from '../../../src/repositories/EntityReferenceUploadTokenRepository.js';

const tokenHash = 'a'.repeat(64);

describe('PostgresEntityReferenceUploadTokenRepository', () => {
  it('opaque tokenのhashとserver-generated keyだけを保存する', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow({ organization_id: null })]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);
    const expiresAt = new Date('2026-07-25T00:05:00.000Z');

    const token = await repository.create({
      tokenHash,
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: null,
      entityId: '22222222-2222-4222-8222-222222222222',
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: 8,
      s3Key: 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/server-generated.png',
      expiresAt,
    });

    expect(token.tokenHash).toBe(tokenHash);
    expect(database.queries[0]?.text).toContain('INSERT INTO entity_reference_upload_tokens');
    expect(database.queries[0]?.values).toEqual([
      tokenHash,
      '11111111-1111-4111-8111-111111111111',
      null,
      '22222222-2222-4222-8222-222222222222',
      'entity_reference_import',
      'image/png',
      8,
      'tmp/11111111-1111-4111-8111-111111111111/entities/imports/server-generated.png',
      expiresAt,
    ]);
  });

  it('inspectはtokenを消費せずuser・organization・purpose・期限を検証する', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow()]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    await expect(repository.inspect(lookup())).resolves.toMatchObject({ consumedAt: null });

    expect(database.queries[0]?.text).toContain('SELECT *');
    expect(database.queries[0]?.text).toContain('organization_id IS NOT DISTINCT FROM $3::uuid');
    expect(database.queries[0]?.text).toContain('consumed_at IS NULL');
    expect(database.queries[0]?.text).toContain('expires_at > NOW()');
    expect(database.queries[0]?.text).not.toContain('UPDATE entity_reference_upload_tokens');
  });

  it('consumeは未使用かつ期限内の同一scope tokenだけを1つのUPDATEで消費する', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow({ consumed_at: new Date('2026-07-25T00:01:00.000Z') })]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    await expect(repository.consume(lookup())).resolves.toMatchObject({
      consumedAt: new Date('2026-07-25T00:01:00.000Z'),
    });

    expect(database.queries[0]?.text).toContain('UPDATE entity_reference_upload_tokens');
    expect(database.queries[0]?.text).toContain('consumed_at IS NULL');
    expect(database.queries[0]?.text).toContain('expires_at > NOW()');
    expect(database.queries[0]?.text).toContain('RETURNING *');
    expect(database.queries[0]?.values).toEqual([
      tokenHash,
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      'entity_reference_import',
    ]);
  });

  it('replay・期限切れ・scope不一致でconditional UPDATEが0件ならnullを返す', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    await expect(repository.consume(lookup())).resolves.toBeNull();
  });

  it('INSERTがrowを返さない場合は未保存tokenを公開しない', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    await expect(repository.create({
      tokenHash,
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: null,
      entityId: null,
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: 8,
      s3Key: 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/server-generated.png',
      expiresAt: new Date('2026-07-25T00:05:00.000Z'),
    })).rejects.toThrow('Entity reference upload token was not persisted');
  });
});

class RecordingDatabase implements DatabaseClient {
  public readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public readonly responses: QueryResultRow[][] = [];

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

function lookup(): {
  tokenHash: string;
  userId: string;
  organizationId: string;
  purpose: 'entity_reference_import';
} {
  return {
    tokenHash,
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: '33333333-3333-4333-8333-333333333333',
    purpose: 'entity_reference_import',
  };
}

function buildRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    token_hash: tokenHash,
    user_id: '11111111-1111-4111-8111-111111111111',
    organization_id: '33333333-3333-4333-8333-333333333333',
    entity_id: '22222222-2222-4222-8222-222222222222',
    purpose: 'entity_reference_import',
    mime_type: 'image/png',
    size_bytes: 8,
    s3_key: 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/server-generated.png',
    expires_at: new Date('2026-07-25T00:05:00.000Z'),
    consumed_at: null,
    created_at: new Date('2026-07-25T00:00:00.000Z'),
    ...overrides,
  };
}
