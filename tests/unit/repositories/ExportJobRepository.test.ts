import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { ConflictError } from '../../../src/domain/errors/index.js';
import { PostgresExportJobRepository } from '../../../src/repositories/ExportJobRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';

class FakeDb {
  public readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public idempotencyRows: Record<string, unknown>[] = [];
  public async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, values });
    if (text.includes('SELECT * FROM export_jobs WHERE user_id')) return result(this.idempotencyRows) as unknown as QueryResult<T>;
    if (text.includes('FROM pages')) return result([{ page_id: pageId, page_number: 1, s3_key: `session/${userId}/pages/${pageId}/job.png`, mime_type: 'image/png' }]) as unknown as QueryResult<T>;
    if (text.includes('INSERT INTO export_jobs')) return result([row()]) as unknown as QueryResult<T>;
    if (text.includes('SELECT export_jobs.*')) return result([row()]) as unknown as QueryResult<T>;
    return result([]) as unknown as QueryResult<T>;
  }
  public async transaction<T>(work: (client: FakeDb) => Promise<T>): Promise<T> { return work(this); }
}

describe('PostgresExportJobRepository', () => {
  it('creates a page snapshot and durable outbox with parameterized tenant scope', async () => {
    const db = new FakeDb();
    const repository = new PostgresExportJobRepository(db, db);
    const created = await repository.createOrGet({ userId, organizationId: null, episodeId, pageIds: [pageId], format: 'pdf', filename: 'story.pdf', requestFingerprint: 'a'.repeat(64), idempotencyKey: 'abcdefgh-12345678', expiresAt: new Date('2026-07-26T00:00:00.000Z') });
    expect(created.created).toBe(true);
    expect(created.job.pageSnapshot).toEqual([{ pageId, pageNumber: 1, s3Key: `session/${userId}/pages/${pageId}/job.png`, mimeType: 'image/png' }]);
    const snapshotQuery = db.queries.find((query) => query.text.includes('FROM pages'));
    expect(snapshotQuery?.text).toContain('works.user_id = $4');
    expect(snapshotQuery?.text).toContain("organization_members.status = 'active'");
    expect(snapshotQuery?.values).toEqual([[pageId], episodeId, null, userId]);
    expect(db.queries.some((query) => query.text.includes('INSERT INTO export_job_outbox'))).toBe(true);
  });

  it('scopes status reads to user and active organization membership rather than job ID alone', async () => {
    const db = new FakeDb();
    const repository = new PostgresExportJobRepository(db, db);
    await repository.findForScope({ userId, organizationId: null, jobId: row().id as string });
    const query = db.queries.at(-1);
    expect(query?.text).toContain('export_jobs.user_id = $2');
    expect(query?.text).toContain("organization_members.status = 'active'");
    expect(query?.values).toEqual([row().id, userId, null]);
  });

  it('rejects an idempotency key reused with a different export fingerprint', async () => {
    const db = new FakeDb();
    db.idempotencyRows = [{ ...row(), request_fingerprint: 'b'.repeat(64), format: 'zip' }];
    const repository = new PostgresExportJobRepository(db, db);

    await expect(repository.createOrGet({ userId, organizationId: null, episodeId, pageIds: [pageId], format: 'pdf', filename: 'story.pdf', requestFingerprint: 'a'.repeat(64), idempotencyKey: 'abcdefgh-12345678', expiresAt: new Date('2026-07-26T00:00:00.000Z') }))
      .rejects.toEqual(new ConflictError('Idempotency-Key is already used for a different export request'));

    expect(db.queries.some((query) => query.text.includes('FROM pages'))).toBe(false);
  });
});

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> { return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows }; }
function row(): Record<string, unknown> { return { id: '44444444-4444-4444-8444-444444444444', user_id: userId, organization_id: null, episode_id: episodeId, format: 'pdf', filename: 'story.pdf', page_ids: [pageId], page_snapshot: [{ pageId, pageNumber: 1, s3Key: `session/${userId}/pages/${pageId}/job.png`, mimeType: 'image/png' }], request_fingerprint: 'a'.repeat(64), status: 'queued', progress_stage: 'queued', progress_percent: 0, artifact_s3_key: null, artifact_mime_type: null, artifact_size_bytes: null, error_code: null, error_message: null, created_at: new Date('2026-07-25T00:00:00.000Z'), started_at: null, completed_at: null, expires_at: new Date('2026-07-26T00:00:00.000Z') }; }
