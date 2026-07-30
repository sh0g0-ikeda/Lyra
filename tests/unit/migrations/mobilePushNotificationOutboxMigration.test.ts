import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('mobile push notification outbox migration 034', () => {
  it('terminal snapshotとjob/status単位のidempotencyをDBで固定する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '034_add_mobile_push_notification_outbox.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE mobile_push_notification_outbox');
    expect(sql).toContain("terminal_status IN ('completed', 'failed')");
    expect(sql).toContain('UNIQUE (generation_job_id, terminal_status)');
    expect(sql).toContain('organization_id UUID REFERENCES organizations');
  });

  it('delivery lease状態を固定し既存generation job triggerは追加しない', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '034_add_mobile_push_notification_outbox.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE mobile_push_notification_deliveries');
    expect(sql).toContain("status IN ('pending', 'processing', 'sent', 'dead', 'canceled')");
    expect(sql).toContain('CONSTRAINT mobile_push_notification_deliveries_state_check');
    expect(sql).toContain('REFERENCES mobile_push_tokens(id) ON DELETE SET NULL');
    expect(sql).toContain("WHERE status IN ('pending', 'processing')");
    expect(sql).not.toContain('CREATE TRIGGER');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
  });

  it('deployment invariantはjob snapshotとtoken user scopeを検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_push_notification_outbox.job_scope'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('mobile_push_notification_deliveries.token_scope'))).toBe(true);
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
