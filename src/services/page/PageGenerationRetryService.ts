import { ConflictError, ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { isUniqueViolation } from '../../repositories/GenerationJobRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type { ProcessPageGenerationJobResult } from './PageGenerationWorkerService.js';
import {
  DEFAULT_GENERATION_CAPACITY_LIMITS,
  type GenerationCapacityLimits,
} from '../generation/GenerationCapacityGuard.js';

export const MAX_PAGE_GENERATION_RETRIES = 3;

export interface PageGenerationRetryWorkerPort {
  processJob(jobId: string): Promise<ProcessPageGenerationJobResult>;
}

export interface PageGenerationRetryServicePort {
  retryFailedJob(userId: string, jobId: string): Promise<void>;
}

export class PageGenerationRetryService implements PageGenerationRetryServicePort {
  public constructor(
    private readonly generationJobRepository: GenerationJobRepository,
    private readonly pageGenerationWorkerService: PageGenerationRetryWorkerPort,
    private readonly creditService: CreditServicePort,
    private readonly capacityLimits: GenerationCapacityLimits = DEFAULT_GENERATION_CAPACITY_LIMITS,
    private readonly organizationService?: OrganizationServicePort,
  ) {}

  public async retryFailedJob(userId: string, jobId: string): Promise<void> {
    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId);
    if (job === null) {
      throw new NotFoundError('Generation job not found');
    }

    if (job.jobType !== 'page_generate') {
      throw new ConflictError('Only page generation jobs can be retried');
    }

    if (job.status !== 'failed') {
      throw new ConflictError('Only failed jobs can be retried');
    }

    let creditsConsumed = false;
    try {
      if (job.creditCost > 0) {
        await this.consumeRetryCredits(userId, job);
        creditsConsumed = true;
      }

      const prepared = await this.generationJobRepository.prepareRetry(
        jobId,
        MAX_PAGE_GENERATION_RETRIES,
        {
          userId,
          organizationId: job.organizationId ?? null,
          capacityLimits: this.capacityLimits,
        },
      );
      if (!prepared) {
        throw new ConflictError('Generation job exceeded retry limit');
      }
    } catch (error) {
      if (creditsConsumed) {
        await this.refundRetryCredits(userId, job);
      }

      if (isUniqueViolation(error)) {
        throw new ConflictError('Page generation is already queued or processing');
      }

      throw error;
    }

    await this.pageGenerationWorkerService.processJob(jobId);
  }

  private async consumeRetryCredits(userId: string, job: GenerationJob): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.consumeCredits({
        userId,
        cost: job.creditCost,
        description: 'Page generation retry',
        jobId: job.id,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required to retry enterprise page generation jobs');
    }

    await this.organizationService.consumeCredits({
      organizationId,
      userId,
      cost: job.creditCost,
      description: 'Page generation retry',
      jobId: job.id,
      eventType: 'generation.started',
    });
  }

  private async refundRetryCredits(userId: string, job: GenerationJob): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId,
        amount: job.creditCost,
        description: 'Refund for failed page generation retry setup',
        jobId: job.id,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required to refund enterprise page generation retries');
    }

    await this.organizationService.refundCredits({
      organizationId,
      actorUserId: userId,
      amount: job.creditCost,
      description: 'Refund for failed page generation retry setup',
      jobId: job.id,
    });
  }
}
