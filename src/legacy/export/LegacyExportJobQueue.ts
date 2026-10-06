import { randomUUID } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import {
  LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  withLegacyExportExternalTimeout,
} from './LegacyEpisodeExportJob.js';

export interface LegacyExportJobQueuePort { enqueue(payload: { jobId: string }): Promise<{ messageId: string | null }>; }
export interface LegacyExportJobProcessor { processJob(jobId: string): Promise<unknown>; }

export class UnconfiguredLegacyExportJobQueue implements LegacyExportJobQueuePort {
  public async enqueue(): Promise<never> { throw new ConfigurationError('Export job queue is not configured'); }
}

export class InlineLegacyExportJobQueue implements LegacyExportJobQueuePort {
  public constructor(private readonly processor: LegacyExportJobProcessor) {}
  public async enqueue(payload: { jobId: string }): Promise<{ messageId: string }> {
    const messageId = `inline-export-${randomUUID()}`;
    setTimeout(() => {
      void this.processor.processJob(payload.jobId).catch((error: unknown) => {
        console.error('[export-inline-worker] failed to process export job', sanitizePersistedErrorMessage(error, 'Export worker failed'));
      });
    }, 0);
    return { messageId };
  }
}

export interface LegacyExportQueueClient { send(command: SendMessageCommand): Promise<{ MessageId?: string }>; }

export class LegacySqsExportJobQueue implements LegacyExportJobQueuePort {
  public constructor(
    private readonly client: LegacyExportQueueClient,
    private readonly queueUrl: string,
    private readonly timeoutMs = LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  ) {}
  public async enqueue(payload: { jobId: string }): Promise<{ messageId: string | null }> {
    try {
      const result = await withLegacyExportExternalTimeout(
        () => this.client.send(new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({ job_id: payload.jobId, job_type: 'episode_export' }),
        })),
        this.timeoutMs,
      );
      return { messageId: result.MessageId ?? null };
    } catch {
      throw new ConfigurationError('Unable to enqueue export job');
    }
  }
}
