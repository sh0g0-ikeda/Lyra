import { z } from 'zod';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { resolveWorkerDependencies, type WorkerDependencies } from './dependencies.js';
export type { WorkerDependencies } from './dependencies.js';

const queueMessageSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.string().min(1),
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
  status: 'completed' | 'failed' | 'skipped';
  reason?: string;
}

export interface WorkerBatchResult {
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  results: WorkerRecordResult[];
}

export async function handleGenerationQueue(
  event: WorkerQueueEvent,
  dependencies: WorkerDependencies = resolveWorkerDependencies(),
): Promise<WorkerBatchResult> {
  const results: WorkerRecordResult[] = [];

  for (const record of event.Records) {
    const parsedMessage = parseQueueMessage(record.body);
    if (parsedMessage === null) {
      results.push({
        messageId: record.messageId ?? null,
        jobId: null,
        status: 'failed',
        reason: 'Invalid queue message',
      });
      continue;
    }

    if (parsedMessage.job_type !== 'page_generate' && parsedMessage.job_type !== 'entity_generate') {
      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status: 'skipped',
        reason: `Unsupported job_type: ${parsedMessage.job_type}`,
      });
      continue;
    }

    try {
      const result = parsedMessage.job_type === 'page_generate'
        ? await dependencies.pageGenerationWorkerService.processJob(parsedMessage.job_id)
        : await dependencies.entityGenerationWorkerService.processJob(parsedMessage.job_id);
      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status: result.status === 'skipped' ? 'skipped' : result.jobStatus ?? 'completed',
      });
    } catch (error) {
      results.push({
        messageId: record.messageId ?? null,
        jobId: parsedMessage.job_id,
        status: 'failed',
        reason: sanitizePersistedErrorMessage(error, 'Worker processing failed'),
      });
    }
  }

  return {
    processedCount: results.filter((result) => result.status === 'completed').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    results,
  };
}

function parseQueueMessage(body: string): z.infer<typeof queueMessageSchema> | null {
  try {
    const payload = JSON.parse(body) as unknown;
    const parsed = queueMessageSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
