import {
  ENTITY_GENERATION_STALE_AFTER_MS,
  GENERATION_RECOVERY_BATCH_LIMIT,
} from '../../domain/constants/generation.js';
import type { EntityGenerationExecutionRepository } from '../../repositories/EntityGenerationExecutionRepository.js';
import type {
  EntityGenerationRecoveryRepository,
  FailedEntityGenerationJobMissingRefund,
  StaleEntityGenerationJob,
} from '../../repositories/EntityGenerationRecoveryRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type {
  GenerationJobCancellationControlRepository,
} from '../../repositories/GenerationJobRepository.js';

export interface EntityGenerationRecoveryServicePort {
  recoverAllStaleJobs(): Promise<number>;
  recoverStaleJobsForEntity(userId: string, entityId: string, organizationId?: string | null): Promise<number>;
}

export class NoopEntityGenerationRecoveryService implements EntityGenerationRecoveryServicePort {
  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForEntity(): Promise<number> {
    return 0;
  }
}

/**
 * Reclaims entity reference jobs that were queued or claimed by a local/queue
 * worker but never reached completed/failed, usually after a process restart.
 */
export class EntityGenerationRecoveryService implements EntityGenerationRecoveryServicePort {
  public constructor(
    private readonly recoveryRepository: EntityGenerationRecoveryRepository,
    private readonly executionRepository: EntityGenerationExecutionRepository,
    private readonly creditService: CreditServicePort,
    private readonly staleAfterMs: number = ENTITY_GENERATION_STALE_AFTER_MS,
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

  public async recoverStaleJobsForEntity(
    userId: string,
    entityId: string,
    organizationId: string | null = null,
  ): Promise<number> {
    const staleBefore = this.buildCutoff();
    const jobs = await this.recoveryRepository.listStaleProcessingJobsForEntity(
      userId,
      entityId,
      staleBefore,
      this.batchLimit,
      organizationId,
    );
    const recoveredStaleCount = await this.recoverJobs(jobs, staleBefore);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefundForEntity(
        userId,
        entityId,
        this.batchLimit,
        organizationId,
      ),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  private buildCutoff(): Date {
    return new Date(Date.now() - this.staleAfterMs);
  }

  private async recoverJobs(jobs: StaleEntityGenerationJob[], staleBefore: Date): Promise<number> {
    let recoveredCount = 0;

    for (const job of jobs) {
      if (job.cancellationRequested === true && this.cancellationControl !== undefined) {
        try {
          if (await this.cancellationControl.finalizeCancellation(job.jobId)) {
            recoveredCount += 1;
          }
        } catch (error) {
          console.error(`[entity-generation-recovery] failed to settle cancelled job ${job.jobId}`, error);
        }
        continue;
      }

      let recovered = false;
      try {
        recovered = await this.executionRepository.failEntityGeneration({
          jobId: job.jobId,
          userId: job.userId,
          errorMessage: 'Entity reference generation worker stopped before completion; recovered stale queued or processing job',
          staleBefore,
        });
      } catch (error) {
        console.error(`[entity-generation-recovery] failed to transition stale job ${job.jobId}`, error);
        continue;
      }

      if (!recovered) {
        continue;
      }

      recoveredCount += 1;
      if (job.creditCost > 0) {
        try {
          await this.refundJobCredits(
            job.organizationId ?? null,
            job.userId,
            job.creditCost,
            job.jobId,
            'Refund for stale entity generation job',
          );
        } catch (error) {
          console.error(`[entity-generation-recovery] deferred refund for stale job ${job.jobId}`, error);
        }
      }
      console.warn(
        `[entity-generation-recovery] recovered stale job ${job.jobId} for entity ${job.entityId} stale since ${job.staleAt.toISOString()}`,
      );
    }

    return recoveredCount;
  }

  private async refundFailedJobsMissingRefund(
    jobs: FailedEntityGenerationJobMissingRefund[],
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
          'Refund for failed entity generation job missing refund ledger',
        );
      } catch (error) {
        console.error(`[entity-generation-recovery] failed refund remains pending for job ${job.jobId}`, error);
        continue;
      }

      refundedCount += 1;
      console.warn(
        `[entity-generation-recovery] refunded failed job ${job.jobId} for entity ${job.entityId} completed at ${job.completedAt?.toISOString() ?? 'unknown'}`,
      );
    }

    return refundedCount;
  }

  private async refundJobCredits(
    organizationId: string | null,
    userId: string,
    amount: number,
    jobId: string,
    description: string,
  ): Promise<void> {
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId,
        amount,
        description,
        jobId,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new Error('Organization service is required to refund enterprise entity generation jobs');
    }

    await this.organizationService.refundCredits({
      organizationId,
      actorUserId: userId,
      amount,
      description,
      jobId,
    });
  }
}
