import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageDeliveryAudience } from '../../src/domain/generation/ImageAccessPolicy.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import type { LegacyExportJob } from '../../src/legacy/export/LegacyEpisodeExportJob.js';
import { LegacyEpisodeExportJobRepository } from '../../src/legacy/export/LegacyEpisodeExportJobRepository.js';
import {
  LegacyEpisodeExportServiceAdapter,
  type LegacyExportAccessGuardPort,
  type LegacyExportDownloadSignerPort,
} from '../../src/legacy/export/LegacyEpisodeExportServiceAdapter.js';
import {
  LegacyEpisodeExportWorkerService,
  type LegacyExportArtifactBuilderPort,
  type LegacyExportStoragePort,
  type LegacyExportWorkerAccessGuardPort,
} from '../../src/legacy/export/LegacyEpisodeExportWorkerService.js';
import { LegacyExportDeletionBlocker } from '../../src/legacy/export/LegacyExportDeletionBlocker.js';
import type { LegacyExportJobQueuePort } from '../../src/legacy/export/LegacyExportJobQueue.js';
import { LegacyExportOutboxDispatchService } from '../../src/legacy/export/LegacyExportOutboxDispatchService.js';
import { LegacyExportArtifactCleanupService } from '../../src/legacy/export/LegacyExportArtifactCleanupService.js';
import { rejectionOf } from './asyncPostgresAssertions.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const legacyMigrations = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

/**
 * The profile intentionally writes the exact old relation and camelCase JSON snapshot.
 * It adds no lease, provenance column, or migration; authorization is a required port.
 */
