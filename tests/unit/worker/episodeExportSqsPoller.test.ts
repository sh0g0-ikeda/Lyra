import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import type { EpisodeExportWorkerDependencies } from '../../../worker/episodeExport.js';
import {
  EpisodeExportQueuePoller,
  type EpisodeExportSqsPollerClient,
} from '../../../worker/episodeExportSqsPoller.js';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-export';
const jobId = '44444444-4444-4444-8444-444444444444';

describe('EpisodeExportQueuePoller', () => {
  it('専用queueを長時間visibilityで受信し成功messageだけ削除する', async () => {
    const client = new FakeClient();
    const poller = new EpisodeExportQueuePoller(
      client,
      dependencies({ status: 'processed', jobStatus: 'completed' }),
      { queueUrl, visibilityTimeoutSeconds: 1800 },
    );

    await expect(poller.pollOnce()).resolves.toMatchObject({
      receivedCount: 1,
      deletedCount: 1,
      retryCount: 0,
    });

    expect(client.commands[0]).toBeInstanceOf(ReceiveMessageCommand);
    expect((client.commands[0] as ReceiveMessageCommand).input).toMatchObject({
      QueueUrl: queueUrl,
      VisibilityTimeout: 1800,
      MaxNumberOfMessages: 1,
    });
    expect(client.commands[1]).toBeInstanceOf(DeleteMessageBatchCommand);
  });

  it('retry messageを削除せずSQS再配信へ残す', async () => {
    const client = new FakeClient();
    const poller = new EpisodeExportQueuePoller(
      client,
      dependencies({ status: 'retry', reason: 'temporary' }),
      { queueUrl, visibilityTimeoutSeconds: 1800 },
    );

    await expect(poller.pollOnce()).resolves.toMatchObject({
      receivedCount: 1,
      deletedCount: 0,
      retryCount: 1,
    });
    expect(client.commands.some((command) =>
      command instanceof DeleteMessageBatchCommand)).toBe(false);
  });
});

class FakeClient implements EpisodeExportSqsPollerClient {
  public commands: Array<
    ReceiveMessageCommand
    | DeleteMessageBatchCommand
    | ChangeMessageVisibilityBatchCommand
  > = [];

  public async send(command: ReceiveMessageCommand | DeleteMessageBatchCommand | ChangeMessageVisibilityBatchCommand) {
    this.commands.push(command);
    if (command instanceof ReceiveMessageCommand) {
      return {
        Messages: [{
          MessageId: 'message-1',
          ReceiptHandle: 'receipt-1',
          Body: JSON.stringify({ version: 1, export_job_id: jobId }),
        }],
      };
    }
    return {};
  }
}

function dependencies(result: {
  status: 'processed' | 'skipped' | 'retry';
  jobStatus?: 'completed' | 'failed';
  reason?: string;
}): EpisodeExportWorkerDependencies {
  return {
    episodeExportWorkerService: {
      async processJob() {
        return result;
      },
    },
  };
}
