import { z } from 'zod';
import type {
  ProcessEpisodeExportJobResult,
} from '../src/services/export/EpisodeExportWorkerService.js';

const episodeExportQueueMessageSchema = z
  .object({
    version: z.literal(1),
    export_job_id: z.string().uuid(),
  })
  .strict();

export interface EpisodeExportWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodeExportJobResult>;
}

export interface EpisodeExportWorkerDependencies {
  episodeExportWorkerService: EpisodeExportWorkerPort;
}

export interface EpisodeExportQueueRecord {
  body: string;
  messageId?: string;
}

export interface EpisodeExportQueueEvent {
  Records: EpisodeExportQueueRecord[];
}

export interface EpisodeExportWorkerRecordResult {
  messageId: string | null;
  jobId: string | null;
  status: 'completed' | 'failed' | 'skipped' | 'retry';
  reason?: string;
}

export interface EpisodeExportWorkerBatchResult {
  processedCount: number;
  skippedCount: number;
  retryCount: number;
  failedCount: number;
  batchItemFailures: Array<{ itemIdentifier: string }>;
  results: EpisodeExportWorkerRecordResult[];
}

export async function handleEpisodeExportQueue(
  event: EpisodeExportQueueEvent,
  dependencies: EpisodeExportWorkerDependencies,
): Promise<EpisodeExportWorkerBatchResult> {
  const results: EpisodeExportWorkerRecordResult[] = [];
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const message = parseMessage(record.body);
    if (message === null) {
      results.push({
        messageId: record.messageId ?? null,
        jobId: null,
        status: 'failed',
        reason: 'Invalid episode export queue message',
      });
      continue;
    }

    try {
      const result = await dependencies.episodeExportWorkerService.processJob(
        message.export_job_id,
      );
      if (result.status === 'retry') {
        addBatchItemFailure(batchItemFailures, record.messageId);
        results.push({
          messageId: record.messageId ?? null,
          jobId: message.export_job_id,
          status: 'retry',
          reason: result.reason ?? 'Episode export worker requested retry',
        });
        continue;
      }
      results.push({
        messageId: record.messageId ?? null,
        jobId: message.export_job_id,
        status: result.status === 'skipped' ? 'skipped' : 'completed',
        reason: result.reason,
      });
    } catch (error) {
      void error;
      addBatchItemFailure(batchItemFailures, record.messageId);
      results.push({
        messageId: record.messageId ?? null,
        jobId: message.export_job_id,
        status: 'failed',
        reason: 'Episode export worker processing failed',
      });
    }
  }

  return {
    processedCount: results.filter((result) => result.status === 'completed').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    retryCount: results.filter((result) => result.status === 'retry').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    batchItemFailures,
    results,
  };
}

function parseMessage(
  body: string,
): z.infer<typeof episodeExportQueueMessageSchema> | null {
  try {
    const parsed = episodeExportQueueMessageSchema.safeParse(
      JSON.parse(body) as unknown,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function addBatchItemFailure(
  failures: Array<{ itemIdentifier: string }>,
  messageId: string | undefined,
): void {
  if (messageId !== undefined && messageId.length > 0) {
    failures.push({ itemIdentifier: messageId });
  }
}
