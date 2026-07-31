import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('account deletion request migration 027', () => {
  it('本人単位のcheckpoint・状態制約・processing claim pair・pending indexを追加する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '027_add_account_deletion_requests.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE account_deletion_requests');
    expect(sql).toContain('user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT');
    expect(sql).toContain("status IN ('blocked', 'processing', 'pending_external_action', 'completed')");
    expect(sql).toContain('retry_count >= 0');
    expect(sql).toContain('(processing_token IS NULL) = (processing_started_at IS NULL)');
    expect(sql).toContain('array_length(blocker_codes, 1) <= 16');
    expect(sql).toContain('CREATE INDEX idx_account_deletion_requests_pending');
    expect(sql).toContain("WHERE status IN ('processing', 'pending_external_action')");
  });

  it('migration 037はidentity tombstone・retry・削除開始後のwrite guardを追加する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '037_connect_account_deletion.sql'),
      'utf8',
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_deletion_started_at');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_deleted_at');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS identity_key');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS next_retry_at');
    expect(sql).toContain('char_length(identity_key) = 43');
    expect(sql).toContain('idx_account_deletion_requests_identity_key');
    expect(sql).toContain('reject_write_after_account_deletion');
    for (const table of [
      'works',
      'entities',
      'generation_jobs',
      'entity_reference_upload_tokens',
      'episode_export_jobs',
      'mobile_push_tokens',
    ]) {
      expect(sql).toContain(`ON ${table}`);
    }
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE ON generation_jobs',
    );
  });

  it('deployment invariantはstatus・retry・claim pairを検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('account_deletion_requests.status'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('account_deletion_requests.retry_count'))).toBe(true);
    expect(
      database.queries.some((sql) =>
        sql.includes('(processing_token IS NULL) <> (processing_started_at IS NULL)'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((sql) => sql.includes('account_deletion_requests.identity_key')),
    ).toBe(true);
    expect(
      database.queries.some((sql) => sql.includes('users.account_deletion_timestamps')),
    ).toBe(true);
    expect(
      database.queries.some((sql) =>
        sql.includes('account_deletion_requests.completed_scrub'),
      ),
    ).toBe(true);
    expect(
      database.queries.some((sql) =>
        sql.includes('account_deletion_requests.user_anchor'),
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
