import { describe, expect, it } from 'vitest';
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

class FakePageGenerationWorkerService {
  public calls: string[] = [];
  public shouldThrow = false;

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.calls.push(jobId);
    if (this.shouldThrow) {
      throw new Error('temporary page worker failure');
    }

    return {
      status: 'processed',
      jobStatus: 'completed',
    };
  }
}

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
    episodeExportWorkerService: {
      async processJob() {
        return { status: 'skipped' as const };
      },
    },
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
