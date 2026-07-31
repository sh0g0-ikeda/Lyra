import { describe, expect, it } from 'vitest';
import type {
  EpisodeExportJobOutboxRecord,
  EpisodeExportJobRepository,
} from '../../../../src/repositories/EpisodeExportJobRepository.js';
import {
  EpisodeExportDispatchService,
  type EpisodeExportQueuePort,
} from '../../../../src/services/export/EpisodeExportDispatchService.js';

const jobId = '44444444-4444-4444-8444-444444444444';

describe('EpisodeExportDispatchService', () => {
  it('未送信outboxだけをqueue送信後にmessage ID付きで完了する', async () => {
    const repository = new FakeRepository();
    const queue = new FakeQueue();
    const service = new EpisodeExportDispatchService(
      repository as unknown as EpisodeExportJobRepository,
      queue,
    );

    await service.dispatchJob(jobId);

    expect(queue.calls).toEqual([jobId]);
    expect(repository.dispatched).toEqual([{ jobId, messageId: 'message-1' }]);
  });

  it('送信失敗を安全な固定文へ縮約してoutboxを再試行可能にする', async () => {
    const repository = new FakeRepository();
    const queue = new FakeQueue();
    queue.error = new Error('https://sqs.example/secret queue raw detail');
    const service = new EpisodeExportDispatchService(
      repository as unknown as EpisodeExportJobRepository,
      queue,
    );

    await expect(service.dispatchJob(jobId)).rejects.toThrow(
      'Episode export dispatch is temporarily unavailable',
    );

    expect(repository.failures).toEqual([{
      jobId,
      message: 'Episode export dispatch is temporarily unavailable',
    }]);
  });

  it('periodic recoveryをbounded batchで送り個別失敗後も次を処理する', async () => {
    const secondJobId = '55555555-5555-4555-8555-555555555555';
    const repository = new FakeRepository();
    repository.pending = [outbox(jobId), outbox(secondJobId)];
    const queue = new FakeQueue();
    queue.failJobId = jobId;
    const service = new EpisodeExportDispatchService(
      repository as unknown as EpisodeExportJobRepository,
      queue,
    );

    await expect(service.dispatchPending(10)).resolves.toEqual({
      attemptedCount: 2,
      dispatchedCount: 1,
      failedCount: 1,
    });
    expect(queue.calls).toEqual([jobId, secondJobId]);
  });
});

class FakeRepository {
  public record: EpisodeExportJobOutboxRecord | null = outbox(jobId);
  public pending: EpisodeExportJobOutboxRecord[] = [];
  public dispatched: Array<{ jobId: string; messageId: string }> = [];
  public failures: Array<{ jobId: string; message: string }> = [];

  public async findUndispatchedForJob(
    requestedJobId: string,
  ): Promise<EpisodeExportJobOutboxRecord | null> {
    return this.pending.length > 0 ? outbox(requestedJobId) : this.record;
  }

  public async listUndispatched(): Promise<EpisodeExportJobOutboxRecord[]> {
    return this.pending;
  }

  public async markDispatched(id: string, messageId: string): Promise<boolean> {
    this.dispatched.push({ jobId: id, messageId });
    return true;
  }

  public async markDispatchFailure(id: string, message: string): Promise<boolean> {
    this.failures.push({ jobId: id, message });
    return true;
  }
}

class FakeQueue implements EpisodeExportQueuePort {
  public calls: string[] = [];
  public error: Error | null = null;
  public failJobId: string | null = null;

  public async enqueue(jobIdToQueue: string): Promise<{ messageId: string }> {
    this.calls.push(jobIdToQueue);
    if (this.error !== null || this.failJobId === jobIdToQueue) {
      throw this.error ?? new Error('temporary');
    }
    return { messageId: 'message-1' };
  }
}

function outbox(exportJobId: string): EpisodeExportJobOutboxRecord {
  return {
    exportJobId,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    dispatchedAt: null,
    sqsMessageId: null,
    dispatchAttempts: 0,
    lastDispatchError: null,
  };
}
