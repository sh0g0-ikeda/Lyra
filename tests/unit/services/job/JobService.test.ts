import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  CreateGenerationJobInput,
  FindGenerationJobForScopeInput,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type { EntityGenerationRecoveryServicePort } from '../../../../src/services/entity/EntityGenerationRecoveryService.js';
import { JobService } from '../../../../src/services/job/JobService.js';
import type { PageGenerationRecoveryServicePort } from '../../../../src/services/page/PageGenerationRecoveryService.js';

const now = new Date('2026-06-08T00:00:00.000Z');

class FakeGenerationJobRepository implements GenerationJobRepository {
  public job: GenerationJob | null = null;
  public reads = 0;
  public scopedReads: FindGenerationJobForScopeInput[] = [];
  public finalizedCancellations: string[] = [];

  public async create(_input: CreateGenerationJobInput): Promise<GenerationJob> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    this.reads += 1;
    return this.job;
  }

  public async findByIdForScope(input: FindGenerationJobForScopeInput): Promise<GenerationJob | null> {
    this.scopedReads.push(input);
    this.reads += 1;
    return this.job;
  }

  public async findActivePageGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async findActiveEntityGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async countActiveGenerationJobsByUser(): Promise<number> {
    throw new Error('not used');
  }

  public async countActiveGenerationJobs(): Promise<number> {
    throw new Error('not used');
  }

  public async attachQueueMessageId(): Promise<boolean> {
    throw new Error('not used');
  }

  public async markFailed(_jobId: string, errorMessage: string): Promise<boolean> {
    if (this.job === null) {
      return false;
    }

    this.job = {
      ...this.job,
      status: 'failed',
      errorMessage,
      completedAt: now,
    };
    return true;
  }

  public async prepareRetry(): Promise<boolean> {
    throw new Error('not used');
  }

  public async requestCancellation(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async finalizeCancellation(jobId: string): Promise<boolean> {
    this.finalizedCancellations.push(jobId);
    if (this.job === null || this.job.id !== jobId) {
      return false;
    }

    this.job = {
      ...this.job,
      status: 'cancelled',
      cancelledAt: now,
      completedAt: now,
    };
    return true;
  }
}

class FakeEntityGenerationRecoveryService implements EntityGenerationRecoveryServicePort {
  public recoveredEntities: Array<{ userId: string; entityId: string }> = [];
  public organizationIds: Array<string | null | undefined> = [];

  public constructor(private readonly onRecover: () => void = () => {}) {}

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForEntity(
    userId: string,
    entityId: string,
    organizationId?: string | null,
  ): Promise<number> {
    this.recoveredEntities.push({ userId, entityId });
    this.organizationIds.push(organizationId);
    this.onRecover();
    return 1;
  }
}

class FakePageGenerationRecoveryService implements PageGenerationRecoveryServicePort {
  public recoveredPages: Array<{ userId: string; pageId: string }> = [];
  public organizationIds: Array<string | null | undefined> = [];

