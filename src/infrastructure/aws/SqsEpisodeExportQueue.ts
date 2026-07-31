import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodeExportQueuePort,
} from '../../services/export/EpisodeExportDispatchService.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_MESSAGE_ID_LENGTH = 128;

export interface EpisodeExportQueueClient {
  send(command: SendMessageCommand): Promise<{ MessageId?: string }>;
}

export class SqsEpisodeExportQueue implements EpisodeExportQueuePort {
  public constructor(
    private readonly client: EpisodeExportQueueClient,
    private readonly queueUrl: string,
  ) {
    assertHttpsUrl(queueUrl);
  }

  public async enqueue(jobId: string): Promise<{ messageId: string }> {
    if (!UUID_PATTERN.test(jobId)) {
      throw unavailable();
    }
    try {
      const response = await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({
            version: 1,
            export_job_id: jobId,
          }),
        }),
      );
      const messageId = response.MessageId;
      if (
        messageId === undefined
        || messageId.length < 1
        || messageId.length > MAX_MESSAGE_ID_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(messageId)
      ) {
        throw unavailable();
      }
      return { messageId };
    } catch {
      throw unavailable();
    }
  }
}

export function createEpisodeExportQueueClient(region?: string): SQSClient {
  return new SQSClient(region === undefined ? {} : { region });
}

function assertHttpsUrl(value: string): void {
  try {
    if (new URL(value).protocol !== 'https:') {
      throw unavailable();
    }
  } catch {
    throw unavailable();
  }
}

function unavailable(): ConfigurationError {
  return new ConfigurationError(
    'Episode export queue is temporarily unavailable',
  );
}
