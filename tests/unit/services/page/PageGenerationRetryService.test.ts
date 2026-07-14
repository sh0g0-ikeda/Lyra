import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { GenerationJobRepository } from '../../../../src/repositories/GenerationJobRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';
import type { ProcessPageGenerationJobResult } from '../../../../src/services/page/PageGenerationWorkerService.js';
import {
  MAX_PAGE_GENERATION_RETRIES,
  PageGenerationRetryService,
} from '../../../../src/services/page/PageGenerationRetryService.js';

class InMemoryGenerationJobRepository implements GenerationJobRepository {
  public job: GenerationJob | null = buildJob();
  public preparedRetryWith: number | null = null;
  public prepareRetryResult = true;
  public prepareRetryError: unknown = null;

  public async create(): Promise<GenerationJob> {
    throw new Error('unused');
  }

  public async findByIdAndUserId(_jobId: string, userId: string): Promise<GenerationJob | null> {
    if (this.job === null || this.job.userId !== userId) {
      return null;
    }

    return this.job;
  }

  public async findActivePageGenerationJob(): Promise<GenerationJob | null> {
    return null;
  }

  public async findActiveEntityGenerationJob(): Promise<GenerationJob | null> {
    return null;
  }

  public async countActiveGenerationJobsByUser(): Promise<number> {
    return 0;
  }

  public async countActiveGenerationJobs(): Promise<number> {
    return 0;
  }

  public async attachQueueMessageId(): Promise<boolean> {
    throw new Error('unused');
  }

  public async markFailed(): Promise<boolean> {
    throw new Error('unused');
  }

  public async prepareRetry(_jobId: string, maxRetryCount: number): Promise<boolean> {
    this.preparedRetryWith = maxRetryCount;
    if (this.prepareRetryError !== null) {
      throw this.prepareRetryError;
    }

    return this.prepareRetryResult;
  }
}

class FakePageGenerationWorkerService {
  public processedJobId: string | null = null;

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.processedJobId = jobId;
    return { status: 'processed', jobStatus: 'completed' };
  }
}

class FakeCreditService implements CreditServicePort {
  public consumed: ConsumeCreditsParams[] = [];
  public refunded: RefundCreditsParams[] = [];

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    this.consumed.push(params);
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunded.push(params);
    return this.getBalance();
  }
}

class FakeOrganizationService {
  public consumed: unknown[] = [];
  public refunded: unknown[] = [];

  public async consumeCredits(params: unknown): Promise<unknown> {
    this.consumed.push(params);
    return {};
  }

  public async refundCredits(params: unknown): Promise<unknown> {
    this.refunded.push(params);
    return {};
  }
}

