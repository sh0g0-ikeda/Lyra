import { describe, expect, it } from 'vitest';
import {
  EpisodeExportProcessingError,
} from '../../../../src/domain/episodeExportProcessing.js';
import type {
  EpisodeExportJob,
} from '../../../../src/domain/episodeExportJob.js';
import type {
  EpisodeExportJobRepository,
} from '../../../../src/repositories/EpisodeExportJobRepository.js';
import type {
  EpisodeExportArtifactBuilderPort,
} from '../../../../src/services/export/EpisodeExportArtifactBuilder.js';
import type {
  EpisodeExportArtifactStoragePort,
  EpisodeExportSourceImageLoaderPort,
} from '../../../../src/services/export/EpisodeExportStorage.js';
import {
  EpisodeExportWorkerService,
} from '../../../../src/services/export/EpisodeExportWorkerService.js';

const jobId = '44444444-4444-4444-8444-444444444444';
const leaseToken = '55555555-5555-4555-8555-555555555555';

describe('EpisodeExportWorkerService', () => {
  it('snapshot順に画像を読みartifactをexact keyへ保存してlive leaseだけ完了する', async () => {
    const repository = new FakeRepository();
    const loader = new FakeLoader();
    const builder = new FakeBuilder();
    const storage = new FakeStorage();
    const service = buildService(repository, loader, builder, storage);

    const result = await service.processJob(jobId);

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(loader.keys).toEqual([
      repository.job?.pageSnapshot[0]?.s3Key,
      repository.job?.pageSnapshot[1]?.s3Key,
    ]);
    expect(builder.pageNumbers).toEqual([2, 1]);
    expect(storage.stored?.s3Key).toBe(
      'exports/11111111-1111-4111-8111-111111111111/episodes/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.pdf',
    );
    expect(repository.completed).toMatchObject({
      jobId,
      leaseToken,
      artifactMimeType: 'application/pdf',
      artifactSizeBytes: 8,
    });
  });

  it('合計source byte上限を越えるとprovider detailなしの永続失敗にする', async () => {
    const repository = new FakeRepository();
    const loader = new FakeLoader();
    loader.imageData = Buffer.from('1234');
    const service = buildService(
      repository,
      loader,
      new FakeBuilder(),
      new FakeStorage(),
      { maxTotalSourceBytes: 5 },
    );

    await expect(service.processJob(jobId)).resolves.toEqual({
      status: 'processed',
      jobStatus: 'failed',
    });
    expect(repository.failed).toMatchObject({
      jobId,
      leaseToken,
      errorCode: 'EXPORT_SOURCE_TOO_LARGE',
    });
  });

  it('retryable storage/source失敗ではleaseを解放してqueue retryを要求する', async () => {
    const repository = new FakeRepository();
    const loader = new FakeLoader();
    loader.error = new EpisodeExportProcessingError(
      'EXPORT_TEMPORARY_FAILURE',
      'Episode export is temporarily unavailable',
      true,
    );
    const service = buildService(
      repository,
      loader,
      new FakeBuilder(),
      new FakeStorage(),
    );

    await expect(service.processJob(jobId)).resolves.toMatchObject({
      status: 'retry',
    });
    expect(repository.released).toEqual({ jobId, leaseToken });
    expect(repository.failed).toBeNull();
  });

  it('heartbeatまたはprogressでleaseを失ったworkerはfailやreleaseで新workerを上書きしない', async () => {
    const repository = new FakeRepository();
    repository.heartbeatResult = false;
    const service = buildService(
      repository,
      new FakeLoader(),
      new FakeBuilder(),
      new FakeStorage(),
    );

    await expect(service.processJob(jobId)).resolves.toMatchObject({
      status: 'retry',
    });
    expect(repository.released).toBeNull();
    expect(repository.failed).toBeNull();
    expect(repository.completed).toBeNull();

    const progressRepository = new FakeRepository();
    progressRepository.updateProgressResult = false;
    await expect(buildService(
      progressRepository,
      new FakeLoader(),
      new FakeBuilder(),
      new FakeStorage(),
    ).processJob(jobId)).resolves.toMatchObject({
      status: 'retry',
    });
    expect(progressRepository.released).toBeNull();
    expect(progressRepository.failed).toBeNull();
    expect(progressRepository.completed).toBeNull();
  });

  it('artifact保存後にcomplete leaseを失ってもjob-owned artifactを消さず再処理へ渡す', async () => {
    const repository = new FakeRepository();
    repository.completeResult = false;
    const storage = new FakeStorage();

    await expect(buildService(
      repository,
      new FakeLoader(),
      new FakeBuilder(),
      storage,
    ).processJob(jobId)).resolves.toMatchObject({
      status: 'retry',
    });
    expect(storage.stored).not.toBeNull();
    expect(storage.deleteCount).toBe(0);
    expect(repository.failed).toBeNull();
    expect(repository.released).toBeNull();
  });

  it('attemptまたは残存時間を使い切った未claim jobを安全にterminalizeする', async () => {
    const repository = new FakeRepository();
    repository.claimResult = null;
    repository.job = buildJob({
      status: 'queued',
      attemptCount: 5,
      processingLeaseToken: null,
      processingLeaseExpiresAt: null,
      lastHeartbeatAt: null,
    });
    repository.failUnclaimableResult = true;
    const service = buildService(
      repository,
      new FakeLoader(),
      new FakeBuilder(),
      new FakeStorage(),
    );

    await expect(service.processJob(jobId)).resolves.toEqual({
      status: 'processed',
      jobStatus: 'failed',
    });
    expect(repository.unclaimableFailure).toMatchObject({
      jobId,
      maxAttempts: 5,
      errorCode: 'EXPORT_ATTEMPTS_EXHAUSTED',
    });
  });
});

