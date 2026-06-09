import {
  GENERATION_RECOVERY_BATCH_LIMIT,
  PAGE_GENERATION_STALE_AFTER_MS,
} from '../../domain/constants/generation.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { PageGenerationExecutionRepository } from '../../repositories/PageGenerationExecutionRepository.js';
import type {
  FailedPageGenerationJobMissingRefund,
  PageGenerationRecoveryRepository,
  StalePageGenerationJob,
} from '../../repositories/PageGenerationRecoveryRepository.js';

export interface PageGenerationRecoveryServicePort {
  recoverAllStaleJobs(): Promise<number>;
  recoverStaleJobsForPage(userId: string, pageId: string): Promise<number>;
}

export class NoopPageGenerationRecoveryService implements PageGenerationRecoveryServicePort {
  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForPage(): Promise<number> {
    return 0;
  }
}

/**
 * Restores page state and refunds credits for page generation jobs that were
 * queued or claimed by a worker process but never completed, typically due to
 * local process termination or machine restarts.
 */
export class PageGenerationRecoveryService implements PageGenerationRecoveryServicePort {
  public constructor(
    private readonly recoveryRepository: PageGenerationRecoveryRepository,
    private readonly executionRepository: PageGenerationExecutionRepository,
    private readonly creditService: CreditServicePort,
    private readonly staleAfterMs: number = PAGE_GENERATION_STALE_AFTER_MS,
    private readonly batchLimit: number = GENERATION_RECOVERY_BATCH_LIMIT,
  ) {}

  public async recoverAllStaleJobs(): Promise<number> {
    const jobs = await this.recoveryRepository.listStaleProcessingJobs(this.buildCutoff(), this.batchLimit);
    const recoveredStaleCount = await this.recoverJobs(jobs);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefund(this.batchLimit),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  public async recoverStaleJobsForPage(userId: string, pageId: string): Promise<number> {
    const jobs = await this.recoveryRepository.listStaleProcessingJobsForPage(
      userId,
      pageId,
      this.buildCutoff(),
      this.batchLimit,
    );
    const recoveredStaleCount = await this.recoverJobs(jobs);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefundForPage(userId, pageId, this.batchLimit),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  private buildCutoff(): Date {
    return new Date(Date.now() - this.staleAfterMs);
  }

  private async recoverJobs(jobs: StalePageGenerationJob[]): Promise<number> {
    let recoveredCount = 0;

    for (const job of jobs) {
      const recovered = await this.executionRepository.failPageGeneration({
        jobId: job.jobId,
        userId: job.userId,
        errorMessage: 'Page generation worker stopped before completion; recovered stale queued or processing job',
        pageId: job.pageId,
        previousStatus: job.previousStatus,
        previousGenerationMode: job.previousGenerationMode,
      });

      if (!recovered) {
        continue;
      }

      if (job.creditCost > 0) {
        await this.creditService.refundCredits({
          userId: job.userId,
          amount: job.creditCost,
          description: 'Refund for stale page generation job',
          jobId: job.jobId,
        });
      }

      recoveredCount += 1;
      console.warn(
        `[page-generation-recovery] recovered stale job ${job.jobId} for page ${job.pageId} stale since ${job.staleAt.toISOString()}`,
      );
    }

    return recoveredCount;
  }

  private async refundFailedJobsMissingRefund(
    jobs: FailedPageGenerationJobMissingRefund[],
  ): Promise<number> {
    let refundedCount = 0;

    for (const job of jobs) {
      if (job.creditCost <= 0) {
        continue;
      }

      await this.creditService.refundCredits({
        userId: job.userId,
        amount: job.creditCost,
        description: 'Refund for failed page generation job missing refund ledger',
        jobId: job.jobId,
      });

      refundedCount += 1;
      console.warn(
        `[page-generation-recovery] refunded failed job ${job.jobId} for page ${job.pageId} completed at ${job.completedAt?.toISOString() ?? 'unknown'}`,
      );
    }

    return refundedCount;
  }
}
