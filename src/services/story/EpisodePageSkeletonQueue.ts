import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';

export interface EpisodePageSkeletonQueuePayload {
  jobId: string;
}

export interface EnqueueEpisodePageSkeletonResult {
  messageId: string | null;
}

export interface EpisodePageSkeletonQueuePort {
  enqueue(payload: EpisodePageSkeletonQueuePayload): Promise<EnqueueEpisodePageSkeletonResult>;
}

export interface EpisodePageSkeletonJobProcessor {
  processJob(jobId: string): Promise<unknown>;
}

export class UnconfiguredEpisodePageSkeletonQueue implements EpisodePageSkeletonQueuePort {
  public async enqueue(): Promise<never> {
    throw new ConfigurationError(
      'Episode page skeleton queue is not configured. Set SQS_QUEUE_URL_GENERATION for queued workers or LOCAL_FILE_STORAGE_DIR for local worker execution.',
    );
  }
}

export class InlineEpisodePageSkeletonQueueAdapter implements EpisodePageSkeletonQueuePort {
  public constructor(private readonly processor: EpisodePageSkeletonJobProcessor) {}

  public async enqueue(
    payload: EpisodePageSkeletonQueuePayload,
  ): Promise<EnqueueEpisodePageSkeletonResult> {
    const messageId = `inline-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch((error: unknown) => {
        console.error('[episode-page-skeleton-inline-worker] failed to process job', {
          jobId: payload.jobId,
          error: sanitizePersistedErrorMessage(error, 'Episode page skeleton inline worker failed'),
        });
      });
    }, 0);

    return { messageId };
  }
}

export class SqsEpisodePageSkeletonQueueAdapter implements EpisodePageSkeletonQueuePort {
  public constructor(private readonly queue: SqsGenerationQueue) {}

  public async enqueue(
    payload: EpisodePageSkeletonQueuePayload,
  ): Promise<EnqueueEpisodePageSkeletonResult> {
    return this.queue.enqueueJob({
      jobId: payload.jobId,
      jobType: 'episode_page_skeleton',
    });
  }
}
