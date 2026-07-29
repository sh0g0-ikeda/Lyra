import { randomUUID } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';

export interface ExportJobQueuePort { enqueue(payload: { jobId: string }): Promise<{ messageId: string | null }>; }
export interface ExportJobProcessor { processJob(jobId: string): Promise<unknown>; }

export class UnconfiguredExportJobQueue implements ExportJobQueuePort {
  public async enqueue(): Promise<never> { throw new ConfigurationError('Export job queue is not configured'); }
}

export class InlineExportJobQueueAdapter implements ExportJobQueuePort {
  public constructor(private readonly processor: ExportJobProcessor) {}
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

export interface ExportQueueClient { send(command: SendMessageCommand): Promise<{ MessageId?: string }>; }

export class SqsExportJobQueueAdapter implements ExportJobQueuePort {
  public constructor(private readonly client: ExportQueueClient, private readonly queueUrl: string) {}
  public async enqueue(payload: { jobId: string }): Promise<{ messageId: string | null }> {
    try {
      const result = await this.client.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ job_id: payload.jobId, job_type: 'episode_export' }),
      }));
      return { messageId: result.MessageId ?? null };
    } catch {
      throw new ConfigurationError('Unable to enqueue export job');
    }
  }
}
