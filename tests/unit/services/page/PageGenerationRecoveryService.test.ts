import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/repositories/GenerationJobRepository.js';
import type { PageGenerationExecutionRepository } from '../../../../src/repositories/PageGenerationExecutionRepository.js';
import type {
  PageGenerationRecoveryRepository,
  StalePageGenerationJob,
} from '../../../../src/repositories/PageGenerationRecoveryRepository.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import { PageGenerationRecoveryService } from '../../../../src/services/page/PageGenerationRecoveryService.js';

class FakeRecoveryRepository implements PageGenerationRecoveryRepository {
  public jobs: StalePageGenerationJob[] = [];

  public async listStaleProcessingJobs(): Promise<StalePageGenerationJob[]> {
    return [...this.jobs];
  }

  public async listStaleProcessingJobsForPage(
    userId: string,
    pageId: string,
  ): Promise<StalePageGenerationJob[]> {
    return this.jobs.filter((job) => job.userId === userId && job.pageId === pageId);
  }
}

class FakeExecutionRepository implements PageGenerationExecutionRepository {
  public failedJobIds: string[] = [];

  public async claimQueuedPageGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async completePageGeneration(): Promise<boolean> {
    throw new Error('not used');
  }

  public async failPageGeneration(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
    pageId?: string;
  }): Promise<boolean> {
    this.failedJobIds.push(input.jobId);
    return true;
  }
}

class FakeCreditService implements CreditServicePort {
  public refunds: RefundCreditsParams[] = [];

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunds.push(params);
    return this.getBalance();
  }
}

describe('PageGenerationRecoveryService', () => {
  it('stale processing jobs を failed に戻して refund する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        pageId: 'page-1',
        previousStatus: 'designing',
        previousGenerationMode: null,
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new PageGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverAllStaleJobs();

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual(['job-1']);
    expect(creditService.refunds).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        amount: 1,
        jobId: 'job-1',
      }),
    ]);
  });

  it('対象 page に紐づく stale job だけ回収する', async () => {
    const repository = new FakeRecoveryRepository();
    repository.jobs = [
      {
        jobId: 'job-1',
        userId: 'user-1',
        creditCost: 1,
        pageId: 'page-1',
        previousStatus: 'designing',
        previousGenerationMode: null,
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
      {
        jobId: 'job-2',
        userId: 'user-1',
        creditCost: 1,
        pageId: 'page-2',
        previousStatus: 'designing',
        previousGenerationMode: null,
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    ];
    const executionRepository = new FakeExecutionRepository();
    const creditService = new FakeCreditService();
    const service = new PageGenerationRecoveryService(
      repository,
      executionRepository,
      creditService,
      1,
    );

    const recoveredCount = await service.recoverStaleJobsForPage('user-1', 'page-2');

    expect(recoveredCount).toBe(1);
    expect(executionRepository.failedJobIds).toEqual(['job-2']);
  });
});
