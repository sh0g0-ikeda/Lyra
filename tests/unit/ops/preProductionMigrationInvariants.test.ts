import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  DEPLOYMENT_DATA_INVARIANT_QUERIES,
  SCHEMA_026_DEPLOYMENT_DATA_INVARIANT_QUERIES,
} from '../../../scripts/checkDeploymentDataInvariants.js';
import {
  PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES,
  checkPreProductionMigrationInvariants,
} from '../../../scripts/checkPreProductionMigrationInvariants.js';

describe('production migration preflight', () => {
  it('schema 026で実行できる検査だけを再利用する', () => {
    const names = SCHEMA_026_DEPLOYMENT_DATA_INVARIANT_QUERIES.map((query) => query.name);
    const sql = SCHEMA_026_DEPLOYMENT_DATA_INVARIANT_QUERIES.map((query) => query.sql).join('\n');

    expect(names).toContain('generation_jobs.cancelled_chargeable_under_refunded');
    expect(names).not.toContain('account_deletion_requests.status');
    expect(sql).not.toContain('mobile_store_event_key');
    expect(sql).not.toContain('account_deletion_started_at');
    expect(sql).toContain("'enterprise_a', 'enterprise_b', 'enterprise_c'");
    expect(sql).not.toContain('purchase_reversal');
  });

  it('migration 029後の検査はpurchase reversal契約を許可する', () => {
    const creditQueries = DEPLOYMENT_DATA_INVARIANT_QUERIES.filter((query) =>
      ['credit_ledger.type', 'credit_ledger.amount_sign'].includes(query.name),
    );

    expect(creditQueries).toHaveLength(2);
    expect(creditQueries.every((query) => query.sql.includes('purchase_reversal'))).toBe(true);
  });

  it('移行履歴と部分適用痕跡と稼働中ジョブと新制約互換性を停止条件にする', () => {
    const byName = new Map(
      PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES.map((query) => [query.name, query.sql]),
    );

    expect(byName.get('schema_migrations.expected_026')).toContain(
      '026_backfill_legacy_credit_consume_job_links.sql',
    );
    expect(byName.get('schema_migrations.post_026_artifacts')).toContain(
      'mobile_store_purchases',
    );
    expect(byName.get('generation_jobs.must_be_drained')).toContain(
      "status IN ('queued', 'processing')",
    );
    expect(byName.get('generation_jobs.cancellation_contract')).toContain(
      'cancel_requested_at',
    );
    expect(PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES.every((query) => query.sql.includes('$1'))).toBe(
      true,
    );
  });

  it('期待する履歴はrepositoryの001から026と完全一致する', async () => {
    const expectedSql = PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES.find(
      (query) => query.name === 'schema_migrations.expected_026',
    )?.sql;
    const migrationNames = (await readdir(join(process.cwd(), 'migrations')))
      .filter((filename) => filename.endsWith('.sql'))
      .sort()
      .slice(0, 26);

    expect(migrationNames).toHaveLength(26);
    for (const filename of migrationNames) {
      expect(expectedSql).toContain(`('${filename}')`);
    }
    expect(migrationNames.at(-1)).toBe('026_backfill_legacy_credit_consume_job_links.sql');
  });

  it('違反名とサンプルIDだけを返し書き込みを行わない', async () => {
    const executedSql: string[] = [];
    const database: DatabaseClient = {
      query: async <Row extends QueryResultRow = QueryResultRow>(
        sql: string,
      ): Promise<QueryResult<Row>> => {
        executedSql.push(sql);
        const rows = sql.includes('must_be_drained') ? [{ id: 'job-1' }] : [];
        return {
          command: 'SELECT',
          rowCount: rows.length,
          oid: 0,
          fields: [],
          rows: rows as unknown as Row[],
        };
      },
    };

    const report = await checkPreProductionMigrationInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      { name: 'generation_jobs.must_be_drained', sampleIds: ['job-1'] },
    ]);
    expect(executedSql.every((sql) => /^\s*(SELECT|WITH)\b/iu.test(sql))).toBe(true);
  });
});
