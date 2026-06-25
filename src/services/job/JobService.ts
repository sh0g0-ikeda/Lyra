import { EPISODE_LONG_JOB_STALE_AFTER_MS } from '../../domain/constants/generation.js';
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
    private readonly episodeLongJobStaleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async getJob(userId: string, jobId: string): Promise<GenerationJob> {
    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId);
    if (job === null) {
      throw new NotFoundError('Job not found');
    }

    if (job.status !== 'queued' && job.status !== 'processing') {
      return job;
    }

    const recovered = await this.recoverStaleActiveJob(userId, job);
    if (!recovered) {
      return job;
    }

    return (await this.generationJobRepository.findByIdAndUserId(jobId, userId)) ?? job;
  }

  private async recoverStaleActiveJob(userId: string, job: GenerationJob): Promise<boolean> {
    if (job.jobType === 'page_generate') {
      const pageId = readStringParam(job.params, 'page_id');
      if (pageId === null) {
        return false;
      }

      return (await this.pageGenerationRecoveryService.recoverStaleJobsForPage(userId, pageId)) > 0;
    }

    if (job.jobType === 'episode_story_autofill' || job.jobType === 'episode_page_skeleton') {
      return this.recoverStaleEpisodeLongJob(job);
    }

    const entityId = readStringParam(job.params, 'entity_id');
    if (entityId === null) {
      return false;
    }

    return (await this.entityGenerationRecoveryService.recoverStaleJobsForEntity(userId, entityId)) > 0;
  }

  private async recoverStaleEpisodeLongJob(job: GenerationJob): Promise<boolean> {
    if (!this.isEpisodeLongJobStale(job)) {
      return false;
    }

    return this.generationJobRepository.markFailed(
      job.id,
      'Long-running story/page planning job stopped before completion; recovered stale queued or processing job',
    );
  }

  private isEpisodeLongJobStale(job: GenerationJob): boolean {
    const lastActivity = getLastActivityTime(job);
    return this.now() - lastActivity.getTime() >= this.episodeLongJobStaleAfterMs;
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getLastActivityTime(job: GenerationJob): Date {
  const progressUpdatedAt = readIsoDateParam(job.result, 'progress_updated_at');
  if (progressUpdatedAt !== null) {
    return progressUpdatedAt;
  }

  return job.startedAt ?? job.createdAt;
}

function readIsoDateParam(params: Record<string, unknown> | null, key: string): Date | null {
  if (params === null) {
    return null;
  }

  const value = params[key];
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
