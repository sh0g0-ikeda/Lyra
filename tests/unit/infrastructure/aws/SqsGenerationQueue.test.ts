import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { SqsGenerationQueue } from '../../../../src/infrastructure/aws/SqsGenerationQueue.js';
import { SqsEntityGenerationQueueAdapter } from '../../../../src/services/entity/EntityGenerationQueue.js';
import { SqsPageGenerationQueueAdapter } from '../../../../src/services/page/PageGenerationQueue.js';

class FakeSqsClient {
  public commands: SendMessageCommand[] = [];
  public error: Error | null = null;

  public async send(command: SendMessageCommand): Promise<{ MessageId: string }> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }

    return {
      MessageId: 'message-1',
    };
  }
}

describe('SqsGenerationQueue', () => {
  it('page_generate payload を SQS に送る', async () => {
    const client = new FakeSqsClient();
    const queue = new SqsGenerationQueue(client, 'https://sqs.example.test/queue');
    const adapter = new SqsPageGenerationQueueAdapter(queue);

    const result = await adapter.enqueue({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      creditCost: 10,
      requiresPlanner: false,
      previousPageStatus: 'designing',
      previousGenerationMode: null,
    });

    expect((client.commands[0]?.input.MessageBody ?? '')).toContain('"job_type":"page_generate"');
    expect(result.messageId).toBe('message-1');
  });

  it('entity_generate payload を SQS に送る', async () => {
    const client = new FakeSqsClient();
    const queue = new SqsGenerationQueue(client, 'https://sqs.example.test/queue');
    const adapter = new SqsEntityGenerationQueueAdapter(queue);

    const result = await adapter.enqueue({
      jobId: 'job-1',
      userId: 'user-1',
      entityId: 'entity-1',
    });

    expect((client.commands[0]?.input.MessageBody ?? '')).toContain('"job_type":"entity_generate"');
    expect(result.messageId).toBe('message-1');
  });

  it('SQS 失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeSqsClient();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.error = new Error(`sqs failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const queue = new SqsGenerationQueue(client, 'https://sqs.example.test/queue');

    await expect(
      queue.enqueueJob({
        jobId: 'job-1',
        jobType: 'page_generate',
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      queue.enqueueJob({
        jobId: 'job-2',
        jobType: 'page_generate',
      }),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining(fakeApiKey),
    });
  });
});

import { vi } from 'vitest';

describe('SQS enqueue worker wake', () => {
  it('SQS受付成功後にworkerを起動する', async () => {
    const client = new FakeSqsClient();
    const requestWarm = vi.fn(async () => undefined);
    const queue = new SqsGenerationQueue(client, 'https://sqs.example.test/queue', { requestWarm });
    await expect(queue.enqueueJob({ jobId: 'job-1', jobType: 'page_generate' })).resolves.toEqual({ messageId: 'message-1' });
    expect(requestWarm).toHaveBeenCalledOnce();
  });
  it('起動要求が失敗しても受付済みジョブを失敗や返金へ戻さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const queue = new SqsGenerationQueue(new FakeSqsClient(), 'https://sqs.example.test/queue', {
        requestWarm: async () => { throw new Error('private provider failure'); },
      });
      await expect(queue.enqueueJob({ jobId: 'job-1', jobType: 'page_generate' })).resolves.toEqual({ messageId: 'message-1' });
      expect(warn.mock.calls.flat().join(' ')).not.toContain('private provider failure');
    } finally { warn.mockRestore(); }
  });
  it('SQS受付が失敗した場合は起動せず従来のenqueue失敗を返す', async () => {
    const client = new FakeSqsClient();
    client.error = new Error('queue unavailable');
    const requestWarm = vi.fn(async () => undefined);
    const queue = new SqsGenerationQueue(client, 'https://sqs.example.test/queue', { requestWarm });
    await expect(queue.enqueueJob({ jobId: 'job-1', jobType: 'page_generate' })).rejects.toThrow();
    expect(requestWarm).not.toHaveBeenCalled();
  });
});
