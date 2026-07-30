import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('generation cancellation contract migration 035', () => {
  it('既存列を再追加せず新規writeへcancellation contractを付ける', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '035_add_generation_cancellation_contract.sql'),
      'utf8',
    );

    expect(sql).not.toContain('ADD COLUMN');
    expect(sql).toContain('generation_jobs_cancel_request_metadata_check');
    expect(sql).toContain('generation_jobs_cancellation_state_check');
    expect(sql).toContain('cancel_requested_at IS NULL');
    expect(sql).toContain('cancel_requested_by IS NULL');
    expect(sql).toContain('(cancel_requested_at IS NULL OR commit_started_at IS NULL)');
    expect(sql).toContain("status = 'cancelled'");
    expect(sql).toContain('cancelled_at >= cancel_requested_at');
    expect(sql).toContain('completed_at >= cancelled_at');
    expect(sql.match(/NOT VALID/gu)).toHaveLength(2);
    expect(sql).not.toContain('VALIDATE CONSTRAINT');
  });

  it('refund・push・triggerをmigrationへ接続しない', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '035_add_generation_cancellation_contract.sql'),
      'utf8',
    );

    expect(sql).not.toContain('CREATE TRIGGER');
    expect(sql).not.toContain('credit_ledger');
    expect(sql).not.toContain('mobile_push_notification');
  });

  it('deployment invariantは既存cancellation矛盾を検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('generation_jobs.cancellation_contract'))).toBe(true);
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
