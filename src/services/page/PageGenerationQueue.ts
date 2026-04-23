import { randomUUID } from 'node:crypto';
import type { PageGenerationQueuePayload } from '../../domain/types/pageGeneration.js';

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
