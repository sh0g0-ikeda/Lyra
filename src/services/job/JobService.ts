import { NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from '../entity/EntityGenerationRecoveryService.js';
import {
  NoopPageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from '../page/PageGenerationRecoveryService.js';

export interface JobServicePort {
  getJob(userId: string, jobId: string): Promise<GenerationJob>;
}

export class JobService implements JobServicePort {
  public constructor(
    private readonly generationJobRepository: GenerationJobRepository,
    private readonly pageGenerationRecoveryService: PageGenerationRecoveryServicePort = new NoopPageGenerationRecoveryService(),
    private readonly entityGenerationRecoveryService: EntityGenerationRecoveryServicePort = new NoopEntityGenerationRecoveryService(),
  ) {}

  public async getJob(userId: string, jobId: string): Promise<GenerationJob> {
    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId);
    if (job === null) {
      throw new NotFoundError('Job not found');
    }

    if (job.status !== 'queued' && job.status !== 'processing') {
      return job;
    }

    const recovered = await this.recoverStaleProcessingJob(userId, job);
    if (!recovered) {
      return job;
    }

    return (await this.generationJobRepository.findByIdAndUserId(jobId, userId)) ?? job;
  }

  private async recoverStaleProcessingJob(userId: string, job: GenerationJob): Promise<boolean> {
    if (job.jobType === 'page_generate') {
      const pageId = readStringParam(job.params, 'page_id');
      if (pageId === null) {
        return false;
      }

      return (await this.pageGenerationRecoveryService.recoverStaleJobsForPage(userId, pageId)) > 0;
    }

    if (job.jobType === 'episode_story_autofill') {
      return false;
    }

    const entityId = readStringParam(job.params, 'entity_id');
    if (entityId === null) {
      return false;
    }

    return (await this.entityGenerationRecoveryService.recoverStaleJobsForEntity(userId, entityId)) > 0;
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
