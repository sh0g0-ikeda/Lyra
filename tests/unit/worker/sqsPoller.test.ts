import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import type { ProcessEntityGenerationJobResult } from '../../../src/services/entity/EntityGenerationWorkerService.js';
import type { ProcessPageGenerationJobResult } from '../../../src/services/page/PageGenerationWorkerService.js';
import type { ProcessEpisodePageSkeletonJobResult } from '../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type { ProcessEpisodeStoryAutofillJobResult } from '../../../src/services/story/EpisodeStoryAutofillWorkerService.js';
import { GenerationQueuePoller, type SqsPollerClient } from '../../../worker/sqsPoller.js';
import {
  TaskScaleInProtectionError,
  type TaskScaleInProtection,
} from '../../../worker/ecsTaskScaleInProtection.js';
import type { WorkerDependencies } from '../../../worker/index.js';

class FakeSqsPollerClient implements SqsPollerClient {
  public deletedEntries: unknown[] = [];
  public receiveInputs: unknown[] = [];
  public visibilityInputs: unknown[] = [];

  public constructor(private readonly messages: Message[]) {}

  public async send(
    command: ReceiveMessageCommand | DeleteMessageBatchCommand | ChangeMessageVisibilityBatchCommand,
  ): Promise<{
    Messages?: Message[];
    Failed?: Array<{ Id?: string; Message?: string }>;
  }> {
    if (command instanceof ReceiveMessageCommand) {
      this.receiveInputs.push(command.input);
      return { Messages: this.messages };
    }
    if (command instanceof ChangeMessageVisibilityBatchCommand) {
      this.visibilityInputs.push(command.input);
      return { Failed: [] };
    }

    this.deletedEntries = command.input.Entries ?? [];
    return { Failed: [] };
  }
}

class FakeTaskScaleInProtection implements TaskScaleInProtection {
  public readonly calls: string[] = [];
  public protectError: Error | undefined;
  public unprotectError: Error | undefined;

  public async protect(expiresInMinutes: number): Promise<void> {
    this.calls.push(`protect:${expiresInMinutes}`);
    if (this.protectError !== undefined) {
      throw this.protectError;
    }
  }

  public async unprotect(): Promise<void> {
    this.calls.push('unprotect');
    if (this.unprotectError !== undefined) {
      throw this.unprotectError;
    }
  }
}

class FakePageGenerationWorkerService {
  public calls: string[] = [];
  public shouldThrow = false;
  public processingGate: Promise<void> | undefined;

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.calls.push(jobId);
    await this.processingGate;
    if (this.shouldThrow) {
      throw new Error('temporary page worker failure');
    }

