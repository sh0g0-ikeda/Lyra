import { parseEpisodeExportQueueMessage } from '../src/domain/episodeExportQueueMessage.js';
import { z } from 'zod';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { resolveAttestedWorkerDependencies, type WorkerDependencies } from './dependencies.js';
export type { WorkerDependencies } from './dependencies.js';

const MAX_QUEUE_JOB_TYPE_LENGTH = 64;

const queueMessageSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.string().min(1).max(MAX_QUEUE_JOB_TYPE_LENGTH),
});

export interface WorkerQueueRecord {
  body: string;
  messageId?: string;
}

export interface WorkerQueueEvent {
  Records: WorkerQueueRecord[];
}

export interface WorkerRecordResult {
  messageId: string | null;
  jobId: string | null;
  status: 'completed' | 'failed' | 'skipped' | 'retry';
  reason?: string;
}

export interface WorkerBatchItemFailure {
  itemIdentifier: string;
}

export interface WorkerBatchResult {
  processedCount: number;
  skippedCount: number;
  retryCount: number;
  failedCount: number;
  batchItemFailures: WorkerBatchItemFailure[];
  results: WorkerRecordResult[];
}

export async function handleGenerationQueue(
  event: WorkerQueueEvent,
  dependencies?: WorkerDependencies,
): Promise<WorkerBatchResult> {
  const resolvedDependencies = dependencies ?? await resolveAttestedWorkerDependencies();
  const results: WorkerRecordResult[] = [];
  const batchItemFailures: WorkerBatchItemFailure[] = [];

  for (const record of event.Records) {
    const parsedMessage = parseQueueMessage(record.body);
    if (parsedMessage === null) {
      // Malformed queue messages are permanent input errors; retrying only blocks later work.
      results.push({
        messageId: record.messageId ?? null,
        jobId: null,
        status: 'failed',
        reason: 'Invalid queue message',
      });
      continue;
    }

    if (
      parsedMessage.job_type !== 'page_generate' &&
      parsedMessage.job_type !== 'entity_generate' &&
      parsedMessage.job_type !== 'entity_import_analysis' &&
      parsedMessage.job_type !== 'episode_story_autofill' &&
      parsedMessage.job_type !== 'episode_page_skeleton' &&
      parsedMessage.job_type !== 'episode_export'
    ) {
      // Unknown job types cannot become valid through SQS retry, so acknowledge and report them.
      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status: 'failed',
        reason: `Unsupported job_type: ${parsedMessage.job_type}`,
      });
      continue;
    }

    try {
      if (parsedMessage.job_type === 'episode_export' && resolvedDependencies.episodeExportWorkerService === undefined) {
        addBatchItemFailure(batchItemFailures, record.messageId);
        results.push({ messageId: record.messageId ?? null, jobId: parsedMessage.job_id, status: 'retry', reason: 'Episode export runtime is unavailable' });
        continue;
      }
      if (parsedMessage.job_type === 'entity_import_analysis' && resolvedDependencies.quotedImportWorkerService === undefined) {
        throw new Error('Quoted import worker is not configured');
      }
      const result = parsedMessage.job_type === 'episode_export'
        ? await resolvedDependencies.episodeExportWorkerService!.processJob(parsedMessage.job_id)
        : parsedMessage.job_type === 'entity_import_analysis'
        ? await resolvedDependencies.quotedImportWorkerService!.processJob(parsedMessage.job_id)
        : parsedMessage.job_type === 'page_generate'
        ? await resolvedDependencies.pageGenerationWorkerService.processJob(parsedMessage.job_id)
        : parsedMessage.job_type === 'entity_generate'
          ? await resolvedDependencies.entityGenerationWorkerService.processJob(parsedMessage.job_id)
          : parsedMessage.job_type === 'episode_story_autofill'
            ? await resolvedDependencies.episodeStoryAutofillWorkerService.processJob(parsedMessage.job_id)
            : await resolvedDependencies.episodePageSkeletonWorkerService.processJob(parsedMessage.job_id);
      if (result.status === 'retry') {
        addBatchItemFailure(batchItemFailures, record.messageId);
        results.push({
          messageId: record.messageId ?? null,
          jobId: parsedMessage.job_id,
          status: 'retry',
          reason: parsedMessage.job_type === 'episode_export' ? 'Episode export worker requested retry' : result.reason ?? 'Worker requested retry',
        });
        continue;
      }

      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status:
          result.status === 'skipped' || result.jobStatus === 'cancelled'
            ? 'skipped'
            : result.jobStatus ?? 'completed',
      });
    } catch (error) {
      addBatchItemFailure(batchItemFailures, record.messageId);
      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status: 'failed',
        reason: parsedMessage.job_type === 'episode_export' ? 'Episode export worker processing failed' : sanitizePersistedErrorMessage(error, 'Worker processing failed'),
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

function addBatchItemFailure(
  batchItemFailures: WorkerBatchItemFailure[],
  messageId: string | undefined,
): void {
  if (messageId !== undefined && messageId.length > 0) {
    batchItemFailures.push({ itemIdentifier: messageId });
  }
}

function parseQueueMessage(body: string): z.infer<typeof queueMessageSchema> | null {
  try {
    const payload = JSON.parse(body) as unknown;
    if (typeof payload === 'object' && payload !== null && ('export_job_id' in payload || ('job_type' in payload && payload.job_type === 'episode_export'))) {
      const jobId = parseEpisodeExportQueueMessage(payload);
      return jobId === null ? null : { job_id: jobId, job_type: 'episode_export' };
    }
    const parsed = queueMessageSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
