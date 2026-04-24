import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../../../src/domain/errors/index.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { GenerationJobRepository } from '../../../../src/repositories/GenerationJobRepository.js';
import type { ProcessPageGenerationJobResult } from '../../../../src/services/page/PageGenerationWorkerService.js';
import {
  MAX_PAGE_GENERATION_RETRIES,
  PageGenerationRetryService,
} from '../../../../src/services/page/PageGenerationRetryService.js';

class InMemoryGenerationJobRepository implements GenerationJobRepository {
  public job: GenerationJob | null = buildJob();
  public preparedRetryWith: number | null = null;

  public async create(): Promise<GenerationJob> {
    throw new Error('unused');
  }

  public async findById(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async attachQueueMessageId(): Promise<boolean> {
    throw new Error('unused');
  }

  public async markFailed(): Promise<boolean> {
    throw new Error('unused');
  }

  public async prepareRetry(_jobId: string, maxRetryCount: number): Promise<boolean> {
    this.preparedRetryWith = maxRetryCount;
    return true;
  }
}

class FakePageGenerationWorkerService {
  public processedJobId: string | null = null;

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.processedJobId = jobId;
    return { status: 'processed', jobStatus: 'completed' };
  }
}

describe('PageGenerationRetryService', () => {
  it('failed page_generate job を retry できる', async () => {
    const repository = new InMemoryGenerationJobRepository();
    const workerService = new FakePageGenerationWorkerService();
    const service = new PageGenerationRetryService(repository, workerService);

    await service.retryFailedJob('job-1');

    expect(repository.preparedRetryWith).toBe(MAX_PAGE_GENERATION_RETRIES);
    expect(workerService.processedJobId).toBe('job-1');
  });

  it('job が存在しない場合は not found になる', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = null;
    const service = new PageGenerationRetryService(repository, new FakePageGenerationWorkerService());

    await expect(service.retryFailedJob('job-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('failed 以外の job は retry できない', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = buildJob({ status: 'completed' });
    const service = new PageGenerationRetryService(repository, new FakePageGenerationWorkerService());

    await expect(service.retryFailedJob('job-1')).rejects.toBeInstanceOf(ConflictError);
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'page_generate',
    status: 'failed',
    generationMode: 'standard',
    creditCost: 10,
    params: {},
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: 'renderer unavailable',
    retryCount: 0,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    startedAt: new Date('2026-04-24T00:00:00.000Z'),
    completedAt: new Date('2026-04-24T00:01:00.000Z'),
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}
