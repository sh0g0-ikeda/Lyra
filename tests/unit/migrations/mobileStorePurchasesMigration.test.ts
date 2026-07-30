import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('mobile store purchase ledger migration 029', () => {
  it('個人購入・provider event・credit付与の冪等性をDB制約で保護する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '029_add_mobile_store_purchase_ledger.sql'),
      'utf8',
    );

    expect(sql).toContain('-- lyra:migration no-transaction');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mobile_store_purchases');
    expect(sql).toContain('user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT');
    expect(sql).not.toContain('organization_id');
    expect(sql).toContain('UNIQUE (store, external_purchase_key)');
    expect(sql).toContain('char_length(external_purchase_key) = 43');
    expect(sql).toContain('char_length(transaction_key) = 43');
    expect(sql).toMatch(/kind = 'subscription'\s+AND plan_code IS NOT NULL/u);
    expect(sql).toMatch(
      /kind = 'credit_pack'\s+AND plan_code IS NULL\s+AND credit_package_code IS NOT NULL/u,
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mobile_store_purchase_events');
    expect(sql).toContain('UNIQUE (store, event_key)');
    expect(sql).toContain('UNIQUE (store, transaction_key, operation)');
    expect(sql).toContain('char_length(event_key) = 43');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS mobile_store_event_key text');
    expect(sql).toContain('idx_credit_ledger_mobile_store_event_unique');
    expect(sql).toContain("'purchase_reversal'");
  });

  it('deployment invariantは購入状態・key形状・credit反転を検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_store_purchases.enum_contract'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_store_purchases.key_shape'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_store_purchases.credit_totals'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_store_purchase_events.contract'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('credit_ledger.mobile_store_event_key'))).toBe(true);
    expect(
      database.queries.some((sql) =>
        sql.includes("type IN ('consume', 'purchase_reversal') AND amount < 0"),
      ),
    ).toBe(true);
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
