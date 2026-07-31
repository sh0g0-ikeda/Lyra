import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  ConflictError,
  ValidationError,
} from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  PostgresEpisodeExportJobRepository,
} from '../../../src/repositories/EpisodeExportJobRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const pageId = '55555555-5555-4555-8555-555555555555';
const leaseToken = '66666666-6666-4666-8666-666666666666';
const fingerprint = 'a'.repeat(64);

describe('PostgresEpisodeExportJobRepository', () => {
  it('認可済みpage snapshot・job・outboxを同じtransactionへ保存する', async () => {
    const database = new ScriptedDatabase([
      [],
      [snapshotRow()],
      [jobRow()],
      [],
    ]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.createOrGet(createInput())).resolves.toMatchObject({
      created: true,
      job: { id: jobId, pageSnapshot: [{ pageId }] },
    });

    expect(database.transactionCalls).toBe(1);
    expect(database.queries[1]).toContain('FROM pages');
    expect(database.queries[1]).toContain('pages.episode_id = $2::uuid');
    expect(database.queries[1]).toContain('works.user_id = $4::uuid');
    expect(database.queries[1]).toContain("organization_members.status = 'active'");
    expect(database.queries[1]).toContain('FOR SHARE OF pages');
    expect(database.queries[2]).toContain('INSERT INTO episode_export_jobs');
    expect(database.queries[2]).toContain('ON CONFLICT DO NOTHING');
    expect(database.queries[3]).toContain('INSERT INTO episode_export_job_outbox');
  });

  it('同じscope・idempotency key・fingerprintは既存jobを返しoutboxを増やさない', async () => {
    const database = new ScriptedDatabase([[jobRow()]]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.createOrGet(createInput())).resolves.toMatchObject({
      created: false,
      job: { id: jobId },
    });

    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toContain('idempotency_key = $3');
    expect(database.queries.some((sql) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('同じidempotency keyを異なるrequestに再利用すると拒否する', async () => {
    const database = new ScriptedDatabase([
      [jobRow({ request_fingerprint: 'b'.repeat(64) })],
    ]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.createOrGet(createInput())).rejects.toEqual(
      new ConflictError('Idempotency-Key is already used for a different export request'),
    );
  });

  it('transaction runnerがない状態で作成を開始しない', async () => {
    const database = new ScriptedDatabase([]);
    const repository = new PostgresEpisodeExportJobRepository(database);

    await expect(repository.createOrGet(createInput())).rejects.toEqual(
      new ConfigurationError('Episode export creation requires transaction support'),
    );
    expect(database.transactionCalls).toBe(0);
    expect(database.queries).toHaveLength(0);
  });

  it('重複page IDはtransactionとDB書き込み前に拒否する', async () => {
    const database = new ScriptedDatabase([]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.createOrGet({
      ...createInput(),
      pageIds: [pageId, pageId],
    })).rejects.toBeInstanceOf(ValidationError);
    expect(database.transactionCalls).toBe(0);
    expect(database.queries).toHaveLength(0);
  });

  it('内部batch・残り時間・error文字列も安全な上限で拒否する', async () => {
    const database = new ScriptedDatabase([]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.listExpiredArtifacts(1001)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(repository.failUnclaimable({
      jobId,
      maxAttempts: 5,
      minimumRemainingSeconds: 86_401,
      errorCode: 'EXPORT_RETRY_EXHAUSTED',
      errorMessage: 'The export could not be completed before expiry',
    })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(repository.fail({
      jobId,
      leaseToken,
      errorCode: 'EXPORT_SOURCE_UNAVAILABLE',
      errorMessage: 'Unsafe\nprovider detail',
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(database.queries).toHaveLength(0);
  });

  it('job参照をpersonal ownerまたは指定organizationのactive memberへ限定する', async () => {
    const database = new ScriptedDatabase([[jobRow({ organization_id: organizationId })]]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await repository.findForScope({
      userId,
      organizationId,
      jobId,
    });

    expect(database.queries[0]).toContain('episode_export_jobs.user_id = $2::uuid');
    expect(database.queries[0]).toContain('episode_export_jobs.organization_id = $3::uuid');
    expect(database.queries[0]).toContain('FROM organization_members');
    expect(database.queries[0]).toContain("organization_members.status = 'active'");
  });

  it('queuedまたは期限切れprocessingだけを新lease tokenで原子的claimする', async () => {
    const database = new ScriptedDatabase([[jobRow({
      status: 'processing',
      progress_stage: 'loading_images',
      progress_percent: 1,
      started_at: new Date('2026-07-31T00:00:00.000Z'),
      attempt_count: 1,
      processing_lease_token: leaseToken,
      processing_lease_expires_at: new Date('2026-07-31T00:15:00.000Z'),
      last_heartbeat_at: new Date('2026-07-31T00:00:00.000Z'),
    })]]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.claim({
      jobId,
      leaseToken,
      leaseDurationSeconds: 900,
      maxAttempts: 5,
    })).resolves.toMatchObject({ id: jobId, processingLeaseToken: leaseToken });

    expect(database.queries[0]).toContain("status = 'queued'");
    expect(database.queries[0]).toContain("status = 'processing'");
    expect(database.queries[0]).toContain('processing_lease_expires_at <= NOW()');
    expect(database.queries[0]).toContain('attempt_count < $4');
    expect(database.queries[0]).toContain('expires_at > NOW() + ($3::int * INTERVAL');
    expect(database.queries[0]).toContain('RETURNING episode_export_jobs.*');
  });

  it('heartbeat・progress・completeを生きた同一lease tokenに限定する', async () => {
    const database = new ScriptedDatabase([
      [{ updated: true }],
      [{ updated: true }],
      [{ updated: true }],
    ]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.heartbeat({
      jobId,
      leaseToken,
      leaseDurationSeconds: 900,
    })).resolves.toBe(true);
    await expect(repository.updateProgress({
      jobId,
      leaseToken,
      stage: 'building_artifact',
      percent: 65,
    })).resolves.toBe(true);
    await expect(repository.complete({
      jobId,
      leaseToken,
      artifactS3Key: `exports/${userId}/episodes/${episodeId}/${jobId}.pdf`,
      artifactMimeType: 'application/pdf',
      artifactSizeBytes: 1024,
    })).resolves.toBe(true);

    for (const sql of database.queries) {
      expect(sql).toContain('processing_lease_token = $2::uuid');
      expect(sql).toContain("status = 'processing'");
      expect(sql).toContain('processing_lease_expires_at > NOW()');
    }
    expect(database.queries[2]).toContain('processing_lease_token = NULL');
    expect(database.queries[2]).toContain("status = 'completed'");
  });

  it('一時失敗releaseと恒久失敗もlease token不一致では更新しない', async () => {
    const database = new ScriptedDatabase([
      [],
      [],
    ]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.releaseForRetry({ jobId, leaseToken })).resolves.toBe(false);
    await expect(repository.fail({
      jobId,
      leaseToken,
      errorCode: 'EXPORT_SOURCE_UNAVAILABLE',
      errorMessage: 'One or more export pages are unavailable',
    })).resolves.toBe(false);

    expect(database.queries[0]).toContain("status = 'queued'");
    expect(database.queries[0]).toContain('started_at = NULL');
    expect(database.queries[1]).toContain("status = 'failed'");
    expect(database.queries[1]).toContain('processing_lease_token = NULL');
    expect(database.queries[1]).toContain('processing_lease_expires_at > NOW()');
  });

  it('claim不能なqueueまたは期限切れleaseだけをterminal failにする', async () => {
    const database = new ScriptedDatabase([[{ updated: true }]]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.failUnclaimable({
      jobId,
      maxAttempts: 5,
      minimumRemainingSeconds: 900,
      errorCode: 'EXPORT_RETRY_EXHAUSTED',
      errorMessage: 'The export could not be completed before expiry',
    })).resolves.toBe(true);

    expect(database.queries[0]).toContain("status = 'queued'");
    expect(database.queries[0]).toContain("status = 'processing'");
    expect(database.queries[0]).toContain('processing_lease_expires_at <= NOW()');
    expect(database.queries[0]).toContain('attempt_count >= $2::int');
    expect(database.queries[0]).toContain('processing_lease_token = NULL');
  });

  it('outboxとartifact cleanupはepisode export専用tableだけを更新する', async () => {
    const artifactS3Key =
      `exports/${userId}/episodes/${episodeId}/${jobId}.pdf`;
    const database = new ScriptedDatabase([
      [{
        export_job_id: jobId,
        created_at: new Date('2026-07-31T00:00:00.000Z'),
        dispatched_at: null,
        sqs_message_id: null,
        dispatch_attempts: 0,
        last_dispatch_error: null,
      }],
      [{ updated: true }],
      [{ updated: true }],
      [{ job_id: jobId, artifact_s3_key: artifactS3Key }],
      [{ updated: true }],
    ]);
    const repository = new PostgresEpisodeExportJobRepository(database, database);

    await expect(repository.findUndispatchedForJob(jobId)).resolves.toMatchObject({
      exportJobId: jobId,
      dispatchAttempts: 0,
    });
    await expect(repository.markDispatched(jobId, 'sqs-message-1')).resolves.toBe(true);
    await expect(repository.markDispatchFailure(jobId, 'Dispatch temporarily failed'))
      .resolves.toBe(true);
    await expect(repository.listExpiredArtifacts(10)).resolves.toEqual([{
      jobId,
      artifactS3Key,
    }]);
    await expect(repository.markArtifactDeleted(jobId, artifactS3Key))
      .resolves.toBe(true);

    expect(database.queries[0]).toContain('FROM episode_export_job_outbox');
    expect(database.queries[0]).toContain('INNER JOIN episode_export_jobs');
    expect(database.queries[1]).toContain('UPDATE episode_export_job_outbox');
    expect(database.queries[2]).toContain('UPDATE episode_export_job_outbox');
    expect(database.queries[3]).toContain('FROM episode_export_jobs');
    expect(database.queries[4]).toContain('UPDATE episode_export_jobs');
    expect(database.queries.some((sql) => sql.includes('FROM export_jobs'))).toBe(false);
  });
});

class ScriptedDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly values: Array<readonly unknown[] | undefined> = [];
  public transactionCalls = 0;

  public constructor(private readonly responses: QueryResultRow[][]) {}

  public async transaction<T>(
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const rows = (this.responses.shift() ?? []) as T[];
    return queryResult(rows);
  }
}

function createInput(): {
  userId: string;
  organizationId: null;
  episodeId: string;
  pageIds: string[];
  format: 'pdf';
  filename: string;
  requestFingerprint: string;
  idempotencyKey: string;
  expiresAt: Date;
} {
  return {
    userId,
    organizationId: null,
    episodeId,
    pageIds: [pageId],
    format: 'pdf',
    filename: 'story.pdf',
    requestFingerprint: fingerprint,
    idempotencyKey: 'mobile-export-0001',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function snapshotRow(): QueryResultRow {
  return {
    page_id: pageId,
    page_number: 1,
    s3_key: `saved/${userId}/pages/${pageId}_final.png`,
  };
}

function jobRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: jobId,
    user_id: userId,
    organization_id: null,
    episode_id: episodeId,
    format: 'pdf',
    filename: 'story.pdf',
    page_ids: [pageId],
    page_snapshot: [{
      page_id: pageId,
      page_number: 1,
      s3_key: `saved/${userId}/pages/${pageId}_final.png`,
      mime_type: 'image/png',
    }],
    request_fingerprint: fingerprint,
    idempotency_key: 'mobile-export-0001',
    status: 'queued',
    progress_stage: 'queued',
    progress_percent: 0,
    artifact_s3_key: null,
    artifact_mime_type: null,
    artifact_size_bytes: null,
    artifact_deleted_at: null,
    error_code: null,
    error_message: null,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    expires_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-31T00:00:00.000Z'),
    attempt_count: 0,
    processing_lease_token: null,
    processing_lease_expires_at: null,
    last_heartbeat_at: null,
    ...overrides,
  };
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
