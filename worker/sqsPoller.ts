import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import {
  handleGenerationQueue,
  type WorkerBatchResult,
  type WorkerDependencies,
} from './index.js';

export interface SqsPollerClient {
  send(command: ReceiveMessageCommand | DeleteMessageBatchCommand): Promise<{
    Messages?: Message[];
    Failed?: Array<{ Id?: string; Message?: string }>;
  }>;
}

export interface GenerationQueuePollerOptions {
  queueUrl: string;
  maxNumberOfMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
  idleDelayMs?: number;
}

export interface GenerationQueuePollResult {
  receivedCount: number;
  deletedCount: number;
  retryCount: number;
  handlerResult: WorkerBatchResult | null;
}

const DEFAULT_MAX_NUMBER_OF_MESSAGES = 5;
const DEFAULT_WAIT_TIME_SECONDS = 20;
const DEFAULT_IDLE_DELAY_MS = 1000;

/**
 * ECS/Fargate worker loop for the same SQS payload contract used by the
 * Lambda-style handler. It deletes only records that the handler did not mark
 * for retry, so transient worker failures stay protected by SQS visibility.
 */
export class GenerationQueuePoller {
  private shouldStop = false;

  public constructor(
    private readonly client: SqsPollerClient,
    private readonly dependencies: WorkerDependencies,
    private readonly options: GenerationQueuePollerOptions,
  ) {}

  public stop(): void {
    this.shouldStop = true;
  }

  public async run(): Promise<void> {
    while (!this.shouldStop) {
      const result = await this.pollOnce();
      if (result.receivedCount === 0 && !this.shouldStop) {
        await sleep(this.options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS);
      }
    }
  }

  public async pollOnce(): Promise<GenerationQueuePollResult> {
    const messages = await this.receiveMessages();
    if (messages.length === 0) {
      return {
        receivedCount: 0,
        deletedCount: 0,
        retryCount: 0,
        handlerResult: null,
      };
    }

    const handlerResult = await handleGenerationQueue(
      {
        Records: messages.map((message) => ({
          messageId: message.MessageId,
          body: message.Body ?? '',
        })),
      },
      this.dependencies,
    );
    const retryMessageIds = new Set(
      handlerResult.batchItemFailures.map((failure) => failure.itemIdentifier),
    );
    const messagesToDelete = messages.filter(
      (message) => message.ReceiptHandle !== undefined &&
        (message.MessageId === undefined || !retryMessageIds.has(message.MessageId)),
    );
    const deletedCount = await this.deleteMessages(messagesToDelete);

    return {
      receivedCount: messages.length,
      deletedCount,
      retryCount: retryMessageIds.size,
      handlerResult,
    };
  }

  private async receiveMessages(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: clampMaxNumberOfMessages(this.options.maxNumberOfMessages),
        WaitTimeSeconds: this.options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
        VisibilityTimeout: this.options.visibilityTimeoutSeconds,
      }),
    );

    return response.Messages ?? [];
  }

  private async deleteMessages(messages: Message[]): Promise<number> {
    if (messages.length === 0) {
      return 0;
    }

    const entries = messages.flatMap((message, index) => {
      if (message.ReceiptHandle === undefined) {
        return [];
      }

      return [{
        Id: String(index),
        ReceiptHandle: message.ReceiptHandle,
      }];
    });
    if (entries.length === 0) {
      return 0;
    }

    const response = await this.client.send(
      new DeleteMessageBatchCommand({
        QueueUrl: this.options.queueUrl,
        Entries: entries,
      }),
    );
    if (response.Failed !== undefined && response.Failed.length > 0) {
      console.warn(
        '[generation-worker] failed to delete one or more SQS messages',
        response.Failed.map((failure) =>
          sanitizePersistedErrorMessage(failure.Message ?? failure.Id ?? 'DeleteMessageBatch failed', 'Delete failed'),
        ),
      );
    }

    return entries.length - (response.Failed?.length ?? 0);
  }
}

function clampMaxNumberOfMessages(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_NUMBER_OF_MESSAGES;
  }

  return Math.max(1, Math.min(10, value));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
