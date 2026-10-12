import { randomUUID } from 'node:crypto';
import { AppError, ConfigurationError, ConflictError, ValidationError } from '../../domain/errors/index.js';
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
import { toJobPresentation } from '../job/JobPresentation.js';

export interface EpisodeStoryAutofillJobRepository
  extends Pick<GenerationJobRepository, 'create' | 'attachQueueMessageId' | 'markFailed'> {
  finalizeCancellation(jobId: string): Promise<boolean>;
  findActiveEpisodeStoryAutofillJob(
    userId: string,
    episodeId: string,
    organizationId?: string | null,
  ): Promise<GenerationJob | null>;
}

export interface EnqueueEpisodeStoryAutofillResult {
  jobId: string;
}

export interface EpisodeStoryAutofillOptions {
  stateAutofillEnabled?: boolean;
  stateAutofillVersion?: 'v1';
  stateAssignmentPolicy?: 'preserve_existing' | 'overwrite_existing';
}

export interface EpisodeStoryAutofillServicePort {
  enqueueEpisodeStoryAutofill(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    organizationId?: string | null,
    options?: EpisodeStoryAutofillOptions,
  ): Promise<EnqueueEpisodeStoryAutofillResult>;
  retryEpisodeStoryAutofill(
    userId: string,
    sourceJob: GenerationJob,
  ): Promise<EnqueueEpisodeStoryAutofillResult>;
}

type StateAutofillOrigin = 'server_default' | 'request_enabled' | 'request_disabled';

type NormalizedStateAutofill =
  | { enabled: false; origin: Extract<StateAutofillOrigin, 'request_disabled'> }
  | {
      enabled?: true;
      origin?: Exclude<StateAutofillOrigin, 'request_disabled'>;
      stateAssignmentPolicy: 'preserve_existing' | 'overwrite_existing';
    };

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
    private readonly stateAutofillV1Enabled = false,
    private readonly stateAutofillDefaultEnabled = false,
  ) {}

  public async enqueueEpisodeStoryAutofill(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    organizationId: string | null = null,
    options: EpisodeStoryAutofillOptions = {},
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    const stateAutofill = normalizeStateAutofillOptions(options, this.stateAutofillDefaultEnabled);
    return this.enqueueNormalized(
      userId,
      episodeId,
      language,
      organizationId,
      stateAutofill,
    );
  }

  public async retryEpisodeStoryAutofill(
    userId: string,
    sourceJob: GenerationJob,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    const retryable = toJobPresentation(sourceJob, false).retryable === true;
    if (sourceJob.jobType !== 'episode_story_autofill'
      || sourceJob.status !== 'failed'
      || !retryable) {
      throw new ConflictError('Episode story autofill job cannot be retried');
    }
    const episodeId = readRequiredStringParam(sourceJob.params, 'episode_id');
    const language = readLanguageParam(sourceJob.params);
    const stateAutofill = readRetryStateAutofill(sourceJob.params, this.stateAutofillDefaultEnabled);
    return this.enqueueNormalized(
      userId,
      episodeId,
      language,
      sourceJob.organizationId ?? null,
      stateAutofill,
    );
  }

  private async enqueueNormalized(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    organizationId: string | null,
    stateAutofill: NormalizedStateAutofill | null,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    if (stateAutofill !== null && !this.stateAutofillV1Enabled) {
      if (stateAutofill.enabled !== false) {
        throw new ConflictError('Episode state autofill v1 is not enabled');
      }
    }
    await this.ensureNoActiveJob(userId, episodeId, organizationId);

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
          ...(stateAutofill === null ? {} : stateAutofill.enabled === false ? {
            state_autofill_enabled: false,
            state_autofill_origin: stateAutofill.origin,
          } : {
            ...(stateAutofill.enabled === true ? {
              state_autofill_enabled: true,
              state_autofill_origin: stateAutofill.origin,
            } : {}),
            state_autofill_version: 'v1',
            state_assignment_policy: stateAutofill.stateAssignmentPolicy,
          }),
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
      if (activeJob.cancelRequestedAt !== null && activeJob.commitStartedAt === null) {
        const cancelled = await this.generationJobRepository.finalizeCancellation(activeJob.id);
        if (cancelled) {
          return;
        }
      }
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

function normalizeStateAutofillOptions(
  options: EpisodeStoryAutofillOptions,
  defaultEnabled: boolean,
): NormalizedStateAutofill | null {
  if (options.stateAutofillEnabled !== undefined
    && (options.stateAutofillVersion !== undefined || options.stateAssignmentPolicy !== undefined)) {
    throw new ValidationError('stateAutofillEnabled cannot be combined with version or policy');
  }
  if (options.stateAutofillEnabled === false) {
    return { enabled: false, origin: 'request_disabled' };
  }
  if (options.stateAutofillEnabled === true) {
    return {
      enabled: true,
      origin: 'request_enabled',
      stateAssignmentPolicy: 'overwrite_existing',
    };
  }
  if (options.stateAutofillVersion !== 'v1') {
    if (options.stateAssignmentPolicy !== undefined) {
      throw new ValidationError('stateAssignmentPolicy requires stateAutofillVersion=v1');
    }
    return defaultEnabled
      ? {
          enabled: true,
          origin: 'server_default',
          stateAssignmentPolicy: 'overwrite_existing',
        }
      : null;
  }
  return {
    stateAssignmentPolicy: options.stateAssignmentPolicy ?? 'preserve_existing',
  };
}

function readRetryStateAutofill(
  params: Record<string, unknown>,
  defaultEnabled: boolean,
): NormalizedStateAutofill | null {
  const enabled = params.state_autofill_enabled;
  const origin = params.state_autofill_origin;
  const version = params.state_autofill_version;
  const policy = params.state_assignment_policy;
  if (enabled === false) {
    if (origin !== 'request_disabled' || version !== undefined || policy !== undefined) {
      throw new ConflictError('Episode story autofill job has invalid state options');
    }
    return { enabled: false, origin };
  }
  if (enabled === true) {
    if ((origin !== 'server_default' && origin !== 'request_enabled')
      || version !== 'v1'
      || (policy !== 'preserve_existing' && policy !== 'overwrite_existing')) {
      throw new ConflictError('Episode story autofill job has invalid state options');
    }
    return { enabled: true, origin, stateAssignmentPolicy: policy };
  }
  if (enabled !== undefined || origin !== undefined) {
    throw new ConflictError('Episode story autofill job has invalid state options');
  }
  if (version === undefined && policy === undefined) {
    return normalizeStateAutofillOptions({}, defaultEnabled);
  }
  if (version !== 'v1' || (policy !== 'preserve_existing' && policy !== 'overwrite_existing')) {
    throw new ConflictError('Episode story autofill job has invalid state options');
  }
  return { stateAssignmentPolicy: policy };
}

function readRequiredStringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConflictError('Episode story autofill job is missing required params');
  }
  return value;
}

function readLanguageParam(params: Record<string, unknown>): AppLanguage {
  const language = params.language;
  if (language !== 'ja' && language !== 'en') {
    throw new ConflictError('Episode story autofill job is missing required params');
  }
  return language;
}
