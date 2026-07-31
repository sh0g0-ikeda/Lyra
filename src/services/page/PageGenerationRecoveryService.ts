import {
  GENERATION_RECOVERY_BATCH_LIMIT,
  PAGE_GENERATION_STALE_AFTER_MS,
} from '../../domain/constants/generation.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type { PageGenerationExecutionRepository } from '../../repositories/PageGenerationExecutionRepository.js';
import type {
  FailedPageGenerationJobMissingRefund,
  PageGenerationRecoveryRepository,
  StalePageGenerationJob,
} from '../../repositories/PageGenerationRecoveryRepository.js';
import type {
  GenerationJobCancellationControlRepository,
} from '../../repositories/GenerationJobRepository.js';

export interface PageGenerationRecoveryServicePort {
  recoverAllStaleJobs(): Promise<number>;
  recoverStaleJobsForPage(userId: string, pageId: string, organizationId?: string | null): Promise<number>;
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
    private readonly organizationService?: OrganizationServicePort,
    private readonly cancellationControl?: GenerationJobCancellationControlRepository,
  ) {}

  public async recoverAllStaleJobs(): Promise<number> {
    const staleBefore = this.buildCutoff();
    const jobs = await this.recoveryRepository.listStaleProcessingJobs(staleBefore, this.batchLimit);
    const recoveredStaleCount = await this.recoverJobs(jobs, staleBefore);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefund(this.batchLimit),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  public async recoverStaleJobsForPage(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<number> {
    const staleBefore = this.buildCutoff();
    const jobs = await this.recoveryRepository.listStaleProcessingJobsForPage(
      userId,
      pageId,
      staleBefore,
      this.batchLimit,
      organizationId,
    );
    const recoveredStaleCount = await this.recoverJobs(jobs, staleBefore);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefundForPage(userId, pageId, this.batchLimit, organizationId),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  private buildCutoff(): Date {
    return new Date(Date.now() - this.staleAfterMs);
  }

  private async recoverJobs(jobs: StalePageGenerationJob[], staleBefore: Date): Promise<number> {
    let recoveredCount = 0;

    for (const job of jobs) {
      if (job.cancellationRequested === true && this.cancellationControl !== undefined) {
        try {
          if (await this.cancellationControl.finalizeCancellation(job.jobId)) {
            recoveredCount += 1;
          }
        } catch (error) {
          console.error(`[page-generation-recovery] failed to settle cancelled job ${job.jobId}`, error);
        }
        continue;
      }

      let recovered = false;
      try {
        recovered = await this.executionRepository.failPageGeneration({
          jobId: job.jobId,
          userId: job.userId,
          errorMessage: 'Page generation worker stopped before completion; recovered stale queued or processing job',
          pageId: job.pageId,
          previousStatus: job.previousStatus,
          previousGenerationMode: job.previousGenerationMode,
          organizationId: job.organizationId ?? null,
          staleBefore,
        });
      } catch (error) {
        console.error(`[page-generation-recovery] failed to transition stale job ${job.jobId}`, error);
        continue;
      }

      if (!recovered) {
        continue;
      }

      recoveredCount += 1;
      if (job.creditCost > 0) {
        try {
          await this.refundJobCredits(job.organizationId ?? null, job.userId, job.creditCost, job.jobId, 'Refund for stale page generation job');
        } catch (error) {
          console.error(`[page-generation-recovery] deferred refund for stale job ${job.jobId}`, error);
        }
      }
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

      try {
        await this.refundJobCredits(
          job.organizationId ?? null,
          job.userId,
          job.creditCost,
          job.jobId,
          'Refund for failed page generation job missing refund ledger',
        );
      } catch (error) {
        console.error(`[page-generation-recovery] failed refund remains pending for job ${job.jobId}`, error);
        continue;
      }

      refundedCount += 1;
      console.warn(
        `[page-generation-recovery] refunded failed job ${job.jobId} for page ${job.pageId} completed at ${job.completedAt?.toISOString() ?? 'unknown'}`,
      );
    }

    return refundedCount;
  }

  private async refundJobCredits(
    organizationId: string | null,
    userId: string,
    creditCost: number,
    jobId: string,
    description: string,
  ): Promise<void> {
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId,
        amount: creditCost,
        description,
        jobId,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new Error('Organization service is required to refund enterprise page generation jobs');
    }

    await this.organizationService.refundCredits({
      organizationId,
      actorUserId: userId,
      amount: creditCost,
      description,
      jobId,
    });
  }
}
