import { randomUUID } from 'node:crypto';
import type { EntityGenerationQueuePayload } from '../../domain/types/entityReference.js';

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
