import { describe, expect, it } from 'vitest';
import {
  EPISODE_EXPORT_ARTIFACT_TTL_MS,
  type EpisodeExportJob,
} from '../../../../src/domain/episodeExportJob.js';
import { ConflictError, NotFoundError } from '../../../../src/domain/errors/index.js';
import type {
  CreateEpisodeExportJobInput,
  EpisodeExportJobRepository,
} from '../../../../src/repositories/EpisodeExportJobRepository.js';
import type {
  EpisodeExportDispatchPort,
} from '../../../../src/services/export/EpisodeExportDispatchService.js';
import {
  EpisodeExportService,
  type EpisodeExportDownloadSignerPort,
} from '../../../../src/services/export/EpisodeExportService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const pageId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-07-31T00:00:00.000Z');

describe('EpisodeExportService', () => {
  it('jobとoutboxのtransaction完了後に専用queueへdispatchする', async () => {
    const repository = new FakeRepository();
    const dispatcher = new FakeDispatcher();
    const service = createService(repository, dispatcher);

    const result = await service.createExport(
      userId,
      episodeId,
      {
        format: 'pdf',
        pageIds: [pageId],
        filename: '../safe-name.pdf',
        idempotencyKey: 'request-123',
      },
      organizationId,
    );

    expect(result).toEqual({ jobId, status: 'queued' });
    expect(repository.createdInput).toMatchObject({
      userId,
      organizationId,
      episodeId,
      format: 'pdf',
      pageIds: [pageId],
      filename: 'safe-name.pdf',
      idempotencyKey: 'request-123',
      expiresAt: new Date(now.getTime() + EPISODE_EXPORT_ARTIFACT_TTL_MS),
    });
    expect(repository.createCompleted).toBe(true);
    expect(dispatcher.calls).toEqual([jobId]);
  });

  it('SQS一時障害でも作成済みjobを返しoutboxを再試行可能に保つ', async () => {
    const repository = new FakeRepository();
    const dispatcher = new FakeDispatcher();
    dispatcher.error = new Error('temporary queue failure');
    const service = createService(repository, dispatcher);

    await expect(service.createExport(
      userId,
      episodeId,
      {
        format: 'zip',
        pageIds: [pageId],
        idempotencyKey: 'request-456',
      },
      null,
    )).resolves.toEqual({ jobId, status: 'queued' });

    expect(repository.createCompleted).toBe(true);
    expect(dispatcher.calls).toEqual([jobId]);
  });

  it('status取得時に未dispatchをbest-effort再送し内部情報を含めない', async () => {
    const repository = new FakeRepository();
    const dispatcher = new FakeDispatcher();
    const service = createService(repository, dispatcher);

    const result = await service.getExport(userId, jobId, organizationId);

    expect(result).toEqual({
      jobId,
      status: 'queued',
      progressStage: 'queued',
      progressPercent: 0,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      downloadReady: false,
    });
    expect(dispatcher.calls).toEqual([jobId]);
    expect(result).not.toHaveProperty('artifactS3Key');
    expect(result).not.toHaveProperty('processingLeaseToken');
  });

  it('別scopeまたは存在しないjobは同じ404にする', async () => {
    const repository = new FakeRepository();
    repository.job = null;
    const service = createService(repository, new FakeDispatcher());

    await expect(service.getExport(userId, jobId, organizationId)).rejects.toEqual(
      new NotFoundError('Episode export not found'),
    );
  });

  it('完了済みかつ未期限切れartifactだけを残り時間以下で署名する', async () => {
    const repository = new FakeRepository();
    repository.job = buildJob({
      status: 'completed',
      progressStage: 'completed',
      progressPercent: 100,
      artifactS3Key: `exports/${organizationId}/episodes/${episodeId}/${jobId}.pdf`,
      artifactMimeType: 'application/pdf',
      artifactSizeBytes: 1024,
      completedAt: new Date('2026-07-31T00:01:00.000Z'),
      expiresAt: new Date('2026-07-31T00:03:20.000Z'),
    });
    const signer = new FakeDownloadSigner();
    const service = createService(repository, new FakeDispatcher(), signer);

    const result = await service.createDownload(userId, jobId, organizationId);

    expect(result).toEqual({
      url: 'https://downloads.lyra.test/signed',
      expiresAt: new Date('2026-07-31T00:03:20.000Z'),
    });
    expect(signer.inputs).toEqual([{
      job: repository.job,
      expiresInSeconds: 200,
    }]);
  });

  it('未完了・削除済み・期限切れ・HTTP署名URLをdownload不可にする', async () => {
    const cases: EpisodeExportJob[] = [
      buildJob(),
      buildJob({
        status: 'completed',
        artifactS3Key: `exports/${organizationId}/episodes/${episodeId}/${jobId}.pdf`,
        artifactMimeType: 'application/pdf',
        artifactSizeBytes: 1,
        artifactDeletedAt: now,
      }),
      buildJob({
        status: 'completed',
        artifactS3Key: `exports/${organizationId}/episodes/${episodeId}/${jobId}.pdf`,
        artifactMimeType: 'application/pdf',
        artifactSizeBytes: 1,
        expiresAt: now,
      }),
    ];

    for (const job of cases) {
      const repository = new FakeRepository();
      repository.job = job;
      await expect(
        createService(repository, new FakeDispatcher()).createDownload(
          userId,
          jobId,
          organizationId,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    }

    const repository = new FakeRepository();
    repository.job = buildJob({
      status: 'completed',
      artifactS3Key: `exports/${organizationId}/episodes/${episodeId}/${jobId}.pdf`,
      artifactMimeType: 'application/pdf',
      artifactSizeBytes: 1,
    });
    const signer = new FakeDownloadSigner();
    signer.url = 'http://downloads.lyra.test/unsafe';
    await expect(
      createService(repository, new FakeDispatcher(), signer).createDownload(
        userId,
        jobId,
        organizationId,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

class FakeRepository {
  public job: EpisodeExportJob | null = buildJob();
  public createdInput: CreateEpisodeExportJobInput | null = null;
  public createCompleted = false;

  public async createOrGet(input: CreateEpisodeExportJobInput) {
    this.createdInput = input;
    this.createCompleted = true;
    return { created: true, job: buildJob() };
  }

  public async findForScope(): Promise<EpisodeExportJob | null> {
    return this.job;
  }
}

class FakeDispatcher implements EpisodeExportDispatchPort {
  public calls: string[] = [];
  public error: Error | null = null;

  public async dispatchJob(jobIdToDispatch: string): Promise<void> {
    this.calls.push(jobIdToDispatch);
    if (this.error !== null) {
      throw this.error;
    }
  }
}

class FakeDownloadSigner implements EpisodeExportDownloadSignerPort {
  public inputs: Array<{ job: EpisodeExportJob; expiresInSeconds: number }> = [];
  public url = 'https://downloads.lyra.test/signed';

  public async sign(input: {
    job: EpisodeExportJob;
    expiresInSeconds: number;
  }): Promise<string> {
    this.inputs.push(input);
    return this.url;
  }
}

function createService(
  repository: FakeRepository,
  dispatcher: FakeDispatcher,
  signer: EpisodeExportDownloadSignerPort = new FakeDownloadSigner(),
): EpisodeExportService {
  return new EpisodeExportService(
    repository as unknown as EpisodeExportJobRepository,
    dispatcher,
    signer,
    { now: () => now },
  );
}

function buildJob(overrides: Partial<EpisodeExportJob> = {}): EpisodeExportJob {
  return {
    id: jobId,
    userId,
    organizationId,
    episodeId,
    format: 'pdf',
    filename: 'safe-name.pdf',
    pageIds: [pageId],
    pageSnapshot: [{
      pageId,
      pageNumber: 1,
      s3Key: `pages/${pageId}/generated.png`,
      mimeType: 'image/png',
    }],
    requestFingerprint: 'a'.repeat(64),
    idempotencyKey: 'request-123',
    status: 'queued',
    progressStage: 'queued',
    progressPercent: 0,
    artifactS3Key: null,
    artifactMimeType: null,
    artifactSizeBytes: null,
    artifactDeletedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: now,
    attemptCount: 0,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    lastHeartbeatAt: null,
    ...overrides,
  };
}
