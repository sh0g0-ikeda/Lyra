import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient } from '../../../src/lib/db.js';

describe('episode export job migration 032', () => {
  it('artifactのowner・形式・size・24時間期限をDB制約で固定する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '032_add_episode_export_jobs.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE episode_export_jobs');
    expect(sql).toContain("format IN ('pdf', 'zip')");
    expect(sql).toContain('cardinality(page_ids) BETWEEN 1 AND 100');
    expect(sql).toContain("jsonb_typeof(page_snapshot) = 'array'");
    expect(sql).toContain("request_fingerprint ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("lower(filename) LIKE ('%.' || format)");
    expect(sql).toContain("'exports/' || COALESCE(organization_id::text, user_id::text)");
    expect(sql).toContain("artifact_mime_type = 'application/pdf'");
    expect(sql).toContain("artifact_mime_type = 'application/zip'");
    expect(sql).toContain('artifact_size_bytes BETWEEN 1 AND 134217728');
    expect(sql).toContain("expires_at <= created_at + INTERVAL '24 hours'");
    expect(sql).toContain('artifact_deleted_at >= expires_at');
  });

  it('job状態・idempotency・dispatch outboxをDB契約に含める', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '032_add_episode_export_jobs.sql'),
      'utf8',
    );

    expect(sql).toContain("status IN ('queued', 'processing', 'completed', 'failed', 'canceled')");
    expect(sql).toContain('CONSTRAINT episode_export_jobs_state_check');
    expect(sql).toContain('CREATE UNIQUE INDEX idx_episode_export_jobs_idempotency_scope');
    expect(sql).toContain('CREATE UNIQUE INDEX idx_episode_export_jobs_active_duplicate');
    expect(sql).toContain('CREATE TABLE episode_export_job_outbox');
    expect(sql).toContain('WHERE dispatched_at IS NULL');
  });

  it('deployment invariantはjob contractとepisode owner scopeを検査する', async () => {
    const database = new RecordingDatabase();

    const report = await checkDeploymentDataInvariants(database);

    expect(report.ok).toBe(true);
    expect(database.queries.some((sql) => sql.includes('episode_export_jobs.contract'))).toBe(true);
    expect(database.queries.some((sql) => sql.includes('episode_export_jobs.scope'))).toBe(true);
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
