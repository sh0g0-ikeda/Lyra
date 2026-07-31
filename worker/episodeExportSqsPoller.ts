import {
  ChangeMessageVisibilityBatchCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import {
  handleEpisodeExportQueue,
  type EpisodeExportWorkerBatchResult,
  type EpisodeExportWorkerDependencies,
} from './episodeExport.js';

export interface EpisodeExportSqsPollerClient {
  send(
    command:
      | ReceiveMessageCommand
      | DeleteMessageBatchCommand
      | ChangeMessageVisibilityBatchCommand,
  ): Promise<{
    Messages?: Message[];
    Failed?: Array<{ Id?: string; Message?: string }>;
  }>;
}

export interface EpisodeExportQueuePollerOptions {
  queueUrl: string;
  maxNumberOfMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
  idleDelayMs?: number;
}

export interface EpisodeExportQueuePollResult {
  receivedCount: number;
  deletedCount: number;
  retryCount: number;
  handlerResult: EpisodeExportWorkerBatchResult | null;
}

const DEFAULT_MAX_NUMBER_OF_MESSAGES = 1;
const DEFAULT_WAIT_TIME_SECONDS = 20;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 1800;
const MIN_VISIBILITY_EXTENSION_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_DELAY_MS = 1000;

export class EpisodeExportQueuePoller {
  private shouldStop = false;

  public constructor(
    private readonly client: EpisodeExportSqsPollerClient,
    private readonly dependencies: EpisodeExportWorkerDependencies,
    private readonly options: EpisodeExportQueuePollerOptions,
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

  public async pollOnce(): Promise<EpisodeExportQueuePollResult> {
    const messages = await this.receiveMessages();
    if (messages.length === 0) {
      return {
        receivedCount: 0,
        deletedCount: 0,
        retryCount: 0,
        handlerResult: null,
      };
    }

    const stopVisibilityExtension = this.startVisibilityExtension(messages);
    let handlerResult: EpisodeExportWorkerBatchResult;
    try {
      handlerResult = await handleEpisodeExportQueue(
        {
          Records: messages.map((message) => ({
            messageId: message.MessageId,
            body: message.Body ?? '',
          })),
        },
        this.dependencies,
      );
    } finally {
      stopVisibilityExtension();
    }

    const retryIds = new Set(
      handlerResult.batchItemFailures.map((failure) => failure.itemIdentifier),
    );
    const messagesToDelete = messages.filter(
      (message) =>
        message.ReceiptHandle !== undefined
        && (message.MessageId === undefined || !retryIds.has(message.MessageId)),
    );
    const deletedCount = await this.deleteMessages(messagesToDelete);
    return {
      receivedCount: messages.length,
      deletedCount,
      retryCount: retryIds.size,
      handlerResult,
    };
  }

  private async receiveMessages(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: clampMessages(this.options.maxNumberOfMessages),
        WaitTimeSeconds:
          this.options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
        VisibilityTimeout: this.visibilityTimeoutSeconds(),
      }),
    );
    return response.Messages ?? [];
  }

  private startVisibilityExtension(messages: Message[]): () => void {
    const entries = visibilityEntries(messages);
    if (entries.length === 0) {
      return () => undefined;
    }
    const timeoutSeconds = this.visibilityTimeoutSeconds();
    const intervalMs = Math.max(
      MIN_VISIBILITY_EXTENSION_INTERVAL_MS,
      Math.floor((timeoutSeconds * 1000) / 2),
    );
    const timer = setInterval(() => {
      void this.extendVisibility(entries, timeoutSeconds);
    }, intervalMs);
    unrefTimer(timer);
    return () => clearInterval(timer);
  }

  private async extendVisibility(
    entries: Array<{ Id: string; ReceiptHandle: string }>,
    timeoutSeconds: number,
  ): Promise<void> {
    try {
      const response = await this.client.send(
        new ChangeMessageVisibilityBatchCommand({
          QueueUrl: this.options.queueUrl,
          Entries: entries.map((entry) => ({
            ...entry,
            VisibilityTimeout: timeoutSeconds,
          })),
        }),
      );
      if ((response.Failed?.length ?? 0) > 0) {
        console.warn(
          '[episode-export-worker] visibility extension failed',
          response.Failed?.map((failure) =>
            sanitizePersistedErrorMessage(
              failure.Message ?? failure.Id ?? 'Visibility extension failed',
              'Visibility extension failed',
            ),
          ),
        );
      }
    } catch (error) {
      console.warn(
        '[episode-export-worker] visibility extension failed',
        sanitizePersistedErrorMessage(error, 'Visibility extension failed'),
      );
    }
  }

  private async deleteMessages(messages: Message[]): Promise<number> {
    const entries = visibilityEntries(messages);
    if (entries.length === 0) {
      return 0;
    }
    const response = await this.client.send(
      new DeleteMessageBatchCommand({
        QueueUrl: this.options.queueUrl,
        Entries: entries,
      }),
    );
    return entries.length - (response.Failed?.length ?? 0);
  }

  private visibilityTimeoutSeconds(): number {
    return this.options.visibilityTimeoutSeconds
      ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
  }
}

function visibilityEntries(
  messages: Message[],
): Array<{ Id: string; ReceiptHandle: string }> {
  return messages.flatMap((message, index) =>
    message.ReceiptHandle === undefined
      ? []
      : [{ Id: String(index), ReceiptHandle: message.ReceiptHandle }],
  );
}

function clampMessages(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_NUMBER_OF_MESSAGES;
  }
  return Math.max(1, Math.min(10, value));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    timer.unref();
  }
}
