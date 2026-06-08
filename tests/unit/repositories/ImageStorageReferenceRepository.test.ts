import { describe, expect, it } from 'vitest';
import { PostgresImageStorageReferenceRepository } from '../../../src/repositories/ImageStorageReferenceRepository.js';
import type { DatabaseClient } from '../../../src/lib/db.js';
import type { QueryResult, QueryResultRow } from 'pg';

class FakeDb implements DatabaseClient {
  public values: readonly unknown[] | undefined;

  public constructor(private readonly rows: Array<{ s3_key: string | null }>) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    _: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.values = values;
    return {
      command: 'SELECT',
      oid: 0,
      fields: [],
      rows: this.rows as unknown as T[],
      rowCount: this.rows.length,
    };
  }
}

describe('PostgresImageStorageReferenceRepository', () => {
  it('live page/reference/recent candidate の s3_key を重複なしで返す', async () => {
    const db = new FakeDb([
      { s3_key: 'session/user/pages/page/current.png' },
      { s3_key: 'saved/user/entities/entity/ref.png' },
      { s3_key: 'session/user/pages/page/current.png' },
      { s3_key: null },
    ]);
    const repository = new PostgresImageStorageReferenceRepository(db);

    const result = await repository.findProtectedImageS3Keys({ protectRecentCandidateHours: 48 });

    expect(db.values).toEqual([48]);
    expect(result).toEqual(new Set([
      'session/user/pages/page/current.png',
      'saved/user/entities/entity/ref.png',
    ]));
  });
});
