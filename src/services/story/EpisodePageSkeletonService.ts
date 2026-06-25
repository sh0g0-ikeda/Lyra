import { randomUUID } from 'node:crypto';
import { AppError, ConfigurationError, ConflictError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import {
  isUniqueViolation,
  type GenerationJob,
  type GenerationJobRepository,
} from '../../repositories/GenerationJobRepository.js';
import { EPISODE_LONG_JOB_STALE_AFTER_MS } from '../../domain/constants/generation.js';
import type { EpisodePageSkeletonQueuePort } from './EpisodePageSkeletonQueue.js';
import {
  EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
  isStaleEpisodeLongJob,
} from './EpisodeLongJobStalePolicy.js';

export interface EpisodePageSkeletonJobRepository
  extends Pick<GenerationJobRepository, 'create' | 'attachQueueMessageId' | 'markFailed'> {
  findActiveEpisodePageSkeletonJob(userId: string, episodeId: string): Promise<GenerationJob | null>;
}

export interface EnqueueEpisodePageSkeletonInput {
  overwriteExisting: boolean;
  applyStoryPlan: boolean;
  language: AppLanguage;
}

export interface EnqueueEpisodePageSkeletonResult {
  jobId: string;
}

export interface EpisodePageSkeletonServicePort {
  enqueueEpisodePageSkeleton(
    userId: string,
    episodeId: string,
    input: EnqueueEpisodePageSkeletonInput,
  ): Promise<EnqueueEpisodePageSkeletonResult>;
}

/**
 * Queues page skeleton generation so long story AI calls do not hold an HTTP
 * request open and produce 504s.
 */
export class EpisodePageSkeletonService implements EpisodePageSkeletonServicePort {
  public constructor(
    private readonly generationJobRepository: EpisodePageSkeletonJobRepository,
    private readonly queue: EpisodePageSkeletonQueuePort,
    private readonly episodeLongJobStaleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async enqueueEpisodePageSkeleton(
    userId: string,
    episodeId: string,
    input: EnqueueEpisodePageSkeletonInput,
  ): Promise<EnqueueEpisodePageSkeletonResult> {
    await this.ensureNoActiveJob(userId, episodeId);

    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        jobType: 'episode_page_skeleton',
        generationMode: null,
        creditCost: 0,
        params: {
          episode_id: episodeId,
          overwrite_existing: input.overwriteExisting,
          apply_story_plan: input.applyStoryPlan,
          language: input.language,
        },
      });
      createdJobId = job.id;

      const enqueueResult = await this.queue.enqueue({ jobId: job.id });
      if (enqueueResult.messageId !== null) {
        await this.persistQueueMessageId(job.id, enqueueResult.messageId);
      }

      return { jobId: job.id };
    } catch (error) {
      if (createdJobId !== null) {
        await this.generationJobRepository.markFailed(
          createdJobId,
          'Failed to enqueue episode page skeleton job',
        );
      }

      if (error instanceof AppError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new ConflictError('Episode page skeleton generation is already queued or processing');
      }

      throw new ConfigurationError('Failed to enqueue episode page skeleton job');
    }
  }

  private async ensureNoActiveJob(userId: string, episodeId: string): Promise<void> {
    const activeJob = await this.generationJobRepository.findActiveEpisodePageSkeletonJob(
      userId,
      episodeId,
    );
    if (activeJob === null) {
      return;
    }

    if (isStaleEpisodeLongJob(activeJob, this.now(), this.episodeLongJobStaleAfterMs)) {
      const recovered = await this.generationJobRepository.markFailed(
        activeJob.id,
        EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
      );
      if (recovered) {
        return;
      }
    }

    throw new ConflictError('Episode page skeleton generation is already queued or processing');
  }

  private async persistQueueMessageId(jobId: string, messageId: string): Promise<void> {
    try {
      await this.generationJobRepository.attachQueueMessageId(jobId, messageId);
    } catch {
      // The queue already accepted the job. Missing metadata must not turn the
      // accepted background task into a user-visible enqueue failure.
    }
  }
}
