import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { GenerationJobType } from '../../domain/types/job.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';

export interface EnqueueGenerationJobInput {
  jobId: string;
  jobType: GenerationJobType;
}

export interface GenerationQueueClient {
  send(command: SendMessageCommand): Promise<{
    MessageId?: string;
  }>;
}

export class SqsGenerationQueue {
  public constructor(
    private readonly client: GenerationQueueClient,
    private readonly queueUrl: string,
  ) {}

  public async enqueueJob(input: EnqueueGenerationJobInput): Promise<{ messageId: string | null }> {
    try {
      const response = await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({
            job_id: input.jobId,
            job_type: input.jobType,
          }),
        }),
      );

      return {
        messageId: response.MessageId ?? null,
      };
    } catch (error) {
      throw new ConfigurationError(
        toSanitizedAwsErrorMessage(error, 'Failed to enqueue generation job'),
      );
    }
  }
}

export function createGenerationQueueClient(region?: string): SQSClient {
  return new SQSClient(region === undefined ? {} : { region });
}
