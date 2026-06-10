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

export interface EntityGenerationRecoveryServicePort {
  recoverAllStaleJobs(): Promise<number>;
  recoverStaleJobsForEntity(userId: string, entityId: string): Promise<number>;
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
  ) {}

  public async recoverAllStaleJobs(): Promise<number> {
    const jobs = await this.recoveryRepository.listStaleProcessingJobs(this.buildCutoff(), this.batchLimit);
    const recoveredStaleCount = await this.recoverJobs(jobs);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefund(this.batchLimit),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  public async recoverStaleJobsForEntity(userId: string, entityId: string): Promise<number> {
    const jobs = await this.recoveryRepository.listStaleProcessingJobsForEntity(
      userId,
      entityId,
      this.buildCutoff(),
      this.batchLimit,
    );
    const recoveredStaleCount = await this.recoverJobs(jobs);
    const refundedFailedCount = await this.refundFailedJobsMissingRefund(
      await this.recoveryRepository.listFailedJobsMissingRefundForEntity(userId, entityId, this.batchLimit),
    );
    return recoveredStaleCount + refundedFailedCount;
  }

  private buildCutoff(): Date {
    return new Date(Date.now() - this.staleAfterMs);
  }

  private async recoverJobs(jobs: StaleEntityGenerationJob[]): Promise<number> {
    let recoveredCount = 0;

    for (const job of jobs) {
      const recovered = await this.executionRepository.failEntityGeneration({
        jobId: job.jobId,
        userId: job.userId,
        errorMessage: 'Entity reference generation worker stopped before completion; recovered stale queued or processing job',
      });

      if (!recovered) {
        continue;
      }

      if (job.creditCost > 0) {
        await this.creditService.refundCredits({
          userId: job.userId,
          amount: job.creditCost,
          description: 'Refund for stale entity generation job',
          jobId: job.jobId,
        });
      }

      recoveredCount += 1;
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

      await this.creditService.refundCredits({
        userId: job.userId,
        amount: job.creditCost,
        description: 'Refund for failed entity generation job missing refund ledger',
        jobId: job.jobId,
      });

      refundedCount += 1;
      console.warn(
        `[entity-generation-recovery] refunded failed job ${job.jobId} for entity ${job.entityId} completed at ${job.completedAt?.toISOString() ?? 'unknown'}`,
      );
    }

    return refundedCount;
  }
}