class FakeRepository {
  public job: EpisodeExportJob | null = buildJob();
  public claimResult: EpisodeExportJob | null | undefined;
  public heartbeatResult = true;
  public updateProgressResult = true;
  public releaseResult = true;
  public failResult = true;
  public completeResult = true;
  public failUnclaimableResult = false;
  public released: { jobId: string; leaseToken: string } | null = null;
  public failed: {
    jobId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  } | null = null;
  public completed: {
    jobId: string;
    leaseToken: string;
    artifactS3Key: string;
    artifactMimeType: 'application/pdf' | 'application/zip';
    artifactSizeBytes: number;
  } | null = null;
  public unclaimableFailure: {
    jobId: string;
    maxAttempts: number;
    minimumRemainingSeconds: number;
    errorCode: string;
    errorMessage: string;
  } | null = null;

  public asPort(): EpisodeExportJobRepository {
    return {
      createOrGet: async () => {
        throw new Error('not used');
      },
      findForScope: async () => this.job,
      findForWorker: async () => this.job,
      claim: async () => (
        this.claimResult === undefined ? this.job : this.claimResult
      ),
      heartbeat: async () => this.heartbeatResult,
      updateProgress: async () => this.updateProgressResult,
      releaseForRetry: async (input) => {
        this.released = input;
        return this.releaseResult;
      },
      complete: async (input) => {
        this.completed = input;
        return this.completeResult;
      },
      fail: async (input) => {
        this.failed = input;
        return this.failResult;
      },
      failUnclaimable: async (input) => {
        this.unclaimableFailure = input;
        return this.failUnclaimableResult;
      },
      findUndispatchedForJob: async () => null,
      listUndispatched: async () => [],
      markDispatched: async () => false,
      markDispatchFailure: async () => false,
      listExpiredArtifacts: async () => [],
      markArtifactDeleted: async () => false,
    };
  }
}

class FakeLoader implements EpisodeExportSourceImageLoaderPort {
  public readonly keys: string[] = [];
  public imageData = Buffer.from('page');
  public error: Error | null = null;

