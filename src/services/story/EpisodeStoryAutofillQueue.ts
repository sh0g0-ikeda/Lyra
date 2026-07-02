import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';

export interface EpisodeStoryAutofillQueuePayload {
  jobId: string;
  userId: string;
  organizationId: string | null;
  episodeId: string;
  language: AppLanguage;
}

export interface EnqueueEpisodeStoryAutofillResult {
  messageId: string | null;
}

export interface EpisodeStoryAutofillQueuePort {
  enqueue(payload: EpisodeStoryAutofillQueuePayload): Promise<EnqueueEpisodeStoryAutofillResult>;
}

export interface EpisodeStoryAutofillJobProcessor {
  processJob(jobId: string): Promise<unknown>;
}

export class UnconfiguredEpisodeStoryAutofillQueue implements EpisodeStoryAutofillQueuePort {
  public async enqueue(_payload: EpisodeStoryAutofillQueuePayload): Promise<never> {
    throw new ConfigurationError(
      'Episode story autofill queue is not configured. Set SQS_QUEUE_URL_GENERATION for queued workers or LOCAL_FILE_STORAGE_DIR for local worker execution.',
    );
  }
}

export class InlineEpisodeStoryAutofillQueueAdapter implements EpisodeStoryAutofillQueuePort {
  public constructor(private readonly processor: EpisodeStoryAutofillJobProcessor) {}

  public async enqueue(
    payload: EpisodeStoryAutofillQueuePayload,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    const messageId = `inline-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch((error: unknown) => {
        console.error('[episode-story-autofill-inline-worker] failed to process job', {
          jobId: payload.jobId,
          error: sanitizePersistedErrorMessage(error, 'Episode story autofill inline worker failed'),
        });
      });
    }, 0);

    return { messageId };
  }
}

export class SqsEpisodeStoryAutofillQueueAdapter implements EpisodeStoryAutofillQueuePort {
  public constructor(private readonly queue: SqsGenerationQueue) {}

  public async enqueue(
    payload: EpisodeStoryAutofillQueuePayload,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    return this.queue.enqueueJob({
      jobId: payload.jobId,
      jobType: 'episode_story_autofill',
    });
  }
}