  public constructor(private readonly onRecover: () => void = () => {}) {}

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForPage(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<number> {
    this.recoveredPages.push({ userId, pageId });
    this.organizationIds.push(organizationId);
    this.onRecover();
    return 1;
  }
}

describe('JobService', () => {
  it('returns the settlement attached to the authorized job without rewriting it', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'failed',
      creditSettlement: {
        chargedCredits: 5,
        refundedCredits: 0,
        netCredits: 5,
        status: 'refund_pending',
      },
    });
    const service = new JobService(repository);

    const job = await service.getJob('user-1', 'job-1', 'organization-1');

    expect(job.creditSettlement).toEqual({
      chargedCredits: 5,
      refundedCredits: 0,
      netCredits: 5,
      status: 'refund_pending',
    });
    expect(repository.scopedReads).toEqual([{
      userId: 'user-1',
      organizationId: 'organization-1',
      capability: 'view_work',
      jobId: 'job-1',
    }]);
  });

  it('processing entity job は stale recovery 後の再読込結果を返す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'entity_generate',
      params: { entity_id: 'entity-1' },
    });
    const entityRecoveryService = new FakeEntityGenerationRecoveryService(() => {
      repository.job = buildJob({
        status: 'failed',
        jobType: 'entity_generate',
        params: { entity_id: 'entity-1' },
        errorMessage: 'recovered',
      });
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      entityRecoveryService,
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(entityRecoveryService.recoveredEntities).toEqual([
      { userId: 'user-1', entityId: 'entity-1' },
    ]);
  });

  it('processing page job は stale recovery 後の再読込結果を返す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'page_generate',
      params: { page_id: 'page-1' },
    });
    const pageRecoveryService = new FakePageGenerationRecoveryService(() => {
      repository.job = buildJob({
        status: 'failed',
        jobType: 'page_generate',
        params: { page_id: 'page-1' },
        errorMessage: 'recovered',
      });
    });
    const service = new JobService(
      repository,
      pageRecoveryService,
      new FakeEntityGenerationRecoveryService(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(pageRecoveryService.recoveredPages).toEqual([
      { userId: 'user-1', pageId: 'page-1' },
    ]);
  });

  it('queued entity job も stale recovery 後の再読込結果を返す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'queued',
      jobType: 'entity_generate',
      params: { entity_id: 'entity-1' },
    });
    const entityRecoveryService = new FakeEntityGenerationRecoveryService(() => {
      repository.job = buildJob({
        status: 'failed',
        jobType: 'entity_generate',
        params: { entity_id: 'entity-1' },
        errorMessage: 'recovered',
      });
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      entityRecoveryService,
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(entityRecoveryService.recoveredEntities).toEqual([
      { userId: 'user-1', entityId: 'entity-1' },
    ]);
  });

  it('queued page job も stale recovery 後の再読込結果を返す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'queued',
      jobType: 'page_generate',
      params: { page_id: 'page-1' },
    });
    const pageRecoveryService = new FakePageGenerationRecoveryService(() => {
      repository.job = buildJob({
        status: 'failed',
        jobType: 'page_generate',
        params: { page_id: 'page-1' },
        errorMessage: 'recovered',
      });
    });
    const service = new JobService(
      repository,
      pageRecoveryService,
      new FakeEntityGenerationRecoveryService(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(pageRecoveryService.recoveredPages).toEqual([
      { userId: 'user-1', pageId: 'page-1' },
    ]);
  });

  it('法人の page job を回復する場合は organization scope を維持する', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'page_generate',
      organizationId: 'organization-1',
      params: { page_id: 'page-1' },
    });
    const pageRecoveryService = new FakePageGenerationRecoveryService();
    const service = new JobService(
      repository,
      pageRecoveryService,
      new FakeEntityGenerationRecoveryService(),
    );

    await service.getJob('user-1', 'job-1', 'organization-1');

    expect(pageRecoveryService.organizationIds).toEqual(['organization-1']);
  });

  it('processing episode_story_autofill job は長時間更新がなければ failed に倒す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'episode_story_autofill',
      creditCost: 0,
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:00:00.000Z' },
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      new FakeEntityGenerationRecoveryService(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(job.errorMessage).toContain('Long-running story/page planning job stopped');
  });

  it('processing episode_page_skeleton job は長時間更新がなければ failed に倒す', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'episode_page_skeleton',
      creditCost: 0,
      params: { episode_id: 'episode-1' },
      startedAt: new Date('2026-06-07T23:00:00.000Z'),
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      new FakeEntityGenerationRecoveryService(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('failed');
    expect(repository.reads).toBe(2);
    expect(job.errorMessage).toContain('Long-running story/page planning job stopped');
  });

  it('episode_story_autofill job がまだ更新中なら failed にしない', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'episode_story_autofill',
      creditCost: 0,
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:40:00.000Z' },
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      new FakeEntityGenerationRecoveryService(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('processing');
    expect(repository.reads).toBe(1);
  });
  it('停止要求済みの話全体反映ジョブが stale の場合は cancelled に確定する', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'episode_story_autofill',
      creditCost: 0,
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:00:00.000Z' },
      cancelRequestedAt: new Date('2026-06-07T23:10:00.000Z'),
      cancelRequestedBy: 'user-1',
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      new FakeEntityGenerationRecoveryService(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('cancelled');
    expect(repository.finalizedCancellations).toEqual(['job-1']);
    expect(job.errorMessage).toBeNull();
  });

  it('停止要求済みのページ骨格ジョブが stale の場合は cancelled に確定する', async () => {
    const repository = new FakeGenerationJobRepository();
    repository.job = buildJob({
      status: 'processing',
      jobType: 'episode_page_skeleton',
      creditCost: 0,
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:00:00.000Z' },
      cancelRequestedAt: new Date('2026-06-07T23:10:00.000Z'),
      cancelRequestedBy: 'user-1',
    });
    const service = new JobService(
      repository,
      new FakePageGenerationRecoveryService(),
      new FakeEntityGenerationRecoveryService(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const job = await service.getJob('user-1', 'job-1');

    expect(job.status).toBe('cancelled');
    expect(repository.finalizedCancellations).toEqual(['job-1']);
    expect(job.errorMessage).toBeNull();
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'entity_generate',
    status: 'queued',
    generationMode: null,
    creditCost: 1,
    params: {},
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}