describe('PageGenerationRetryService', () => {
  it('所有者の failed page_generate job を再課金して retry できる', async () => {
    const repository = new InMemoryGenerationJobRepository();
    const workerService = new FakePageGenerationWorkerService();
    const creditService = new FakeCreditService();
    const service = new PageGenerationRetryService(repository, workerService, creditService);

    await service.retryFailedJob('user-1', 'job-1');

    expect(creditService.consumed[0]).toMatchObject({
      userId: 'user-1',
      cost: 10,
      description: 'Page generation retry',
      jobId: 'job-1',
    });
    expect(creditService.refunded).toEqual([]);
    expect(repository.preparedRetryWith).toBe(MAX_PAGE_GENERATION_RETRIES);
    expect(workerService.processedJobId).toBe('job-1');
  });

  it('古い0cr failed jobは再課金せずに retry できる', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = buildJob({ creditCost: 0 });
    const workerService = new FakePageGenerationWorkerService();
    const creditService = new FakeCreditService();
    const service = new PageGenerationRetryService(repository, workerService, creditService);

    await service.retryFailedJob('user-1', 'job-1');

    expect(creditService.consumed).toEqual([]);
    expect(creditService.refunded).toEqual([]);
    expect(repository.preparedRetryWith).toBe(MAX_PAGE_GENERATION_RETRIES);
    expect(workerService.processedJobId).toBe('job-1');
  });

  it('法人 failed page_generate job は法人共有クレジットで retry する', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = buildJob({ organizationId: 'org-1' });
    const workerService = new FakePageGenerationWorkerService();
    const creditService = new FakeCreditService();
    const organizationService = new FakeOrganizationService();
    const service = new PageGenerationRetryService(
      repository,
      workerService,
      creditService,
      undefined,
      organizationService as unknown as OrganizationServicePort,
    );

    await service.retryFailedJob('user-1', 'job-1');

    expect(creditService.consumed).toEqual([]);
    expect(organizationService.consumed[0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      cost: 10,
      description: 'Page generation retry',
      jobId: 'job-1',
      eventType: 'generation.started',
    });
    expect(organizationService.refunded).toEqual([]);
    expect(workerService.processedJobId).toBe('job-1');
  });

  it('他ユーザーの job は not found にする', async () => {
    const repository = new InMemoryGenerationJobRepository();
    const service = new PageGenerationRetryService(
      repository,
      new FakePageGenerationWorkerService(),
      new FakeCreditService(),
    );

    await expect(service.retryFailedJob('other-user', 'job-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('job が存在しない場合は not found にする', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = null;
    const service = new PageGenerationRetryService(
      repository,
      new FakePageGenerationWorkerService(),
      new FakeCreditService(),
    );

    await expect(service.retryFailedJob('user-1', 'job-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('failed 以外の job は retry できない', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = buildJob({ status: 'completed' });
    const service = new PageGenerationRetryService(
      repository,
      new FakePageGenerationWorkerService(),
      new FakeCreditService(),
    );

    await expect(service.retryFailedJob('user-1', 'job-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('retry 準備に失敗した場合は消費分を返金する', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.prepareRetryResult = false;
    const creditService = new FakeCreditService();
    const workerService = new FakePageGenerationWorkerService();
    const service = new PageGenerationRetryService(repository, workerService, creditService);

    await expect(service.retryFailedJob('user-1', 'job-1')).rejects.toBeInstanceOf(ConflictError);

    expect(workerService.processedJobId).toBeNull();
    expect(creditService.consumed).toHaveLength(1);
    expect(creditService.refunded[0]).toMatchObject({
      userId: 'user-1',
      amount: 10,
      description: 'Refund for failed page generation retry setup',
      jobId: 'job-1',
    });
  });

  it('法人 retry 準備に失敗した場合は法人共有クレジットへ返金する', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.job = buildJob({ organizationId: 'org-1' });
    repository.prepareRetryResult = false;
    const creditService = new FakeCreditService();
    const organizationService = new FakeOrganizationService();
    const workerService = new FakePageGenerationWorkerService();
    const service = new PageGenerationRetryService(
      repository,
      workerService,
      creditService,
      undefined,
      organizationService as unknown as OrganizationServicePort,
    );

    await expect(service.retryFailedJob('user-1', 'job-1')).rejects.toBeInstanceOf(ConflictError);

    expect(workerService.processedJobId).toBeNull();
    expect(creditService.consumed).toEqual([]);
    expect(creditService.refunded).toEqual([]);
    expect(organizationService.consumed).toHaveLength(1);
    expect(organizationService.refunded[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      amount: 10,
      description: 'Refund for failed page generation retry setup',
      jobId: 'job-1',
    });
  });

  it('同じページの active job と競合した場合は返金して conflict にする', async () => {
    const repository = new InMemoryGenerationJobRepository();
    repository.prepareRetryError = { code: '23505' };
    const creditService = new FakeCreditService();
    const workerService = new FakePageGenerationWorkerService();
    const service = new PageGenerationRetryService(repository, workerService, creditService);

    await expect(service.retryFailedJob('user-1', 'job-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Page generation is already queued or processing',
    });

    expect(workerService.processedJobId).toBeNull();
    expect(creditService.consumed).toHaveLength(1);
    expect(creditService.refunded[0]).toMatchObject({
      userId: 'user-1',
      amount: 10,
      description: 'Refund for failed page generation retry setup',
      jobId: 'job-1',
    });
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
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}
