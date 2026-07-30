import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('entity reference upload token migration 031', () => {
  it('single-use tokenの期限・MIME・size・owner keyをDB制約で固定する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '031_add_entity_reference_upload_tokens.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE entity_reference_upload_tokens');
    expect(sql).toContain('token_hash TEXT NOT NULL UNIQUE');
    expect(sql).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("purpose IN ('entity_reference_import')");
    expect(sql).toContain("mime_type IN ('image/jpeg', 'image/png', 'image/webp')");
    expect(sql).toContain('size_bytes > 0 AND size_bytes <= 5242880');
    expect(sql).toContain("s3_key LIKE ('tmp/' || user_id::text || '/entities/imports/%')");
    expect(sql).toContain("expires_at <= created_at + INTERVAL '10 minutes'");
    expect(sql).toContain('consumed_at <= expires_at');
    expect(sql).toContain('WHERE consumed_at IS NULL');
  });

  it('deployment invariantはtoken内容とentity scopeを検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('entity_reference_upload_tokens.contract'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('entity_reference_upload_tokens.entity_scope'))).toBe(true);
  });
});

class RecordingDatabase implements DatabaseClient {
  public readonly queries: string[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    return {
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    } as QueryResult<T>;
  }
}
