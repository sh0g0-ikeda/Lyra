import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import {
  SqsEpisodeExportQueue,
  type EpisodeExportQueueClient,
} from '../../../../src/infrastructure/aws/SqsEpisodeExportQueue.js';

const queueUrl = 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-export';
const jobId = '44444444-4444-4444-8444-444444444444';

describe('SqsEpisodeExportQueue', () => {
  it('専用queueへversion付きjob IDだけを送る', async () => {
    const client = new FakeClient();
    const queue = new SqsEpisodeExportQueue(client, queueUrl);

    await expect(queue.enqueue(jobId)).resolves.toEqual({ messageId: 'message-1' });

    const command = client.commands[0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command?.input).toEqual({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        version: 1,
        export_job_id: jobId,
      }),
    });
  });

  it('message ID欠落とprovider詳細を安全な一時障害へする', async () => {
    const client = new FakeClient();
    client.response = {};
    const queue = new SqsEpisodeExportQueue(client, queueUrl);
    await expect(queue.enqueue(jobId)).rejects.toThrow(
      'Episode export queue is temporarily unavailable',
    );

    client.error = new Error('secret queue URL and credential detail');
    await expect(queue.enqueue(jobId)).rejects.toThrow(
      'Episode export queue is temporarily unavailable',
    );
  });
});

class FakeClient implements EpisodeExportQueueClient {
  public commands: SendMessageCommand[] = [];
  public response: { MessageId?: string } = { MessageId: 'message-1' };
  public error: Error | null = null;

  public async send(command: SendMessageCommand): Promise<{ MessageId?: string }> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }
    return this.response;
  }
}
