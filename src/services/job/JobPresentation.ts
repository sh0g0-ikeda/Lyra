import { createHash } from 'node:crypto';
import type { GenerationJob } from '../../domain/types/job.js';

export function toJobPresentation(job: GenerationJob, cancellationEnabled: boolean): Record<string, unknown> {
  const progress = toJobProgress(job); const error = toSafeJobError(job);
  return { status: job.status === 'cancelled' ? 'canceled' : job.status,
    ...(job.creditSettlement === undefined ? {} : { credit_settlement: { charged_credits: job.creditSettlement.chargedCredits, refunded_credits: job.creditSettlement.refundedCredits, net_credits: job.creditSettlement.netCredits, status: job.creditSettlement.status } }),
    error_message: error.message, error_code: error.code, message_key: error.messageKey, retryable: error.retryable, support_id: error.supportId,
    progress_stage: progress.stage, progress_percent: progress.percent, progress_updated_at: progress.updatedAt?.toISOString() ?? null,
    updated_at: progress.updatedAt?.toISOString() ?? job.completedAt?.toISOString() ?? job.startedAt?.toISOString() ?? job.createdAt.toISOString(),
    actions: toJobActions(job, cancellationEnabled)
  };
}

type JobProgressStage =
  | 'queued'
  | 'compiling'
  | 'preparing_references'
  | 'generating'
  | 'saving'
  | 'completed';

interface JobProgressResponse {
  stage: JobProgressStage | null;
  percent: number | null;
  updatedAt: Date | null;
}

interface SafeJobErrorResponse {
  code: string | null;
  messageKey: string | null;
  retryable: boolean;
  supportId: string | null;
  message: string | null;
}

function toJobProgress(job: GenerationJob): JobProgressResponse {
  if (job.status === 'queued') {
    return { stage: 'queued', percent: 0, updatedAt: job.createdAt };
  }
  if (job.status === 'completed') {
    return { stage: 'completed', percent: 100, updatedAt: job.completedAt ?? job.createdAt };
  }
  if (job.status !== 'processing') {
    return { stage: null, percent: null, updatedAt: readResultTimestamp(job.result, 'progress_updated_at') };
  }

  const directPercent = readResultNumber(job.result, 'progress_percent');
  const currentChunk = readResultNumber(job.result, 'progress_current_chunk');
  const totalChunks = readResultNumber(job.result, 'progress_total_chunks');
  const chunkPercent =
    currentChunk === null || totalChunks === null || totalChunks <= 0
      ? null
      : Math.round((Math.min(Math.max(currentChunk, 0), totalChunks) / totalChunks) * 100);
  return {
    stage: normalizeJobProgressStage(readResultString(job.result, 'progress_stage')),
    percent: directPercent === null ? chunkPercent : Math.round(Math.min(100, Math.max(0, directPercent))),
    updatedAt: readResultTimestamp(job.result, 'progress_updated_at') ?? job.startedAt ?? job.createdAt,
  };
}

function normalizeJobProgressStage(value: string | null): JobProgressStage | null {
  switch (value) {
    case 'started':
    case 'compiling':
    case 'compiling_chunk':
      return 'compiling';
    case 'preparing_references':
    case 'reference_images':
      return 'preparing_references';
    case 'generating':
    case 'rendering':
    case 'compiled_chunk':
    case 'applying_story_plan':
      return 'generating';
    case 'saving':
    case 'applying':
    case 'rolling_back':
      return 'saving';
    default:
      return null;
  }
}

function toSafeJobError(job: GenerationJob): SafeJobErrorResponse {
  if (job.status === 'cancelled') {
    return {
      code: 'JOB_CANCELLED',
      messageKey: 'job.error.cancelled',
      retryable: false,
      supportId: buildJobSupportId(job),
      message: 'The job was canceled.',
    };
  }
  if (job.status !== 'failed') {
    return { code: null, messageKey: null, retryable: false, supportId: null, message: null };
  }

  const raw = job.errorMessage?.toLowerCase() ?? '';
  const invalidProviderOutput = raw.includes('openai') && matchesAny(raw, [
    'returned an invalid payload', 'returned invalid json',
  ]);
  if (invalidProviderOutput) {
    return {
      code: 'GENERATION_TEMPORARILY_UNAVAILABLE',
      messageKey: 'job.error.temporarilyUnavailable',
      retryable: true,
      supportId: buildJobSupportId(job),
      message: 'Generation is temporarily unavailable. Please try again.',
    };
  }
  if (matchesAny(raw, ['invalid', 'validation', 'missing required', 'must be', 'unsupported input'])) {
    return {
      code: 'GENERATION_INPUT_INVALID',
      messageKey: 'job.error.inputInvalid',
      retryable: false,
      supportId: buildJobSupportId(job),
      message: 'The generation input could not be processed. Review the job inputs.',
    };
  }
  if (matchesAny(raw, ['429', 'rate limit', 'timeout', 'temporar', 'unavailable', 'connection', 'provider', 'openai', 'aws', 'sqs'])) {
    return {
      code: 'GENERATION_TEMPORARILY_UNAVAILABLE',
      messageKey: 'job.error.temporarilyUnavailable',
      retryable: true,
      supportId: buildJobSupportId(job),
      message: 'Generation is temporarily unavailable. Please try again.',
    };
  }
  return {
    code: 'GENERATION_FAILED',
    messageKey: 'job.error.failed',
    retryable: true,
    supportId: buildJobSupportId(job),
    message: 'Generation failed. Please try again.',
  };
}

function buildJobSupportId(job: GenerationJob): string {
  const digest = createHash('sha256')
    .update(`${job.id}:${job.createdAt.toISOString()}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `J-${digest}`;
}

function matchesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function toJobActions(job: GenerationJob, cancellationEnabled: boolean): Record<string, unknown> {
  const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  const cancellationPending =
    job.status === 'processing' &&
    job.cancelRequestedAt !== null &&
    job.cancelRequestedAt !== undefined;
  return {
    cancel: {
      available: cancellationEnabled && job.commitStartedAt === null && !cancellationPending && (job.status === 'queued' || job.status === 'processing'),
      reason_key:
        !cancellationEnabled || job.commitStartedAt !== null ? 'job.action.cancelProcessingUnsupported' : job.status === 'queued'
          ? null
          : cancellationPending
            ? 'job.action.cancelRequested'
          : job.status === 'processing'
            ? null
            : 'job.action.cancelOnlyActive',
    },
    hide: {
      available: terminal,
      reason_key: terminal ? null : 'job.action.hideOnlyTerminal',
    },
  };
}

function readResultString(result: Record<string, unknown> | null, key: string): string | null {
  const value = result?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readResultNumber(result: Record<string, unknown> | null, key: string): number | null {
  const value = result?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readResultTimestamp(result: Record<string, unknown> | null, key: string): Date | null {
  const value = readResultString(result, key);
  if (value === null) {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
