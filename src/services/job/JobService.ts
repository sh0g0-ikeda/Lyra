import { EPISODE_LONG_JOB_STALE_AFTER_MS } from '../../domain/constants/generation.js';
import { ConflictError, NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type {
  GenerationJobCancellationRepository,
  GenerationJobRepository,
} from '../../repositories/GenerationJobRepository.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from '../entity/EntityGenerationRecoveryService.js';
import {
  NoopPageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from '../page/PageGenerationRecoveryService.js';
import {
  EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
  isStaleEpisodeLongJob,
} from '../story/EpisodeLongJobStalePolicy.js';

export interface JobServicePort {
  getJob(userId: string, jobId: string, organizationId?: string | null): Promise<GenerationJob>;
  cancelJob(userId: string, jobId: string, organizationId?: string | null): Promise<GenerationJob>;
}

export class JobService implements JobServicePort {
  public constructor(
    private readonly generationJobRepository: GenerationJobRepository & GenerationJobCancellationRepository,
    private readonly pageGenerationRecoveryService: PageGenerationRecoveryServicePort = new NoopPageGenerationRecoveryService(),
    private readonly entityGenerationRecoveryService: EntityGenerationRecoveryServicePort = new NoopEntityGenerationRecoveryService(),
    private readonly episodeLongJobStaleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly cancellationEnabled = true,
  ) {}

  public async getJob(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob> {
    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId, organizationId);
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

    return (
      await this.generationJobRepository.findByIdAndUserId(jobId, userId, organizationId)
    ) ?? job;
  }

  public async cancelJob(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob> {
    if (!this.cancellationEnabled) {
      throw new ConflictError('Job cancellation is temporarily unavailable');
    }

    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId, organizationId);
    if (job === null) {
      throw new NotFoundError('Job not found');
    }
    if (job.jobType !== 'episode_story_autofill') {
      throw new ConflictError('This job cannot be stopped');
    }
    if (job.status === 'cancelled') {
      return job;
    }
    if (job.status === 'completed' || job.status === 'failed') {
      throw new ConflictError('This job has already finished');
    }
    if (job.commitStartedAt !== null) {
      throw new ConflictError('This job is already saving its result and cannot be stopped');
    }

    const cancelled = await this.generationJobRepository.requestCancellation(
      jobId,
      userId,
      organizationId,
    );
    if (cancelled !== null) {
      return cancelled;
    }

    const current = await this.generationJobRepository.findByIdAndUserId(
      jobId,
      userId,
      organizationId,
    );
    if (current === null) {
      throw new NotFoundError('Job not found');
    }
    if (current.status === 'cancelled') {
      return current;
    }
    throw new ConflictError('This job is already saving its result or has finished');
  }

  private async recoverStaleActiveJob(userId: string, job: GenerationJob): Promise<boolean> {
    if (job.jobType === 'page_generate') {
      const pageId = readStringParam(job.params, 'page_id');
      if (pageId === null) {
        return false;
      }

      return (
        await this.pageGenerationRecoveryService.recoverStaleJobsForPage(
          userId,
          pageId,
          job.organizationId ?? null,
        )
      ) > 0;
    }

    if (job.jobType === 'episode_story_autofill' || job.jobType === 'episode_page_skeleton') {
      return this.recoverStaleEpisodeLongJob(job);
    }

    const entityId = readStringParam(job.params, 'entity_id');
    if (entityId === null) {
      return false;
    }

    return (
      await this.entityGenerationRecoveryService.recoverStaleJobsForEntity(
        userId,
        entityId,
        job.organizationId ?? null,
      )
    ) > 0;
  }

  private async recoverStaleEpisodeLongJob(job: GenerationJob): Promise<boolean> {
    if (!isStaleEpisodeLongJob(job, this.now(), this.episodeLongJobStaleAfterMs)) {
      return false;
    }

    if (
      job.jobType === 'episode_story_autofill' &&
      job.cancelRequestedAt !== null &&
      job.commitStartedAt === null
    ) {
      return this.generationJobRepository.finalizeCancellation(job.id);
    }

    return this.generationJobRepository.markFailed(
      job.id,
      EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
    );
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
