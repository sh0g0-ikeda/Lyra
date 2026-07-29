import type { ExportJobRepository } from '../../repositories/ExportJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { ExportJobQueuePort } from './ExportJobQueue.js';

/** Re-dispatches committed export outbox rows after transient queue failures. */
export class ExportOutboxDispatchService {
  public constructor(private readonly repository: ExportJobRepository, private readonly queue: ExportJobQueuePort) {}
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
