import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  checkPreMobileMigrationDataInvariants,
} from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

class RecordingDatabase implements DatabaseClient {
  public readonly queries: string[] = [];

  public constructor(private readonly violationSql: string | null = null) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = this.violationSql !== null && text.includes(this.violationSql)
      ? [{ id: 'preflight-violation' }]
      : [];

    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

describe('checkPreMobileMigrationDataInvariants', () => {
  it('schema 026だけを参照してmigration baselineと既存dataを検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkPreMobileMigrationDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(report.checkedCount).toBeGreaterThan(20);
    expect(
      database.queries.some(
        (query) =>
          query.includes('schema_migrations') &&
          query.includes('026_backfill_legacy_credit_consume_job_links.sql') &&
          !query.includes('027_add_account_deletion_requests.sql'),
      ),
    ).toBe(true);
    expect(database.queries.some((query) => query.includes('FROM pg_index'))).toBe(true);
    expect(database.queries.some((query) => query.includes('FROM generation_jobs'))).toBe(true);
    expect(database.queries.some((query) => query.includes('FROM credit_ledger'))).toBe(true);
    expect(
      database.queries.every(
        (query) =>
          !query.includes('mobile_store_purchases') &&
          !query.includes('mobile_store_purchase_events') &&
          !query.includes('mobile_store_event_key') &&
          !query.includes('account_deletion_requests') &&
          !query.includes('mobile_push_tokens'),
      ),
    ).toBe(true);
  });

  it('baseline不足をrelease blockerとして返す', async () => {
    const database = new RecordingDatabase('schema_migrations');

    const report = await checkPreMobileMigrationDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      name: 'schema_migrations.mobile_baseline_026',
      sampleIds: ['preflight-violation'],
    });
  });

  it('取消依頼時刻と依頼者の片側だけがあるjobをrelease blockerとして返す', async () => {
    const database = new RecordingDatabase(
      '(cancel_requested_at IS NULL) <> (cancel_requested_by IS NULL)',
    );

    const report = await checkPreMobileMigrationDataInvariants(database);

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      name: 'generation_jobs.cancel_request_metadata_pair',
      sampleIds: ['preflight-violation'],
    });
  });
});