describePostgres('legacy 2debe episode export compatibility', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  let repository: LegacyEpisodeExportJobRepository;
  const schema = `legacy_episode_export_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 10,
    });
    database = testDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: legacyMigrations,
    }));
    repository = new LegacyEpisodeExportJobRepository(database, database);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('current facadeが旧fingerprintとcamelCase snapshotを保ち、idempotency・scope・blockerを維持する', async () => {
    const fixture = await insertPersonalFixture(pool);
    const databaseNow = (await pool.query<{ now: Date }>('SELECT NOW() AS now')).rows[0]?.now;
    if (databaseNow === undefined) throw new Error('database clock is unavailable');
    const queue = new RecordingQueue();
    const guard = new RecordingGuard();
    const adapter = new LegacyEpisodeExportServiceAdapter(
      repository,
      queue,
      guard,
      new FixedSigner(),
      () => new Date(databaseNow.getTime()),
    );
    const request = {
      audience: 'mobile' as const,
      format: 'zip' as const,
      pageIds: [fixture.pageId],
      filename: 'chapter.zip',
      idempotencyKey: `request-${randomUUID()}`,
    };
    const first = await adapter.createExport(fixture.userId, fixture.episodeId, request, null);
    const second = await adapter.createExport(fixture.userId, fixture.episodeId, request, null);

    expect(second).toEqual(first);
    expect(queue.jobIds).toEqual([first.jobId]);
    expect(guard.created).toHaveLength(2);
    const raw = await pool.query<{
      page_snapshot: unknown;
      request_fingerprint: string;
      status: string;
    }>('SELECT page_snapshot, request_fingerprint, status FROM export_jobs WHERE id=$1', [first.jobId]);
    expect(raw.rows[0]).toMatchObject({
      page_snapshot: [{
        pageId: fixture.pageId,
        pageNumber: 1,
        s3Key: fixture.s3Key,
        mimeType: 'image/png',
      }],
      status: 'queued',
    });
    expect(raw.rows[0]?.request_fingerprint).toHaveLength(64);
    expect(await repository.findForScope({
      userId: randomUUID(),
      organizationId: null,
      jobId: first.jobId,
    })).toBeNull();
    expect(await new LegacyExportDeletionBlocker(database).countActivePersonalJobs(fixture.userId)).toBe(1);

    const organizationFixture = await insertPersonalFixture(pool);
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Legacy export organization',$2)", [
      organizationId,
      organizationFixture.userId,
    ]);
    await pool.query(
      "INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')",
      [organizationId, organizationFixture.userId],
    );
    await pool.query('UPDATE works SET organization_id=$2 WHERE id=$1', [organizationFixture.workId, organizationId]);
    const organizationExport = await adapter.createExport(
      organizationFixture.userId,
      organizationFixture.episodeId,
      {
        format: 'zip',
        pageIds: [organizationFixture.pageId],
        idempotencyKey: `request-${randomUUID()}`,
      },
      organizationId,
    );
    expect(await repository.findForScope({
      userId: organizationFixture.userId,
      organizationId,
      jobId: organizationExport.jobId,
    })).not.toBeNull();
    await pool.query(
      "UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2",
      [organizationId, organizationFixture.userId],
    );
    expect(await repository.findForScope({
      userId: organizationFixture.userId,
      organizationId,
      jobId: organizationExport.jobId,
    })).toBeNull();

    const conflict = await rejectionOf(adapter.createExport(fixture.userId, fixture.episodeId, {
      ...request,
      filename: 'different.zip',
    }, null));
    expect(conflict).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  }, 120_000);

  it('current facadeで作ったqueued jobを旧CAS workerが一度だけ処理しprocessingを再claimしない', async () => {
    const fixture = await insertPersonalFixture(pool);
    const adapter = new LegacyEpisodeExportServiceAdapter(
      repository,
      new RecordingQueue(),
      new RecordingGuard(),
      new FixedSigner(),
    );
    const created = await adapter.createExport(fixture.userId, fixture.episodeId, {
      format: 'zip',
      pageIds: [fixture.pageId],
      idempotencyKey: `request-${randomUUID()}`,
    }, null);
    const storage = new MemoryStorage();
    const worker = new LegacyEpisodeExportWorkerService(repository, storage, new AllowWorkerGuard(), () => new MemoryBuilder());
    const outcomes = await Promise.all([
      worker.processJob(created.jobId),
      worker.processJob(created.jobId),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['completed', 'skipped']);
    expect(storage.loaded).toEqual([fixture.s3Key]);
    expect(storage.stored).toHaveLength(1);
    expect((await pool.query(
      'SELECT status, artifact_s3_key, artifact_mime_type, artifact_size_bytes::int AS artifact_size_bytes FROM export_jobs WHERE id=$1',
      [created.jobId],
    )).rows[0]).toEqual({
      status: 'completed',
      artifact_s3_key: `legacy/${created.jobId}.zip`,
      artifact_mime_type: 'application/zip',
      artifact_size_bytes: 3,
    });
    expect(await repository.claim(created.jobId)).toBeNull();
  }, 120_000);

  it('同じidempotency requestの並行createはtransactionをabortせず同じ旧jobを返す', async () => {
    const fixture = await insertPersonalFixture(pool);
    const input = createRepositoryInput(fixture);
    const [first, second] = await Promise.all([
      repository.createOrGet(input),
      repository.createOrGet(input),
    ]);

    expect(first.job.id).toBe(second.job.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM export_jobs WHERE idempotency_key=$1',
      [input.idempotencyKey],
    )).rows[0]).toEqual({ count: 1 });
    await repository.markDispatched(first.job.id, 'concurrent-idempotency');
  }, 120_000);

  it('期限切れqueuedはclaimされずfailedへ一度だけ終端し、将来期限のclaimとは競合しない', async () => {
    const expiredFixture = await insertPersonalFixture(pool);
    const expired = await repository.createOrGet(createRepositoryInput(expiredFixture));
    await pool.query(
      "UPDATE export_jobs SET created_at=NOW()-INTERVAL '2 hours', expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1",
      [expired.job.id],
    );
    const [claimedExpired, expiredByWorker] = await Promise.all([
      repository.claim(expired.job.id),
      repository.expireQueued(expired.job.id),
    ]);
    expect(claimedExpired).toBeNull();
    expect(expiredByWorker).toBe(true);
    expect(await repository.findForWorker(expired.job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'EXPORT_EXPIRED',
    });

    const activeFixture = await insertPersonalFixture(pool);
    const active = await repository.createOrGet(createRepositoryInput(activeFixture));
    const [claimedActive, blockerCount] = await Promise.all([
      repository.claim(active.job.id),
      new LegacyExportDeletionBlocker(database).countActivePersonalJobs(activeFixture.userId),
    ]);
    expect(claimedActive?.status).toBe('processing');
    expect(blockerCount).toBe(1);
    expect(await repository.expireQueued(active.job.id)).toBe(false);
  }, 120_000);

  it('upload後のcancel競合はcompleteせず、登録済み未採用artifactだけを回収する', async () => {
    const fixture = await insertPersonalFixture(pool);
    const created = await repository.createOrGet(createRepositoryInput(fixture));
    const storage = new MemoryStorage();
    const worker = new LegacyEpisodeExportWorkerService(
      repository,
      storage,
      new CancelAtPublishGuard(pool),
      () => new MemoryBuilder(),
    );
    expect(await worker.processJob(created.job.id)).toMatchObject({
      status: 'skipped',
      reason: 'EXPORT_SUPERSEDED',
    });
    expect(storage.deleted).toEqual([`legacy/${created.job.id}.zip`]);
    expect((await pool.query(
      'SELECT status, artifact_s3_key, artifact_deleted_at IS NOT NULL AS deleted FROM export_jobs WHERE id=$1',
      [created.job.id],
    )).rows[0]).toEqual({
      status: 'canceled',
      artifact_s3_key: `legacy/${created.job.id}.zip`,
      deleted: true,
    });
  }, 120_000);

  it('期限直前のstore timeoutはprocessing inventoryを保持し、late upload前後のcleanupで削除しない', async () => {
    const fixture = await insertPersonalFixture(pool);
    const created = await repository.createOrGet(createRepositoryInput(fixture));
    await pool.query("UPDATE export_jobs SET expires_at=NOW()+INTERVAL '200 milliseconds' WHERE id=$1", [created.job.id]);
    const storage = new DeferredStoreStorage(600);
    const worker = new LegacyEpisodeExportWorkerService(
      repository,
      storage,
      new AllowWorkerGuard(),
      () => new MemoryBuilder(),
      { externalOperationTimeoutMs: 20 },
    );

    const outcome = await worker.processJob(created.job.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleanup = new LegacyExportArtifactCleanupService(repository, storage);
    const beforeLateUpload = await cleanup.cleanupExpiredArtifacts();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterLateUpload = await cleanup.cleanupExpiredArtifacts();
    const persisted = (await pool.query<{
      status: string;
      artifact_s3_key: string | null;
      artifact_deleted_at: Date | null;
      artifact_mime_type: string | null;
    }>(
      'SELECT status,artifact_s3_key,artifact_deleted_at,artifact_mime_type FROM export_jobs WHERE id=$1',
      [created.job.id],
    )).rows[0];

    expect(outcome).toMatchObject({ status: 'retry', reason: 'EXPORT_STORE_UNKNOWN' });
    expect(beforeLateUpload).toBe(0);
    expect(afterLateUpload).toBe(0);
    expect(storage.stored).toEqual([`legacy/${created.job.id}.zip`]);
    expect(storage.deleted).toEqual([]);
    expect(persisted).toEqual({
      status: 'processing',
      artifact_s3_key: `legacy/${created.job.id}.zip`,
      artifact_deleted_at: null,
      artifact_mime_type: null,
    });
  }, 120_000);

  it('storeの通常reject後にremote commitが遅延成立してもprocessing inventoryをcleanupしない', async () => {
    const fixture = await insertPersonalFixture(pool);
    const created = await repository.createOrGet(createRepositoryInput(fixture));
    await pool.query("UPDATE export_jobs SET expires_at=NOW()+INTERVAL '200 milliseconds' WHERE id=$1", [created.job.id]);
    const storage = new DisconnectedStoreStorage(600);
    const worker = new LegacyEpisodeExportWorkerService(
      repository,
      storage,
      new AllowWorkerGuard(),
      () => new MemoryBuilder(),
      { externalOperationTimeoutMs: 1_000 },
    );

    const outcome = await worker.processJob(created.job.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleanup = new LegacyExportArtifactCleanupService(repository, storage);
    const beforeRemoteCommit = await cleanup.cleanupExpiredArtifacts();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterRemoteCommit = await cleanup.cleanupExpiredArtifacts();
    const persisted = (await pool.query<{
      status: string;
      artifact_s3_key: string | null;
      artifact_deleted_at: Date | null;
      artifact_mime_type: string | null;
    }>(
      'SELECT status,artifact_s3_key,artifact_deleted_at,artifact_mime_type FROM export_jobs WHERE id=$1',
      [created.job.id],
    )).rows[0];

    expect(outcome).toMatchObject({ status: 'retry', reason: 'EXPORT_STORE_UNKNOWN' });
    expect(beforeRemoteCommit).toBe(0);
    expect(afterRemoteCommit).toBe(0);
    expect(storage.stored).toEqual([`legacy/${created.job.id}.zip`]);
    expect(storage.deleted).toEqual([]);
    expect(persisted).toEqual({
      status: 'processing',
      artifact_s3_key: `legacy/${created.job.id}.zip`,
      artifact_deleted_at: null,
      artifact_mime_type: null,
    });
  }, 120_000);

  it('失敗・outbox再送・期限切れartifact cleanupを旧relation上で完結する', async () => {
    const rollbackFixture = await insertPersonalFixture(pool);
    const rollbackInput = createRepositoryInput(rollbackFixture);
    await pool.query(`
      CREATE FUNCTION reject_legacy_export_outbox() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced outbox failure'; END $$
    `);
    await pool.query(`
      CREATE TRIGGER reject_legacy_export_outbox_trigger
      BEFORE INSERT ON export_job_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_legacy_export_outbox()
    `);
    expect(await rejectionOf(repository.createOrGet(rollbackInput))).toBeInstanceOf(Error);
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM export_jobs WHERE idempotency_key=$1',
      [rollbackInput.idempotencyKey],
    )).rows[0]).toEqual({ count: 0 });
    await pool.query('DROP TRIGGER reject_legacy_export_outbox_trigger ON export_job_outbox');
    await pool.query('DROP FUNCTION reject_legacy_export_outbox()');

    const failedFixture = await insertPersonalFixture(pool);
    const failed = await repository.createOrGet(createRepositoryInput(failedFixture));
    const failingWorker = new LegacyEpisodeExportWorkerService(
      repository,
      new FailingStorage(),
      new AllowWorkerGuard(),
      () => new MemoryBuilder(),
    );
    expect((await failingWorker.processJob(failed.job.id)).status).toBe('failed');
    expect((await repository.findForWorker(failed.job.id))?.errorCode).toBe('EXPORT_FAILED');

    const queuedFixture = await insertPersonalFixture(pool);
    const queued = await repository.createOrGet(createRepositoryInput(queuedFixture));
    const flaky = new FlakyQueue();
    const dispatcher = new LegacyExportOutboxDispatchService(repository, flaky);
    expect(await dispatcher.dispatchPending()).toEqual({ dispatched: 0, failed: 1 });
    expect(await dispatcher.dispatchPending()).toEqual({ dispatched: 1, failed: 0 });
    expect((await pool.query(
      'SELECT dispatched_at IS NOT NULL AS dispatched, dispatch_attempts FROM export_job_outbox WHERE export_job_id=$1',
      [queued.job.id],
    )).rows[0]).toEqual({ dispatched: true, dispatch_attempts: 2 });

    await pool.query(
      `UPDATE export_jobs
       SET status='completed', artifact_s3_key=$2, artifact_mime_type='application/zip',
           artifact_size_bytes=3, created_at=NOW()-INTERVAL '2 hours', expires_at=NOW()-INTERVAL '1 hour'
       WHERE id=$1`,
      [queued.job.id, `legacy/${queued.job.id}.zip`],
    );
    const storage = new MemoryStorage();
    expect(await new LegacyExportArtifactCleanupService(repository, storage).cleanupExpiredArtifacts()).toBe(1);
    expect(storage.deleted).toEqual([`legacy/${queued.job.id}.zip`]);
    expect((await pool.query(
      'SELECT artifact_deleted_at IS NOT NULL AS deleted FROM export_jobs WHERE id=$1',
      [queued.job.id],
    )).rows[0]).toEqual({ deleted: true });
  }, 120_000);
});

interface Fixture {
  userId: string;
  workId: string;
  episodeId: string;
  pageId: string;
  s3Key: string;
}

async function insertPersonalFixture(pool: Pool): Promise<Fixture> {
  const userId = randomUUID();
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  const s3Key = `generated/${pageId}.png`;
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [
    userId,
    userId,
    `${userId}@example.invalid`,
  ]);
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Legacy export fixture')", [workId, userId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
  await pool.query(
    "INSERT INTO pages(id,episode_id,page_number,status,generated_image) VALUES($1,$2,1,'editing',$3::jsonb)",
    [pageId, episodeId, JSON.stringify({ s3_key: s3Key })],
  );
  return { userId, workId, episodeId, pageId, s3Key };
}

function createRepositoryInput(fixture: Fixture): {
  userId: string;
  organizationId: null;
  episodeId: string;
  pageIds: string[];
  format: 'zip';
  filename: string;
  requestFingerprint: string;
  idempotencyKey: string;
  expiresAt: Date;
} {
  return {
    userId: fixture.userId,
    organizationId: null,
    episodeId: fixture.episodeId,
    pageIds: [fixture.pageId],
    format: 'zip',
    filename: 'legacy.zip',
    requestFingerprint: randomUUID().replaceAll('-', ''),
    idempotencyKey: `request-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

class RecordingGuard implements LegacyExportAccessGuardPort {
  public readonly created: Array<{ episodeId: string; pageIds: string[] }> = [];
  public async assertCreateAllowed(input: {
    episodeId: string;
    pageIds: string[];
  }): Promise<void> {
    this.created.push({ episodeId: input.episodeId, pageIds: input.pageIds });
  }
  public async assertDownloadAllowed(_input: {
    userId: string;
    organizationId: string | null;
    audience: ImageDeliveryAudience;
    job: LegacyExportJob;
  }): Promise<void> {}
}

class FixedSigner implements LegacyExportDownloadSignerPort {
  public async sign(): Promise<string> {
    return 'https://download.example.invalid/legacy';
  }
}

class RecordingQueue implements LegacyExportJobQueuePort {
  public readonly jobIds: string[] = [];
  public async enqueue({ jobId }: { jobId: string }): Promise<{ messageId: string }> {
    this.jobIds.push(jobId);
    return { messageId: `message-${this.jobIds.length}` };
  }
}

class FlakyQueue implements LegacyExportJobQueuePort {
  private calls = 0;
  public async enqueue({ jobId }: { jobId: string }): Promise<{ messageId: string }> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('queue temporarily unavailable');
    return { messageId: `message-${jobId}` };
  }
}

