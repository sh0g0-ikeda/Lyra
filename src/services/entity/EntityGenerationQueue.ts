import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { EntityGenerationQueuePayload } from '../../domain/types/entityReference.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';

export interface EnqueueEntityGenerationResult {
  messageId: string | null;
}

export interface EntityGenerationQueuePort {
  enqueue(payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult>;
}

export interface EntityGenerationJobProcessor {
  processJob(jobId: string): Promise<unknown>;
}

export class UnconfiguredEntityGenerationQueue implements EntityGenerationQueuePort {
  public async enqueue(_payload: EntityGenerationQueuePayload): Promise<never> {
    throw new ConfigurationError(
      'Entity generation queue is not configured. Set SQS_QUEUE_URL_GENERATION for queued workers or LOCAL_FILE_STORAGE_DIR for local worker execution.',
    );
  }
}

export class InlineEntityGenerationQueueAdapter implements EntityGenerationQueuePort {
  public constructor(private readonly processor: EntityGenerationJobProcessor) {}

  public async enqueue(payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult> {
    const messageId = `inline-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch((error: unknown) => {
        console.error('[entity-generation-inline-worker] failed to process job', {
          jobId: payload.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 0);

    return { messageId };
  }
}

export class SqsEntityGenerationQueueAdapter implements EntityGenerationQueuePort {
  public constructor(private readonly queue: SqsGenerationQueue) {}

  public async enqueue(payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult> {
    return this.queue.enqueueJob({
      jobId: payload.jobId,
      jobType: 'entity_generate',
    });
  }
}
