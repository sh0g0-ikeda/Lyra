import { describe, expect, it, vi } from 'vitest';
import { SqsGenerationQueue } from '../../../../src/infrastructure/aws/SqsGenerationQueue.js';

describe('generation queue best-effort wake', () => {
  it('SQS永続化の後にだけ起動を依頼する', async () => {
    const order: string[] = [];
    const queue = new SqsGenerationQueue({ send: async () => {
      order.push('persisted'); return { MessageId: 'accepted' };
    } }, 'https://sqs.example.test/queue', { requestWarm: async () => { order.push('wake'); } });
    await expect(queue.enqueueJob({ jobId: 'job', jobType: 'page_generate' })).resolves.toEqual({ messageId: 'accepted' });
    expect(order).toEqual(['persisted', 'wake']);
  });

  it('起動依頼が失敗しても受付済みjobを失敗に戻さない', async () => {
    const wake = vi.fn(async () => { throw new Error('unavailable'); });
    const queue = new SqsGenerationQueue({ send: async () => ({ MessageId: 'accepted' }) },
      'https://sqs.example.test/queue', { requestWarm: wake });
    await expect(queue.enqueueJob({ jobId: 'job', jobType: 'entity_generate' })).resolves.toEqual({ messageId: 'accepted' });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('SQS受付が失敗した場合に起動を依頼しない', async () => {
    const wake = vi.fn(async () => undefined);
    const queue = new SqsGenerationQueue({ send: async () => { throw new Error('SQS unavailable'); } },
      'https://sqs.example.test/queue', { requestWarm: wake });
    await expect(queue.enqueueJob({ jobId: 'job', jobType: 'episode_page_skeleton' })).rejects.toThrow();
    expect(wake).not.toHaveBeenCalled();
  });
});
