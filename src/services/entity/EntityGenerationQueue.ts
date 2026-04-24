import { randomUUID } from 'node:crypto';
import type { EntityGenerationQueuePayload } from '../../domain/types/entityReference.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';

export interface EnqueueEntityGenerationResult {
  messageId: string | null;
}

export interface EntityGenerationQueuePort {
  enqueue(payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult>;
}

export class NoopEntityGenerationQueue implements EntityGenerationQueuePort {
  public async enqueue(_payload: EntityGenerationQueuePayload): Promise<EnqueueEntityGenerationResult> {
    return {
      messageId: `noop-${randomUUID()}`,
    };
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