    return {
      status: 'processed',
      jobStatus: 'completed',
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

class FakeEntityGenerationWorkerService {
  public calls: string[] = [];

  public async processJob(jobId: string): Promise<ProcessEntityGenerationJobResult> {
    this.calls.push(jobId);
    return {
      status: 'processed',
      jobStatus: 'completed',
    };
  }
}

class FakeEpisodeStoryAutofillWorkerService {
  public async processJob(): Promise<ProcessEpisodeStoryAutofillJobResult> {
    return {
      status: 'processed',
      jobStatus: 'completed',
    };
  }
}

class FakeEpisodePageSkeletonWorkerService {
  public async processJob(): Promise<ProcessEpisodePageSkeletonJobResult> {
    return {
      status: 'processed',
      jobStatus: 'completed',
    };
  }
}

describe('GenerationQueuePoller', () => {
  it('処理成功と恒久的な不正メッセージはSQSから削除する', async () => {
    const pageWorker = new FakePageGenerationWorkerService();
    const entityWorker = new FakeEntityGenerationWorkerService();
    const client = new FakeSqsPollerClient([
      buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      {
        MessageId: 'message-2',
        ReceiptHandle: 'receipt-2',
        Body: 'not-json',
      },
    ]);
    const poller = new GenerationQueuePoller(client, buildDependencies(pageWorker, entityWorker), {
      queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
      visibilityTimeoutSeconds: 420,
    });

    const result = await poller.pollOnce();

    expect(pageWorker.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(result).toMatchObject({
      receivedCount: 2,
      deletedCount: 2,
      retryCount: 0,
    });
    expect(client.deletedEntries).toHaveLength(2);
  });

  it('workerが一時失敗したメッセージは削除せずSQS retryに任せる', async () => {
    const pageWorker = new FakePageGenerationWorkerService();
    pageWorker.shouldThrow = true;
    const entityWorker = new FakeEntityGenerationWorkerService();
    const client = new FakeSqsPollerClient([
      buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
    ]);
    const poller = new GenerationQueuePoller(client, buildDependencies(pageWorker, entityWorker), {
      queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
    });

    const result = await poller.pollOnce();

    expect(result).toMatchObject({
      receivedCount: 1,
      deletedCount: 0,
      retryCount: 1,
    });
    expect(client.deletedEntries).toHaveLength(0);
  });

  it('receive設定は安全な範囲に丸める', async () => {
    const client = new FakeSqsPollerClient([]);
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(new FakePageGenerationWorkerService(), new FakeEntityGenerationWorkerService()),
      {
        queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
        maxNumberOfMessages: 50,
      },
    );

    await poller.pollOnce();

    expect(client.receiveInputs[0]).toMatchObject({
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 1800,
    });
  });

  it('maxNumberOfMessages 未指定時は重い生成ジョブを 1 件ずつ受信する', async () => {
    const client = new FakeSqsPollerClient([]);
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(new FakePageGenerationWorkerService(), new FakeEntityGenerationWorkerService()),
      {
        queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
      },
    );

    await poller.pollOnce();

    expect(client.receiveInputs[0]).toMatchObject({
      MaxNumberOfMessages: 1,
    });
  });

  it('SQS受信前にtaskを保護し処理結果確定後に解除する', async () => {
    const events: string[] = [];
    const protection = new FakeTaskScaleInProtection();
    const client = new FakeSqsPollerClient([
      buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
    ]);
    const originalSend = client.send.bind(client);
    client.send = async (command) => {
      events.push(command instanceof ReceiveMessageCommand ? 'receive' : 'sqs-result');
      return originalSend(command);
    };
    protection.protect = async (expiresInMinutes) => {
      events.push(`protect:${expiresInMinutes}`);
    };
    protection.unprotect = async () => {
      events.push('unprotect');
    };
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(new FakePageGenerationWorkerService(), new FakeEntityGenerationWorkerService()),
      {
        queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
        visibilityTimeoutSeconds: 420,
      },
      protection,
    );

    await poller.pollOnce();

    expect(events[0]).toBe('protect:120');
    expect(events[1]).toBe('receive');
    expect(events.at(-1)).toBe('unprotect');
  });

  it('task保護取得失敗時はSQS受信もprovider処理も行わない', async () => {
    const protection = new FakeTaskScaleInProtection();
    protection.protectError = new TaskScaleInProtectionError('protect', 'agent unavailable');
    const pageWorker = new FakePageGenerationWorkerService();
    const client = new FakeSqsPollerClient([
      buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
    ]);
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(pageWorker, new FakeEntityGenerationWorkerService()),
      { queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation' },
      protection,
    );

    await expect(poller.pollOnce()).rejects.toThrow('agent unavailable');

    expect(client.receiveInputs).toHaveLength(0);
    expect(pageWorker.calls).toHaveLength(0);
    expect(protection.calls).toEqual(['protect:120']);
  });

  it('停止通知後にlong pollがmessageを返してもprovider処理せずretryへ残す', async () => {
    let resolveReceive: ((value: { Messages?: Message[] }) => void) | undefined;
    const visibilityInputs: unknown[] = [];
    const client: SqsPollerClient = {
      send: (command) => {
        if (!(command instanceof ReceiveMessageCommand)) {
          if (command instanceof ChangeMessageVisibilityBatchCommand) {
            visibilityInputs.push(command.input);
          }
          return Promise.resolve({ Failed: [] });
        }
        return new Promise((resolve) => {
          resolveReceive = resolve;
        });
      },
    };
    const protection = new FakeTaskScaleInProtection();
    const pageWorker = new FakePageGenerationWorkerService();
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(pageWorker, new FakeEntityGenerationWorkerService()),
      { queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation' },
      protection,
    );

    const pending = poller.pollOnce();
    await Promise.resolve();
    poller.stop();
    resolveReceive?.({
      Messages: [buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      })],
    });

    await expect(pending).resolves.toMatchObject({
      receivedCount: 1,
      deletedCount: 0,
      retryCount: 1,
      handlerResult: null,
    });
    expect(pageWorker.calls).toHaveLength(0);
    expect(protection.calls).toEqual(['protect:120', 'unprotect']);
    expect(visibilityInputs).toEqual([{
      QueueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
      Entries: [{ Id: '0', ReceiptHandle: 'receipt-1', VisibilityTimeout: 0 }],
    }]);
  });

  it('task保護解除失敗時は停止し次のSQS受信を行わない', async () => {
    const protection = new FakeTaskScaleInProtection();
    protection.unprotectError = new Error('agent unavailable during release');
    const client = new FakeSqsPollerClient([]);
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(new FakePageGenerationWorkerService(), new FakeEntityGenerationWorkerService()),
      { queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation' },
      protection,
    );

    await expect(poller.pollOnce()).rejects.toThrow('agent unavailable during release');
    await expect(poller.pollOnce()).resolves.toMatchObject({ receivedCount: 0 });
    expect(client.receiveInputs).toHaveLength(1);
  });

  it('task保護取得失敗を即時loopせず30秒待って再試行する', async () => {
    vi.useFakeTimers();
    const protection = new FakeTaskScaleInProtection();
    protection.protectError = new TaskScaleInProtectionError('protect', 'agent unavailable');
    let poller: GenerationQueuePoller;
    const client: SqsPollerClient = {
      send: async (command) => {
        if (command instanceof ReceiveMessageCommand) {
          poller.stop();
          return { Messages: [] };
        }
        return { Failed: [] };
      },
    };
    poller = new GenerationQueuePoller(
      client,
      buildDependencies(new FakePageGenerationWorkerService(), new FakeEntityGenerationWorkerService()),
      { queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation' },
      protection,
    );

    const pending = poller.run();
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(29_999);
    await Promise.resolve();
    expect(protection.calls).toEqual(['protect:120']);
    protection.protectError = undefined;
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    await expect(pending).resolves.toBeUndefined();
    expect(protection.calls).toEqual(['protect:120', 'protect:120', 'unprotect']);
  });

  it('処理中のtask保護更新失敗時はmessageを削除せずworkerを停止する', async () => {
    vi.useFakeTimers();
    let releaseProcessing: (() => void) | undefined;
    const pageWorker = new FakePageGenerationWorkerService();
    pageWorker.processingGate = new Promise((resolve) => {
      releaseProcessing = resolve;
    });
    const protection = new FakeTaskScaleInProtection();
    const client = new FakeSqsPollerClient([
      buildMessage('message-1', 'receipt-1', {
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
    ]);
    const poller = new GenerationQueuePoller(
      client,
      buildDependencies(pageWorker, new FakeEntityGenerationWorkerService()),
      {
        queueUrl: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
        visibilityTimeoutSeconds: 420,
      },
      protection,
    );

    const pending = poller.pollOnce();
    for (let attempt = 0; attempt < 20 && pageWorker.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(pageWorker.calls).toHaveLength(1);
    protection.protectError = new Error('refresh unavailable');
    vi.advanceTimersByTime(60 * 60_000);
    await Promise.resolve();
    await Promise.resolve();
    releaseProcessing?.();

    await expect(pending).rejects.toThrow('refresh unavailable');
    expect(client.deletedEntries).toHaveLength(0);
    expect(protection.calls).toEqual(['protect:120', 'protect:120', 'unprotect']);
    await expect(poller.pollOnce()).resolves.toMatchObject({ receivedCount: 0 });
  });
});

function buildDependencies(
  pageGenerationWorkerService: FakePageGenerationWorkerService,
  entityGenerationWorkerService: FakeEntityGenerationWorkerService,
): WorkerDependencies {
  return {
    pageGenerationWorkerService,
    entityGenerationWorkerService,
    episodeStoryAutofillWorkerService: new FakeEpisodeStoryAutofillWorkerService(),
    episodePageSkeletonWorkerService: new FakeEpisodePageSkeletonWorkerService(),
  };
}

function buildMessage(
  messageId: string,
  receiptHandle: string,
  body: Record<string, unknown>,
): Message {
  return {
    MessageId: messageId,
    ReceiptHandle: receiptHandle,
    Body: JSON.stringify(body),
  };
}