  public async load(input: {
    s3Key: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  }): Promise<{
    imageData: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    eTag: string;
  }> {
    this.keys.push(input.s3Key);
    if (this.error !== null) {
      throw this.error;
    }
    return {
      imageData: this.imageData,
      mimeType: input.mimeType,
      eTag: '"fake"',
    };
  }
}

class FakeBuilder implements EpisodeExportArtifactBuilderPort {
  public pageNumbers: number[] = [];

  public async build(input: {
    format: 'pdf' | 'zip';
    createdAt: Date;
    pages: Array<{
      pageId: string;
      pageNumber: number;
      imageData: Buffer;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    }>;
    onPageProcessed?: (completedCount: number, totalCount: number) => Promise<void>;
  }): Promise<{
    artifactData: Buffer;
    mimeType: 'application/pdf' | 'application/zip';
  }> {
    this.pageNumbers = input.pages.map((page) => page.pageNumber);
    await input.onPageProcessed?.(input.pages.length, input.pages.length);
    return {
      artifactData: Buffer.from('%PDF-job'),
      mimeType: input.format === 'pdf' ? 'application/pdf' : 'application/zip',
    };
  }
}

class FakeStorage implements EpisodeExportArtifactStoragePort {
  public deleteCount = 0;
  public stored: {
    s3Key: string;
    artifactData: Buffer;
  } | null = null;

  public async store(input: {
    userId: string;
    organizationId: string | null;
    episodeId: string;
    jobId: string;
    format: 'pdf' | 'zip';
    s3Key: string;
    mimeType: 'application/pdf' | 'application/zip';
    artifactData: Buffer;
  }): Promise<void> {
    this.stored = {
      s3Key: input.s3Key,
      artifactData: input.artifactData,
    };
  }

  public async delete(): Promise<void> {
    this.deleteCount += 1;
  }
}

function buildService(
  repository: FakeRepository,
  loader: FakeLoader,
  builder: FakeBuilder,
  storage: FakeStorage,
  overrides: { maxTotalSourceBytes?: number } = {},
): EpisodeExportWorkerService {
  return new EpisodeExportWorkerService(
    repository.asPort(),
    loader,
    builder,
    storage,
    {
      leaseDurationSeconds: 900,
      maxAttempts: 5,
      minimumRemainingSeconds: 900,
      maxTotalSourceBytes: overrides.maxTotalSourceBytes,
      leaseTokenFactory: () => leaseToken,
    },
  );
}

function buildJob(overrides: Partial<EpisodeExportJob> = {}): EpisodeExportJob {
  const now = new Date('2026-07-31T00:00:00.000Z');
  return {
    id: jobId,
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: null,
    episodeId: '33333333-3333-4333-8333-333333333333',
    format: 'pdf',
    filename: 'episode.pdf',
    pageIds: [
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',
    ],
    pageSnapshot: [
      {
        pageId: '22222222-2222-4222-8222-222222222222',
        pageNumber: 2,
        s3Key:
          'session/11111111-1111-4111-8111-111111111111/pages/22222222-2222-4222-8222-222222222222/job.png',
        mimeType: 'image/png',
      },
      {
        pageId: '66666666-6666-4666-8666-666666666666',
        pageNumber: 1,
        s3Key:
          'saved/11111111-1111-4111-8111-111111111111/pages/66666666-6666-4666-8666-666666666666_final.jpeg',
        mimeType: 'image/jpeg',
      },
    ],
    requestFingerprint: 'a'.repeat(64),
    idempotencyKey: 'request-1',
    status: 'processing',
    progressStage: 'loading_images',
    progressPercent: 1,
    artifactS3Key: null,
    artifactMimeType: null,
    artifactSizeBytes: null,
    artifactDeletedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: now,
    attemptCount: 1,
    processingLeaseToken: leaseToken,
    processingLeaseExpiresAt: new Date('2026-07-31T00:15:00.000Z'),
    lastHeartbeatAt: now,
    ...overrides,
  };
}
