import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodeExportJobRepository,
} from '../../repositories/EpisodeExportJobRepository.js';

const MAX_DISPATCH_BATCH_SIZE = 100;
const SAFE_DISPATCH_ERROR = 'Episode export dispatch is temporarily unavailable';

export interface EpisodeExportQueuePort {
  enqueue(jobId: string): Promise<{ messageId: string }>;
}

export interface EpisodeExportDispatchPort {
  dispatchJob(jobId: string): Promise<void>;
}

export interface EpisodeExportDispatchBatchResult {
  attemptedCount: number;
  dispatchedCount: number;
  failedCount: number;
}

export class EpisodeExportDispatchService implements EpisodeExportDispatchPort {
  public constructor(
    private readonly repository: EpisodeExportJobRepository,
    private readonly queue: EpisodeExportQueuePort,
  ) {}

  public async dispatchJob(jobId: string): Promise<void> {
    const outbox = await this.repository.findUndispatchedForJob(jobId);
    if (outbox === null) {
      return;
    }

    try {
      const queued = await this.queue.enqueue(outbox.exportJobId);
      await this.repository.markDispatched(outbox.exportJobId, queued.messageId);
    } catch {
      try {
        await this.repository.markDispatchFailure(
          outbox.exportJobId,
          SAFE_DISPATCH_ERROR,
        );
      } catch {
        // The original outbox row remains undispatched and is safe to recover.
      }
      throw new ConfigurationError(SAFE_DISPATCH_ERROR);
    }
  }

  public async dispatchPending(
    limit: number,
  ): Promise<EpisodeExportDispatchBatchResult> {
    assertBatchLimit(limit);
    const pending = await this.repository.listUndispatched(limit);
    let dispatchedCount = 0;
    let failedCount = 0;

    for (const outbox of pending) {
      try {
        await this.dispatchJob(outbox.exportJobId);
        dispatchedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return {
      attemptedCount: pending.length,
      dispatchedCount,
      failedCount,
    };
  }
}

function assertBatchLimit(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_DISPATCH_BATCH_SIZE
  ) {
    throw new ConfigurationError('Episode export dispatch batch limit is invalid');
  }
}
