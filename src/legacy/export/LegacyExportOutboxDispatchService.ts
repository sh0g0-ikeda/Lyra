import type { LegacyExportJobRepositoryPort } from './LegacyEpisodeExportJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { LegacyExportJobQueuePort } from './LegacyExportJobQueue.js';

/** Re-dispatches committed export outbox rows after transient queue failures. */
export class LegacyExportOutboxDispatchService {
  public constructor(private readonly repository: LegacyExportJobRepositoryPort, private readonly queue: LegacyExportJobQueuePort) {}
  public async dispatchPending(limit = 25): Promise<{ dispatched: number; failed: number }> {
    const jobs = await this.repository.listUndispatched(limit);
    let dispatched = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const queued = await this.queue.enqueue({ jobId: job.id });
        await this.repository.markDispatched(job.id, queued.messageId);
        dispatched += 1;
      } catch (error) {
        await this.repository.markDispatchFailure(job.id, sanitizePersistedErrorMessage(error, 'Export dispatch failed'));
        failed += 1;
      }
    }
    return { dispatched, failed };
  }
}
