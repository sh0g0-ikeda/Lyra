import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('mobile push token registry migration 033', () => {
  it('token hash・暗号envelope・key ID・localeをDB制約で固定する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '033_add_mobile_push_token_registry.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE mobile_push_tokens');
    expect(sql).toContain("platform IN ('ios', 'android')");
    expect(sql).toContain("locale IN ('ja', 'en')");
    expect(sql).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("token_ciphertext ~ '^v1");
    expect(sql).toContain('char_length(token_ciphertext) BETWEEN 64 AND 16384');
    expect(sql).toContain("encryption_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'");
    expect(sql).toContain('UNIQUE (token_hash)');
    expect(sql).toContain('UNIQUE (user_id, installation_id)');
    expect(sql).toContain('updated_at >= created_at');
  });

  it('deployment invariantはpush token保護形式を検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_push_tokens.protection'))).toBe(true);
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
