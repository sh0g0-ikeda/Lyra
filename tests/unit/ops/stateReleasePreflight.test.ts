import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import type { QueryResult, QueryResultRow } from 'pg';
import { checkStateReleasePreflight } from '../../../scripts/checkStateReleasePreflight.js';

// Design: fail closed on the exact migration set and active work; never emit
// content/credentials or mutate the database while checking release readiness.
describe('state release preflight', () => {
  it('期待するschemaと実行中jobの停止条件を読み取り専用で検査する', async () => {
    const sqls: string[] = [];
    const db: DatabaseClient = {
      async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
        sqls.push(sql);
        const rows = sql.includes('release.active_jobs') ? [{ id: 'active-job' }] : [];
        return { rows: rows as unknown as T[], rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 };
      },
    };
    const result = await checkStateReleasePreflight(db, 39);
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({ name: 'release.active_jobs', sampleIds: ['active-job'] });
    expect(sqls.every((sql) => /^\s*(SELECT|WITH)\b/u.test(sql))).toBe(true);
    expect(sqls.join('\n')).toContain('account_deletion_requests');
    expect(sqls.join('\n')).toContain('starting_entity_states');
  });

  it('履歴が不明なschemaでは列を参照する後続検査を停止する', async () => {
    let calls = 0;
    const db: DatabaseClient = {
      async query<T extends QueryResultRow>(): Promise<QueryResult<T>> {
        calls += 1;
        return { rows: [{ id: 'unknown.sql' }] as unknown as T[], rowCount: 1, command: 'SELECT', fields: [], oid: 0 };
      },
    };
    const report = await checkStateReleasePreflight(db, 39);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.name).toBe('schema_migrations.expected_39');
    expect(calls).toBe(1);
  });

  it('新しいschemaの形状検査はJSON型を確認してから配列を展開する', async () => {
    const sqls: string[] = [];
    const db: DatabaseClient = {
      async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
        sqls.push(sql);
        return { rows: [], rowCount: 0, command: 'SELECT', fields: [], oid: 0 };
      },
    };
    expect((await checkStateReleasePreflight(db, 41)).ok).toBe(true);
    expect(sqls.join('\n')).toContain('CASE WHEN jsonb_typeof(starting_entity_states)');
    expect(sqls.join('\n')).toContain('entity_states.variant_shape');
  });
});
