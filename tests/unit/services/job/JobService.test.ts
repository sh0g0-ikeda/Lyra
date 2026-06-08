import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  CreateGenerationJobInput,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type { EntityGenerationRecoveryServicePort } from '../../../../src/services/entity/EntityGenerationRecoveryService.js';
import { JobService } from '../../../../src/services/job/JobService.js';
import type { PageGenerationRecoveryServicePort } from '../../../../src/services/page/PageGenerationRecoveryService.js';

const now = new Date('2026-06-08T00:00:00.000Z');

class FakeGenerationJobRepository implements GenerationJobRepository {
  public job: GenerationJob | null = null;
  public reads = 0;

  public async create(_input: CreateGenerationJobInput): Promise<GenerationJob> {
    throw new Error('not used');
  }

  public async findById(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
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

  public async markFailed(): Promise<boolean> {
    throw new Error('not used');
  }

  public async prepareRetry(): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeEntityGenerationRecoveryService implements EntityGenerationRecoveryServicePort {
  public recoveredEntities: Array<{ userId: string; entityId: string }> = [];

  public constructor(private readonly onRecover: () => void = () => {}) {}

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForEntity(userId: string, entityId: string): Promise<number> {
    this.recoveredEntities.push({ userId, entityId });
    this.onRecover();
    return 1;
  }
}

class FakePageGenerationRecoveryService implements PageGenerationRecoveryServicePort {
  public recoveredPages: Array<{ userId: string; pageId: string }> = [];

  public constructor(private readonly onRecover: () => void = () => {}) {}

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForPage(userId: string, pageId: string): Promise<number> {
    this.recoveredPages.push({ userId, pageId });
    this.onRecover();
    return 1;
  }
}

describe('JobService', () => {
  it('processing entity job 取得時に stale 回収して再読込結果を返す', async () => {
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

  it('processing page job 取得時に stale 回収して再読込結果を返す', async () => {
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
  it('queued entity job 取得時にも stale 回収して再読込結果を返す', async () => {
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

  it('queued page job 取得時にも stale 回収して再読込結果を返す', async () => {
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
    ...overrides,
  };
}
