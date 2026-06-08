import { randomUUID } from 'node:crypto';
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

export class NoopEntityGenerationQueue implements EntityGenerationQueuePort {
  public async enqueue(_payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult> {
    return {
      messageId: `noop-${randomUUID()}`,
    };
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
