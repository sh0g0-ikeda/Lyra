import { describe, expect, it } from 'vitest';
import { PostgresImageStorageReferenceRepository } from '../../../src/repositories/ImageStorageReferenceRepository.js';
import type { DatabaseClient } from '../../../src/lib/db.js';
import type { QueryResult, QueryResultRow } from 'pg';

class FakeDb implements DatabaseClient {
  public values: readonly unknown[] | undefined;
  public sql: string | undefined;

  public constructor(private readonly rows: Array<{ s3_key: string | null }>) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.sql = text;
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
  it('live page/reference/state と保存中snapshotの s3_key を重複なしで返す', async () => {
    const db = new FakeDb([
      { s3_key: 'session/user/pages/page/current.png' },
      { s3_key: 'saved/user/entities/entity/ref.png' },
      { s3_key: 'saved/user/entities/entity/state-ref.png' },
      { s3_key: 'saved/user/entities/entity/state-ref.png' },
      { s3_key: 'session/user/pages/page/current.png' },
      { s3_key: null },
    ]);
    const repository = new PostgresImageStorageReferenceRepository(db);

    const result = await repository.findProtectedImageS3Keys({ protectRecentCandidateHours: 48 });

    expect(db.values).toEqual([48]);
    expect(result).toEqual(new Set([
      'session/user/pages/page/current.png',
      'saved/user/entities/entity/ref.png',
      'saved/user/entities/entity/state-ref.png',
    ]));
    expect(db.sql).toContain('live_entity_state_reference_images');
    expect(db.sql).toContain('jsonb_typeof(entity_states.reference_image) = \'object\'');
    expect(db.sql).toContain('retained_input_snapshot_reference_images');
    expect(db.sql).toContain('retained_state_reference_copies');
    expect(db.sql).toContain("jsonb_typeof(result->'state_reference_copies') = 'array'");
    expect(db.sql).toContain("jsonb_typeof(generation_jobs.result->'input_snapshot'->'references') = 'array'");
    expect(db.sql).toContain("reference_image->>'s3Key'");
  });
});
