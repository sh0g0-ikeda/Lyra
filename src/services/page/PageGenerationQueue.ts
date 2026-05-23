import { randomUUID } from 'node:crypto';
import type { PageGenerationQueuePayload } from '../../domain/types/pageGeneration.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';

export interface EnqueuePageGenerationResult {
  messageId: string | null;
}

export interface PageGenerationQueuePort {
  enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult>;
}

export interface PageGenerationJobProcessor {
  processJob(jobId: string): Promise<unknown>;
}

export class NoopPageGenerationQueue implements PageGenerationQueuePort {
  public async enqueue(_payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    return {
      messageId: `noop-${randomUUID()}`,
    };
  }
}

export class InlinePageGenerationQueueAdapter implements PageGenerationQueuePort {
  public constructor(private readonly processor: PageGenerationJobProcessor) {}

  public async enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    const messageId = `inline-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch(() => undefined);
    }, 0);

    return { messageId };
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
