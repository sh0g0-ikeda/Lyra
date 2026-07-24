import { describe, expect, it, vi } from 'vitest';
import { ExportOutboxDispatchService } from '../../../../src/services/export/ExportOutboxDispatchService.js';

describe('ExportOutboxDispatchService', () => {
  it('redelivers durable pending jobs and preserves failed rows for the next retry', async () => {
    const repository = { listUndispatched: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]), markDispatched: vi.fn(), markDispatchFailure: vi.fn() };
    const queue = { enqueue: vi.fn().mockResolvedValueOnce({ messageId: 'm-1' }).mockRejectedValueOnce(new Error('queue temporary failure')) };
    const service = new ExportOutboxDispatchService(repository as never, queue as never);
    await expect(service.dispatchPending()).resolves.toEqual({ dispatched: 1, failed: 1 });
    expect(repository.markDispatched).toHaveBeenCalledWith('job-1', 'm-1');
    expect(repository.markDispatchFailure).toHaveBeenCalledWith('job-2', 'queue temporary failure');
  });
});
