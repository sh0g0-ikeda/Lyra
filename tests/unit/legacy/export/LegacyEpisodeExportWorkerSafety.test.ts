import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LegacyExportJob } from '../../../../src/legacy/export/LegacyEpisodeExportJob.js';
import { LegacyEpisodeExportWorkerService } from '../../../../src/legacy/export/LegacyEpisodeExportWorkerService.js';

type Worker = Pick<LegacyEpisodeExportWorkerService, 'processJob'>;
type WorkerConstructor = new (
  repository: unknown,
  storage: unknown,
  guard: unknown,
  artifactBuilderFactory: unknown,
  options?: unknown,
) => Worker;
const SafetyWorker = LegacyEpisodeExportWorkerService as unknown as WorkerConstructor;

describe('legacy export worker safety boundary', () => {
  it('worker guardがloadを拒否した場合はstorageへ触れない', async () => {
    const events: string[] = [];
    const repository = new SafetyRepository(events);
    const storage = new SafetyStorage(events);
    const worker = new SafetyWorker(
      repository,
      storage,
      {
        async assertLoadAllowed(): Promise<void> {
          events.push('guard:load');
          throw new Error('membership removed');
        },
        async assertPublishAllowed(): Promise<void> { events.push('guard:publish'); },
      },
      () => new SafetyBuilder(events),
    );

    expect((await worker.processJob(repository.job.id)).status).toBe('failed');
    expect(events).toEqual(['repo:claim', 'guard:load', 'repo:fail']);
    expect(storage.loaded).toEqual([]);
  });

  it('artifact targetをDB inventoryへ登録してからuploadし、公開直前guard後にCAS completeする', async () => {
    const events: string[] = [];
    const repository = new SafetyRepository(events);
    const storage = new SafetyStorage(events);
    const worker = new SafetyWorker(
      repository,
      storage,
      new SafetyGuard(events),
      () => new SafetyBuilder(events),
    );

    expect(await worker.processJob(repository.job.id)).toMatchObject({ status: 'completed' });
    expect(events).toEqual([
      'repo:claim',
      'guard:load',
      'storage:load',
      'repo:progress:loading_images',
      'repo:progress:building_artifact',
      'builder:build',
      'repo:progress:storing_artifact',
      'storage:plan',
      'repo:register',
      'storage:store',
      'guard:publish',
      'repo:complete',
    ]);
    expect(repository.registeredTarget).toBe(storage.target);
  });

  it('complete応答不明でprocessingのままならinventoryを保持してretryし、cancel確定時だけ未採用artifactを削除する', async () => {
    const uncertainEvents: string[] = [];
    const uncertainRepository = new SafetyRepository(uncertainEvents);
    uncertainRepository.completeError = new Error('connection lost after commit request');
    uncertainRepository.reconciledStatus = 'processing';
    const uncertainStorage = new SafetyStorage(uncertainEvents);
    const uncertainWorker = new SafetyWorker(
      uncertainRepository,
      uncertainStorage,
      new SafetyGuard(uncertainEvents),
      () => new SafetyBuilder(uncertainEvents),
    );

    expect(await uncertainWorker.processJob(uncertainRepository.job.id)).toMatchObject({
      status: 'retry',
      reason: 'EXPORT_COMMIT_UNKNOWN',
    });
    expect(uncertainStorage.deleted).toEqual([]);
    expect(uncertainRepository.registeredTarget).toBe(uncertainStorage.target);

    const committedEvents: string[] = [];
    const committedRepository = new SafetyRepository(committedEvents);
    committedRepository.completeError = new Error('response lost after commit');
    committedRepository.reconciledStatus = 'completed';
    const committedStorage = new SafetyStorage(committedEvents);
    const committedWorker = new SafetyWorker(
      committedRepository,
      committedStorage,
      new SafetyGuard(committedEvents),
      () => new SafetyBuilder(committedEvents),
    );
    expect((await committedWorker.processJob(committedRepository.job.id)).status).toBe('completed');
    expect(committedStorage.deleted).toEqual([]);

    const canceledEvents: string[] = [];
    const canceledRepository = new SafetyRepository(canceledEvents);
    canceledRepository.completeResult = false;
    canceledRepository.reconciledStatus = 'canceled';
    const canceledStorage = new SafetyStorage(canceledEvents);
    const canceledWorker = new SafetyWorker(
      canceledRepository,
      canceledStorage,
      new SafetyGuard(canceledEvents),
      () => new SafetyBuilder(canceledEvents),
    );
    expect((await canceledWorker.processJob(canceledRepository.job.id)).status).toBe('skipped');
    expect(canceledStorage.deleted).toEqual([canceledStorage.target]);
    expect(canceledRepository.artifactDeleted).toBe(true);
  });

  it('store timeoutはprocessing inventoryを残してpublishせず、expired queuedはclaimとのCASで終端する', async () => {
    const timeoutEvents: string[] = [];
    const timeoutRepository = new SafetyRepository(timeoutEvents);
    const timeoutStorage = new SafetyStorage(timeoutEvents);
    timeoutStorage.storeDelayMs = 20;
    const timeoutWorker = new SafetyWorker(
      timeoutRepository,
      timeoutStorage,
      new SafetyGuard(timeoutEvents),
      () => new SafetyBuilder(timeoutEvents),
      { externalOperationTimeoutMs: 5 },
    );
    expect(await timeoutWorker.processJob(timeoutRepository.job.id)).toMatchObject({
      status: 'retry',
      reason: 'EXPORT_STORE_UNKNOWN',
    });
    expect(timeoutRepository.registeredTarget).toBe(timeoutStorage.target);
    expect(timeoutStorage.deleted).toEqual([]);
    expect(timeoutEvents).not.toContain('repo:fail');
    expect(timeoutEvents).not.toContain('repo:deleted');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(timeoutEvents).not.toContain('guard:publish');
    expect(timeoutEvents).not.toContain('repo:complete');

    const lateRejectEvents: string[] = [];
    const lateRejectStorage = new SafetyStorage(lateRejectEvents);
    lateRejectStorage.storeDelayMs = 20;
    lateRejectStorage.storeError = new Error('late upload rejection');
    const lateRejectWorker = new SafetyWorker(
      new SafetyRepository(lateRejectEvents),
      lateRejectStorage,
      new SafetyGuard(lateRejectEvents),
      () => new SafetyBuilder(lateRejectEvents),
      { externalOperationTimeoutMs: 5 },
    );
    expect(await lateRejectWorker.processJob(randomUUID())).toMatchObject({
      status: 'retry',
      reason: 'EXPORT_STORE_UNKNOWN',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(lateRejectEvents).not.toContain('guard:publish');
    expect(lateRejectEvents).not.toContain('repo:complete');
    expect(lateRejectEvents).not.toContain('repo:fail');

    const immediateRejectEvents: string[] = [];
    const immediateRejectStorage = new SafetyStorage(immediateRejectEvents);
    immediateRejectStorage.storeError = new Error('storage SDK disconnected');
    const immediateRejectWorker = new SafetyWorker(
      new SafetyRepository(immediateRejectEvents),
      immediateRejectStorage,
      new SafetyGuard(immediateRejectEvents),
      () => new SafetyBuilder(immediateRejectEvents),
      { externalOperationTimeoutMs: 1_000 },
    );
    expect(await immediateRejectWorker.processJob(randomUUID())).toMatchObject({
      status: 'retry',
      reason: 'EXPORT_STORE_UNKNOWN',
    });
    expect(immediateRejectEvents).not.toContain('guard:publish');
    expect(immediateRejectEvents).not.toContain('repo:complete');
    expect(immediateRejectEvents).not.toContain('repo:fail');

    const expiredEvents: string[] = [];
    const expiredRepository = new SafetyRepository(expiredEvents);
    expiredRepository.claimResult = null;
    expiredRepository.expireResult = true;
    const expiredWorker = new SafetyWorker(
      expiredRepository,
      new SafetyStorage(expiredEvents),
      new SafetyGuard(expiredEvents),
      () => new SafetyBuilder(expiredEvents),
    );
    expect(await expiredWorker.processJob(expiredRepository.job.id)).toMatchObject({
      status: 'skipped',
      reason: 'EXPORT_EXPIRED',
    });
    expect(expiredEvents).toEqual(['repo:claim', 'repo:expire']);
  });

  it('artifact作成前のfail応答不明でもDBのfailedまたはcanceled確定結果を返す', async () => {
    for (const failMode of ['false', 'throw'] as const) {
      const events: string[] = [];
      const repository = new SafetyRepository(events);
      repository.failResult = failMode === 'false' ? false : new Error('response lost after fail');
      repository.reconciledStatus = 'failed';
      const worker = new SafetyWorker(
        repository,
        new SafetyStorage(events),
        {
          async assertLoadAllowed(): Promise<void> { throw new Error('membership removed'); },
          async assertPublishAllowed(): Promise<void> {},
        },
        () => new SafetyBuilder(events),
      );

      expect(await worker.processJob(repository.job.id)).toMatchObject({
        status: 'failed',
        jobStatus: 'failed',
        reason: 'EXPORT_SOURCE_UNAVAILABLE',
      });
    }

    const canceledEvents: string[] = [];
    const canceledRepository = new SafetyRepository(canceledEvents);
    canceledRepository.failResult = false;
    canceledRepository.reconciledStatus = 'canceled';
    const canceledWorker = new SafetyWorker(
      canceledRepository,
      new SafetyStorage(canceledEvents),
      {
        async assertLoadAllowed(): Promise<void> { throw new Error('membership removed'); },
        async assertPublishAllowed(): Promise<void> {},
      },
      () => new SafetyBuilder(canceledEvents),
    );
    expect(await canceledWorker.processJob(canceledRepository.job.id)).toMatchObject({
      status: 'skipped',
      reason: 'EXPORT_SUPERSEDED',
    });
  });
});

class SafetyRepository {
  public readonly job = makeJob();
  public claimResult: LegacyExportJob | null = { ...this.job, status: 'processing' };
  public expireResult = false;
  public completeResult = true;
  public completeError: Error | null = null;
  public failResult: boolean | Error = true;
  public reconciledStatus: LegacyExportJob['status'] = 'completed';
  public registeredTarget: string | null = null;
  public artifactDeleted = false;

  public constructor(private readonly events: string[]) {}

  public async claim(): Promise<LegacyExportJob | null> { this.events.push('repo:claim'); return this.claimResult; }
  public async expireQueued(): Promise<boolean> { this.events.push('repo:expire'); return this.expireResult; }
  public async updateProgress(_jobId: string, stage: string): Promise<boolean> { this.events.push(`repo:progress:${stage}`); return true; }
  public async registerArtifactTarget(_jobId: string, target: string): Promise<boolean> {
    this.events.push('repo:register'); this.registeredTarget = target; return true;
  }
  public async complete(): Promise<boolean> {
    this.events.push('repo:complete');
    if (this.completeError !== null) throw this.completeError;
    return this.completeResult;
  }
  public async fail(): Promise<boolean> {
    this.events.push('repo:fail');
    if (this.failResult instanceof Error) throw this.failResult;
    return this.failResult;
  }
  public async findForWorker(): Promise<LegacyExportJob> {
    this.events.push('repo:reconcile');
    return {
      ...this.job,
      status: this.reconciledStatus,
      artifactS3Key: this.registeredTarget,
      artifactMimeType: this.reconciledStatus === 'completed' ? 'application/zip' : null,
      artifactSizeBytes: this.reconciledStatus === 'completed' ? 3 : null,
      errorCode: this.reconciledStatus === 'failed' ? 'EXPORT_SOURCE_UNAVAILABLE' : null,
      errorMessage: this.reconciledStatus === 'failed' ? 'Export source is unavailable' : null,
    };
  }
  public async markArtifactDeleted(): Promise<void> { this.events.push('repo:deleted'); this.artifactDeleted = true; }
}

class SafetyGuard {
  public constructor(private readonly events: string[]) {}
  public async assertLoadAllowed(): Promise<void> { this.events.push('guard:load'); }
  public async assertPublishAllowed(): Promise<void> { this.events.push('guard:publish'); }
}

class SafetyBuilder {
  public constructor(private readonly events: string[]) {}
  public async build(): Promise<{ data: Buffer; mimeType: 'application/zip'; extension: 'zip' }> {
    this.events.push('builder:build');
    return { data: Buffer.from('zip'), mimeType: 'application/zip', extension: 'zip' };
  }
}

class SafetyStorage {
  public readonly target: string;
  public readonly loaded: string[] = [];
  public readonly deleted: string[] = [];
  public storeDelayMs = 0;
  public storeError: Error | null = null;

  public constructor(private readonly events: string[]) {
    this.target = `legacy/${randomUUID()}.zip`;
  }

  public planArtifactTarget(): string { this.events.push('storage:plan'); return this.target; }
  public async loadPageImage({ s3Key }: { s3Key: string }): Promise<Buffer> {
    this.events.push('storage:load'); this.loaded.push(s3Key); return Buffer.from('image');
  }
  public async storeArtifact(): Promise<void> {
    this.events.push('storage:store');
    if (this.storeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.storeDelayMs));
    if (this.storeError !== null) throw this.storeError;
  }
  public async deleteArtifact(s3Key: string): Promise<void> {
    this.events.push('storage:delete'); this.deleted.push(s3Key);
  }
}

function makeJob(): LegacyExportJob {
  const pageId = randomUUID();
  return {
    id: randomUUID(), userId: randomUUID(), organizationId: null, episodeId: randomUUID(),
    format: 'zip', filename: 'chapter.zip', pageIds: [pageId],
    pageSnapshot: [{ pageId, pageNumber: 1, s3Key: `generated/${pageId}.png`, mimeType: 'image/png' }],
    requestFingerprint: '0'.repeat(64), status: 'queued', progressStage: 'queued', progressPercent: 0,
    artifactS3Key: null, artifactMimeType: null, artifactSizeBytes: null,
    errorCode: null, errorMessage: null, createdAt: new Date(), startedAt: null,
    completedAt: null, expiresAt: new Date(Date.now() + 60_000),
  };
}
