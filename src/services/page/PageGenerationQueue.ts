import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { PageGenerationQueuePayload } from '../../domain/types/pageGeneration.js';
import type { SqsGenerationQueue } from '../../infrastructure/aws/SqsGenerationQueue.js';
import type { WorkerProcessLauncher } from '../../infrastructure/local/DetachedWorkerProcessLauncher.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';

export interface EnqueuePageGenerationResult {
  messageId: string | null;
}

export interface PageGenerationQueuePort {
  enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult>;
}

export interface PageGenerationJobProcessor {
  processJob(jobId: string): Promise<unknown>;
}

export class UnconfiguredPageGenerationQueue implements PageGenerationQueuePort {
  public async enqueue(_payload: PageGenerationQueuePayload): Promise<never> {
    throw new ConfigurationError(
      'Page generation queue is not configured. Set SQS_QUEUE_URL_GENERATION for queued workers or LOCAL_FILE_STORAGE_DIR for local worker execution.',
    );
  }
}

export class InlinePageGenerationQueueAdapter implements PageGenerationQueuePort {
  public constructor(private readonly processor: PageGenerationJobProcessor) {}

  public async enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    const messageId = `inline-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch((error: unknown) => {
        console.error('[page-generation-inline-worker] failed to process job', {
          jobId: payload.jobId,
          error: sanitizePersistedErrorMessage(error, 'Page generation inline worker failed'),
        });
      });
    }, 0);

    return { messageId };
  }
}

export class DetachedProcessPageGenerationQueueAdapter implements PageGenerationQueuePort {
  public constructor(private readonly workerLauncher: WorkerProcessLauncher) {}

  public async enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    const messageId = `local-worker-${randomUUID()}`;
    this.workerLauncher.launch(payload.jobId);
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
