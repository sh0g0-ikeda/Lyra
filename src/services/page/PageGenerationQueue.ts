import { randomUUID } from 'node:crypto';
import type { PageGenerationQueuePayload } from '../../domain/types/pageGeneration.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';

export interface EnqueuePageGenerationResult {
  messageId: string | null;
}

export interface PageGenerationQueuePort {
  enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult>;
}

export class NoopPageGenerationQueue implements PageGenerationQueuePort {
  public async enqueue(_payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    return {
      messageId: `noop-${randomUUID()}`,
    };
  }
}

export class SqsPageGenerationQueueAdapter implements PageGenerationQueuePort {
  public constructor(private readonly queue: SqsGenerationQueue) {}

  public async enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    return this.queue.enqueueJob({
      jobId: payload.jobId,
      jobType: 'page_generate',
    });
  }
}
