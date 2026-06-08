import { ConflictError, NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { ProcessPageGenerationJobResult } from './PageGenerationWorkerService.js';

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
      await this.creditService.consumeCredits({
        userId,
        cost: job.creditCost,
        description: 'Page generation retry',
        jobId: job.id,
      });
      creditsConsumed = true;

      const prepared = await this.generationJobRepository.prepareRetry(jobId, MAX_PAGE_GENERATION_RETRIES);
      if (!prepared) {
        throw new ConflictError('Generation job exceeded retry limit');
      }
    } catch (error) {
      if (creditsConsumed) {
        await this.creditService.refundCredits({
          userId,
          amount: job.creditCost,
          description: 'Refund for failed page generation retry setup',
          jobId: job.id,
        });
      }

      throw error;
    }

    await this.pageGenerationWorkerService.processJob(jobId);
  }
}
