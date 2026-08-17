import { randomUUID } from 'node:crypto';
import {
  AppError,
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
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
  findActiveEpisodeStoryAutofillJob(
    userId: string,
    episodeId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
}

export interface EpisodeStoryAutofillReadinessRepository
  extends Pick<PageRepository, 'findEpisodePlanningContextByIdAndUserId'> {}

export interface EnqueueEpisodeStoryAutofillResult {
  jobId: string;
}

export interface EpisodeStoryAutofillServicePort {
  enqueueEpisodeStoryAutofill(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    organizationId?: string | null,
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
    private readonly readinessRepository: EpisodeStoryAutofillReadinessRepository,
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
    organizationId: string | null = null,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    await this.ensureNoActiveJob(userId, episodeId, organizationId);
    await this.ensureEpisodeReady(userId, episodeId, organizationId);

    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        organizationId,
        jobType: 'episode_story_autofill',
        generationMode: null,
        creditCost: 0,
        params: {
          episode_id: episodeId,
          language,
          organization_id: organizationId,
        },
        capacityLimits: this.capacityLimits,
      });
      createdJobId = job.id;

      const enqueueResult = await this.queue.enqueue({
        jobId: job.id,
        userId,
        organizationId,
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

  private async ensureEpisodeReady(
    userId: string,
    episodeId: string,
    organizationId: string | null,
  ): Promise<void> {
    const context = await this.readinessRepository.findEpisodePlanningContextByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }
    if (context.pages.length === 0) {
      throw new ValidationError('Episode must have pages before story autofill can run');
    }
    if (context.pages.length > STORY_AI_LIMITS.maxSkeletonPages) {
      throw new ValidationError(
        `Episode story autofill supports at most ${STORY_AI_LIMITS.maxSkeletonPages} pages`,
      );
    }

    for (const page of context.pages) {
      if (page.status === 'generating') {
        throw new ValidationError('Pages cannot story autofill while generation is in progress');
      }
      if (page.status === 'confirmed') {
        throw new ValidationError('Confirmed pages must be reopened before story autofill');
      }
      if (page.frameCount <= 0) {
        throw new ValidationError('All pages must have frames before story autofill can run');
      }
      if (page.panels.length !== page.frameCount) {
        throw new ValidationError('コマ割りを先に合わせてください');
      }
    }
  }

  private async ensureNoActiveJob(userId: string, episodeId: string, organizationId: string | null): Promise<void> {
    const activeJob = await this.generationJobRepository.findActiveEpisodeStoryAutofillJob(
      userId,
      episodeId,
      organizationId,
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
