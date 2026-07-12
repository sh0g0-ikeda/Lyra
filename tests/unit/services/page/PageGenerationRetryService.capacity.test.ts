import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  GenerationJobRepository,
  PrepareGenerationJobRetryOptions,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type { ProcessPageGenerationJobResult } from '../../../../src/services/page/PageGenerationWorkerService.js';
import {
  MAX_PAGE_GENERATION_RETRIES,
  PageGenerationRetryService,
} from '../../../../src/services/page/PageGenerationRetryService.js';

class InMemoryGenerationJobRepository implements GenerationJobRepository {
  public prepareRetryOptions: PrepareGenerationJobRetryOptions | undefined;

  public async create(): Promise<GenerationJob> {
    throw new Error('unused');
  }

  public async findByIdAndUserId(_jobId: string, userId: string): Promise<GenerationJob | null> {
    return userId === 'user-1' ? buildJob() : null;
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

  public async prepareRetry(
    _jobId: string,
    _maxRetryCount: number,
    options?: PrepareGenerationJobRetryOptions,
  ): Promise<boolean> {
    this.prepareRetryOptions = options;
    return true;
  }
}

class FakePageGenerationWorkerService {
  public async processJob(_jobId: string): Promise<ProcessPageGenerationJobResult> {
    return { status: 'processed', jobStatus: 'completed' };
  }
}

class FakeCreditService implements CreditServicePort {
  public consumed: ConsumeCreditsParams[] = [];

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

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }
}

describe('PageGenerationRetryService capacity guard', () => {
  it('failed job retry を queued に戻す時も generation capacity limits を渡す', async () => {
    const repository = new InMemoryGenerationJobRepository();
    const service = new PageGenerationRetryService(
      repository,
      new FakePageGenerationWorkerService(),
      new FakeCreditService(),
      { perUser: 4, global: 8 },
    );

    await service.retryFailedJob('user-1', 'job-1');

    expect(repository.prepareRetryOptions).toEqual({
      userId: 'user-1',
      organizationId: null,
      capacityLimits: { perUser: 4, global: 8 },
    });
  });
});

function buildJob(): GenerationJob {
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
    retryCount: MAX_PAGE_GENERATION_RETRIES - 1,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    startedAt: new Date('2026-04-24T00:00:00.000Z'),
    completedAt: new Date('2026-04-24T00:01:00.000Z'),
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}