class MemoryBuilder implements LegacyExportArtifactBuilderPort {
  public async build(): Promise<{ data: Buffer; mimeType: 'application/zip'; extension: 'zip' }> {
    return { data: Buffer.from('zip'), mimeType: 'application/zip', extension: 'zip' };
  }
}

class MemoryStorage implements LegacyExportStoragePort {
  public readonly loaded: string[] = [];
  public readonly stored: string[] = [];
  public readonly deleted: string[] = [];
  public planArtifactTarget({ job }: { job: LegacyExportJob }): string { return `legacy/${job.id}.zip`; }
  public async loadPageImage({ s3Key }: { s3Key: string }): Promise<Buffer> {
    this.loaded.push(s3Key);
    return Buffer.from('image');
  }
  public async storeArtifact({ jobId }: { jobId: string }): Promise<void> {
    const s3Key = `legacy/${jobId}.zip`;
    this.stored.push(s3Key);
  }
  public async deleteArtifact(s3Key: string): Promise<void> {
    this.deleted.push(s3Key);
  }
}

class FailingStorage extends MemoryStorage {
  public override async loadPageImage(): Promise<Buffer> {
    throw new Error('storage unavailable');
  }
}

class DeferredStoreStorage extends MemoryStorage {
  public constructor(private readonly delayMs: number) { super(); }
  public override async storeArtifact({ jobId }: { jobId: string }): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    await super.storeArtifact({ jobId });
  }
}

class DisconnectedStoreStorage extends MemoryStorage {
  public constructor(private readonly remoteCommitDelayMs: number) { super(); }
  public override async storeArtifact({ jobId }: { jobId: string }): Promise<void> {
    setTimeout(() => { this.stored.push(`legacy/${jobId}.zip`); }, this.remoteCommitDelayMs);
    throw new Error('storage SDK disconnected before receiving the PUT response');
  }
}

class AllowWorkerGuard implements LegacyExportWorkerAccessGuardPort {
  public async assertLoadAllowed(): Promise<void> {}
  public async assertPublishAllowed(): Promise<void> {}
}

class CancelAtPublishGuard implements LegacyExportWorkerAccessGuardPort {
  public constructor(private readonly pool: Pool) {}
  public async assertLoadAllowed(): Promise<void> {}
  public async assertPublishAllowed({ job }: { job: LegacyExportJob }): Promise<void> {
    await this.pool.query("UPDATE export_jobs SET status='canceled', updated_at=NOW() WHERE id=$1 AND status='processing'", [job.id]);
  }
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> => pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(
            text: string,
            values?: readonly unknown[],
          ): Promise<QueryResult<Row>> => client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
