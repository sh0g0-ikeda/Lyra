import { ConflictError, NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import type { ProcessPageGenerationJobResult } from './PageGenerationWorkerService.js';

export const MAX_PAGE_GENERATION_RETRIES = 3;

export interface PageGenerationRetryWorkerPort {
  processJob(jobId: string): Promise<ProcessPageGenerationJobResult>;
}

export interface PageGenerationRetryServicePort {
  retryFailedJob(jobId: string): Promise<void>;
}

export class PageGenerationRetryService implements PageGenerationRetryServicePort {
  public constructor(
    private readonly generationJobRepository: GenerationJobRepository,
    private readonly pageGenerationWorkerService: PageGenerationRetryWorkerPort,
  ) {}

  public async retryFailedJob(jobId: string): Promise<void> {
    const job = await this.generationJobRepository.findById(jobId);
    if (job === null) {
      throw new NotFoundError('Generation job not found');
    }

    if (job.jobType !== 'page_generate') {
      throw new ConflictError('Only page generation jobs can be retried');
    }

    if (job.status !== 'failed') {
      throw new ConflictError('Only failed jobs can be retried');
    }

    const prepared = await this.generationJobRepository.prepareRetry(jobId, MAX_PAGE_GENERATION_RETRIES);
    if (!prepared) {
      throw new ConflictError('Generation job exceeded retry limit');
    }

    await this.pageGenerationWorkerService.processJob(jobId);
  }
}
