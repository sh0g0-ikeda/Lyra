import {
  ChangeMessageVisibilityBatchCommand,
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
import {
  createTaskScaleInProtectionFromEnvironment,
  TaskScaleInProtectionError,
  type TaskScaleInProtection,
} from './ecsTaskScaleInProtection.js';

export interface SqsPollerClient {
  send(command: ReceiveMessageCommand | DeleteMessageBatchCommand | ChangeMessageVisibilityBatchCommand): Promise<{
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

const DEFAULT_MAX_NUMBER_OF_MESSAGES = 1;
const DEFAULT_WAIT_TIME_SECONDS = 20;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 1800;
const MIN_VISIBILITY_EXTENSION_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_DELAY_MS = 1000;
const TASK_PROTECTION_EXPIRY_BUFFER_MINUTES = 5;
const MIN_TASK_PROTECTION_EXPIRY_MINUTES = 120;
const MAX_TASK_PROTECTION_EXPIRY_MINUTES = 2_880;
const TASK_PROTECTION_FAILURE_DELAY_MS = 30_000;
const MIN_TASK_PROTECTION_REFRESH_INTERVAL_MS = 60_000;

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
    private readonly taskProtection: TaskScaleInProtection =
      createTaskScaleInProtectionFromEnvironment(process.env),
  ) {}

  public stop(): void {
    this.shouldStop = true;
  }

  public async run(): Promise<void> {
    while (!this.shouldStop) {
      let result: GenerationQueuePollResult;
      try {
        result = await this.pollOnce();
      } catch (error) {
        if (
          error instanceof TaskScaleInProtectionError &&
          error.operation === 'protect' &&
          !this.shouldStop
        ) {
          console.warn(
            '[generation-worker] task protection unavailable; delaying before retry',
            sanitizePersistedErrorMessage(error, 'Task protection unavailable'),
          );
          await sleep(TASK_PROTECTION_FAILURE_DELAY_MS);
          continue;
        }
        throw error;
      }
      if (result.receivedCount === 0 && !this.shouldStop) {
        await sleep(this.options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS);
      }
    }
  }

  public async pollOnce(): Promise<GenerationQueuePollResult> {
    if (this.shouldStop) {
      return emptyPollResult();
    }

    const protectionExpiryMinutes = this.taskProtectionExpiryMinutes();
    await this.taskProtection.protect(protectionExpiryMinutes);
    try {
      const messages = await this.receiveMessages();
      if (messages.length === 0) {
        return emptyPollResult();
      }
      if (this.shouldStop) {
        await this.returnMessagesForRetry(messages);
        return {
          receivedCount: messages.length,
          deletedCount: 0,
          retryCount: messages.length,
          handlerResult: null,
        };
      }

      const stopVisibilityExtension = this.startVisibilityExtension(messages);
      const stopProtectionRefresh = this.startProtectionRefresh(protectionExpiryMinutes);
      let handlerResult: WorkerBatchResult;
      try {
        handlerResult = await handleGenerationQueue(
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
        await stopProtectionRefresh();
      }
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
    } finally {
      try {
        await this.taskProtection.unprotect();
      } catch (error) {
        this.stop();
        console.error(
          '[generation-worker] failed to release task protection; stopping worker',
          sanitizePersistedErrorMessage(error, 'Task protection release failed'),
        );
        throw error;
      }
    }
  }

  private startProtectionRefresh(expiresInMinutes: number): () => Promise<void> {
    let refreshFailure: unknown;
    let refreshInFlight: Promise<void> | undefined;
    const intervalMs = Math.max(
      MIN_TASK_PROTECTION_REFRESH_INTERVAL_MS,
      Math.floor((expiresInMinutes * 60_000) / 2),
    );
    const timer = setInterval(() => {
      if (refreshInFlight !== undefined) {
        return;
      }
      refreshInFlight = this.taskProtection.protect(expiresInMinutes)
        .catch((error: unknown) => {
          refreshFailure = error;
          this.stop();
          console.error(
            '[generation-worker] failed to refresh task protection; stopping after current work',
            sanitizePersistedErrorMessage(error, 'Task protection refresh failed'),
          );
        })
        .finally(() => {
          refreshInFlight = undefined;
        });
    }, intervalMs);
    unrefTimer(timer);

    return async (): Promise<void> => {
      clearInterval(timer);
      await refreshInFlight;
      if (refreshFailure !== undefined) {
        throw refreshFailure;
      }
    };
  }

  private taskProtectionExpiryMinutes(): number {
    return Math.min(
      MAX_TASK_PROTECTION_EXPIRY_MINUTES,
      Math.max(
        MIN_TASK_PROTECTION_EXPIRY_MINUTES,
        Math.ceil(this.effectiveVisibilityTimeoutSeconds() / 60) +
          TASK_PROTECTION_EXPIRY_BUFFER_MINUTES,
      ),
    );
  }

  private async receiveMessages(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: clampMaxNumberOfMessages(this.options.maxNumberOfMessages),
        WaitTimeSeconds: this.options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
        VisibilityTimeout: this.effectiveVisibilityTimeoutSeconds(),
      }),
    );

    return response.Messages ?? [];
  }

  private startVisibilityExtension(messages: Message[]): () => void {
    const entries = buildVisibilityEntries(messages);
    if (entries.length === 0) {
      return () => undefined;
    }

    const visibilityTimeoutSeconds = this.effectiveVisibilityTimeoutSeconds();
    const intervalMs = Math.max(
      MIN_VISIBILITY_EXTENSION_INTERVAL_MS,
      Math.floor((visibilityTimeoutSeconds * 1000) / 2),
    );
    const timer = setInterval(() => {
      void this.extendMessageVisibility(entries, visibilityTimeoutSeconds);
    }, intervalMs);
    unrefTimer(timer);

    return () => {
      clearInterval(timer);
    };
  }

  private async extendMessageVisibility(
    entries: Array<{ Id: string; ReceiptHandle: string }>,
    visibilityTimeoutSeconds: number,
  ): Promise<void> {
    try {
      const response = await this.client.send(
        new ChangeMessageVisibilityBatchCommand({
          QueueUrl: this.options.queueUrl,
          Entries: entries.map((entry) => ({
            ...entry,
            VisibilityTimeout: visibilityTimeoutSeconds,
          })),
        }),
      );
      if (response.Failed !== undefined && response.Failed.length > 0) {
        console.warn(
          '[generation-worker] failed to extend one or more SQS message visibility timeouts',
          response.Failed.map((failure) =>
            sanitizePersistedErrorMessage(failure.Message ?? failure.Id ?? 'ChangeMessageVisibilityBatch failed', 'Visibility extension failed'),
          ),
        );
      }
    } catch (error) {
      console.warn(
        '[generation-worker] failed to extend SQS message visibility timeout',
        sanitizePersistedErrorMessage(error, 'Visibility extension failed'),
      );
    }
  }

  private async returnMessagesForRetry(messages: Message[]): Promise<void> {
    const entries = buildVisibilityEntries(messages);
    if (entries.length === 0) {
      return;
    }

    try {
      const response = await this.client.send(
        new ChangeMessageVisibilityBatchCommand({
          QueueUrl: this.options.queueUrl,
          Entries: entries.map((entry) => ({
            ...entry,
            VisibilityTimeout: 0,
          })),
        }),
      );
      if (response.Failed !== undefined && response.Failed.length > 0) {
        console.warn(
          '[generation-worker] failed to immediately return one or more stopped messages for retry',
          response.Failed.map((failure) =>
            sanitizePersistedErrorMessage(
              failure.Message ?? failure.Id ?? 'ChangeMessageVisibilityBatch failed',
              'Retry visibility reset failed',
            ),
          ),
        );
      }
    } catch (error) {
      console.warn(
        '[generation-worker] failed to immediately return stopped messages for retry',
        sanitizePersistedErrorMessage(error, 'Retry visibility reset failed'),
      );
    }
  }

  private effectiveVisibilityTimeoutSeconds(): number {
    return this.options.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
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

function emptyPollResult(): GenerationQueuePollResult {
  return {
    receivedCount: 0,
    deletedCount: 0,
    retryCount: 0,
    handlerResult: null,
  };
}

function buildVisibilityEntries(messages: Message[]): Array<{ Id: string; ReceiptHandle: string }> {
  return messages.flatMap((message, index) => {
    if (message.ReceiptHandle === undefined) {
      return [];
    }

    return [{
      Id: String(index),
      ReceiptHandle: message.ReceiptHandle,
    }];
  });
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

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }
}
