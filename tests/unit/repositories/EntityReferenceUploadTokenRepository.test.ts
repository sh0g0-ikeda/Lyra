import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { PostgresEntityReferenceUploadTokenRepository } from '../../../src/repositories/EntityReferenceUploadTokenRepository.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

class RecordingDatabase implements DatabaseClient {
  public queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public responses: QueryResultRow[][] = [];

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

describe('PostgresEntityReferenceUploadTokenRepository', () => {
  it('opaque token の hash と server-generated key だけを保存する', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow({ organization_id: null })]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    const token = await repository.create({
      tokenHash: 'sha256-hash',
      userId: 'user-1',
      organizationId: null,
      entityId: 'entity-1',
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: 8,
      s3Key: 'tmp/user-1/entities/imports/server-generated.png',
      expiresAt: new Date('2026-07-25T00:05:00.000Z'),
    });

    expect(token).toMatchObject({
      tokenHash: 'sha256-hash',
      userId: 'user-1',
      organizationId: null,
      entityId: 'entity-1',
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: 8,
    });
    expect(database.queries[0]?.text).toContain('INSERT INTO entity_reference_upload_tokens');
    expect(database.queries[0]?.text).toContain('token_hash');
    expect(database.queries[0]?.values).toEqual([
      'sha256-hash',
      'user-1',
      null,
      'entity-1',
      'entity_reference_import',
      'image/png',
      8,
      'tmp/user-1/entities/imports/server-generated.png',
      new Date('2026-07-25T00:05:00.000Z'),
    ]);
  });

  it('inspect は token を消費せず user/org/purpose/expiry/unused 条件を検証する', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow()]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    const token = await repository.inspect({
      tokenHash: 'sha256-hash',
      userId: 'user-1',
      organizationId: 'organization-1',
      purpose: 'entity_reference_import',
    });

    expect(token?.consumedAt).toBeNull();
    expect(database.queries[0]?.text).toContain('SELECT *');
    expect(database.queries[0]?.text).toContain('consumed_at IS NULL');
    expect(database.queries[0]?.text).toContain('expires_at > NOW()');
    expect(database.queries[0]?.text).not.toContain('UPDATE entity_reference_upload_tokens');
  });

  it('consume は user/org/purpose/expiry/unused 条件を一つの UPDATE で満たす token だけを返す', async () => {
    const database = new RecordingDatabase();
    database.responses.push([buildRow({ consumed_at: new Date('2026-07-25T00:01:00.000Z') })]);
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    const token = await repository.consume({
      tokenHash: 'sha256-hash',
      userId: 'user-1',
      organizationId: 'organization-1',
      purpose: 'entity_reference_import',
    });

    expect(token?.consumedAt).toEqual(new Date('2026-07-25T00:01:00.000Z'));
    expect(database.queries[0]?.text).toContain('UPDATE entity_reference_upload_tokens');
    expect(database.queries[0]?.text).toContain('consumed_at IS NULL');
    expect(database.queries[0]?.text).toContain('expires_at > NOW()');
    expect(database.queries[0]?.text).toContain('organization_id IS NOT DISTINCT FROM $3::uuid');
    expect(database.queries[0]?.text).toContain('RETURNING');
    expect(database.queries[0]?.values).toEqual([
      'sha256-hash',
      'user-1',
      'organization-1',
      'entity_reference_import',
    ]);
  });

  it('conditional UPDATE が一致しない場合は token を返さない', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresEntityReferenceUploadTokenRepository(database);

    await expect(
      repository.consume({
        tokenHash: 'replayed-or-expired',
        userId: 'other-user',
        organizationId: null,
        purpose: 'entity_reference_import',
      }),
    ).resolves.toBeNull();
  });
});

function buildRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    token_hash: 'sha256-hash',
    user_id: 'user-1',
    organization_id: 'organization-1',
    entity_id: 'entity-1',
    purpose: 'entity_reference_import',
    mime_type: 'image/png',
    size_bytes: 8,
    s3_key: 'tmp/user-1/entities/imports/server-generated.png',
    expires_at: new Date('2026-07-25T00:05:00.000Z'),
    consumed_at: null,
    created_at: new Date('2026-07-25T00:00:00.000Z'),
    ...overrides,
  };
}
