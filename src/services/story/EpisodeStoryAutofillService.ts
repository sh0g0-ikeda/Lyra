import { randomUUID } from 'node:crypto';
import { AppError, ConfigurationError, ConflictError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import {
  isUniqueViolation,
  type GenerationJobCapacityLimits,
  type GenerationJobRepository,
  type GenerationJob,
} from '../../repositories/GenerationJobRepository.js';
import {
  DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS,
  EPISODE_LONG_JOB_ACTIVE_JOB_TYPES,
  EPISODE_LONG_JOB_STALE_AFTER_MS,
} from '../../domain/constants/generation.js';
import type { EpisodeStoryAutofillQueuePort } from './EpisodeStoryAutofillQueue.js';
import {
  EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
  isStaleEpisodeLongJob,
} from './EpisodeLongJobStalePolicy.js';

export interface EpisodeStoryAutofillJobRepository
  extends Pick<GenerationJobRepository, 'create' | 'attachQueueMessageId' | 'markFailed'> {
  findActiveEpisodeStoryAutofillJob(userId: string, episodeId: string): Promise<GenerationJob | null>;
}

export interface EnqueueEpisodeStoryAutofillResult {
  jobId: string;
}

export interface EpisodeStoryAutofillServicePort {
  enqueueEpisodeStoryAutofill(
    userId: string,
    episodeId: string,
    language: AppLanguage,
  ): Promise<EnqueueEpisodeStoryAutofillResult>;
}

/**
 * Persists story-to-page autofill as a zero-credit background job so long LLM
 * planning never holds a browser request open long enough to hit 504.
 */
export class EpisodeStoryAutofillService implements EpisodeStoryAutofillServicePort {
  public constructor(
    private readonly generationJobRepository: EpisodeStoryAutofillJobRepository,
    private readonly queue: EpisodeStoryAutofillQueuePort,
    private readonly episodeLongJobStaleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly capacityLimits: GenerationJobCapacityLimits = {
      perUser: DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.PER_USER,
      global: DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.GLOBAL,
      jobTypes: EPISODE_LONG_JOB_ACTIVE_JOB_TYPES,
    },
  ) {}

  public async enqueueEpisodeStoryAutofill(
    userId: string,
    episodeId: string,
    language: AppLanguage,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    await this.ensureNoActiveJob(userId, episodeId);

    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        jobType: 'episode_story_autofill',
        generationMode: null,
        creditCost: 0,
        params: {
          episode_id: episodeId,
          language,
        },
        capacityLimits: this.capacityLimits,
      });
      createdJobId = job.id;

      const enqueueResult = await this.queue.enqueue({
        jobId: job.id,
        userId,
        episodeId,
        language,
      });
      if (enqueueResult.messageId !== null) {
        await this.persistQueueMessageId(job.id, enqueueResult.messageId);
      }

      return { jobId: job.id };
    } catch (error) {
      if (createdJobId !== null) {
        await this.generationJobRepository.markFailed(
          createdJobId,
          'Failed to enqueue episode story autofill job',
        );
      }

      if (error instanceof AppError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new ConflictError('Episode story autofill is already queued or processing');
      }

      throw new ConfigurationError('Failed to enqueue episode story autofill job');
    }
  }

  private async ensureNoActiveJob(userId: string, episodeId: string): Promise<void> {
    const activeJob = await this.generationJobRepository.findActiveEpisodeStoryAutofillJob(
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

    throw new ConflictError('Episode story autofill is already queued or processing');
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
