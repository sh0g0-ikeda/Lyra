import { EPISODE_LONG_JOB_STALE_AFTER_MS } from '../../domain/constants/generation.js';
import type { GenerationJob } from '../../domain/types/job.js';

export const EPISODE_LONG_JOB_STALE_ERROR_MESSAGE =
  'Long-running story/page planning job stopped before completion; recovered stale queued or processing job';

export function isStaleEpisodeLongJob(
  job: GenerationJob,
  nowMs: number = Date.now(),
  staleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
): boolean {
  const lastActivity = getEpisodeLongJobLastActivityTime(job);
  return nowMs - lastActivity.getTime() >= staleAfterMs;
}

export function getEpisodeLongJobLastActivityTime(job: GenerationJob): Date {
  const progressUpdatedAt = readIsoDateParam(job.result, 'progress_updated_at');
  if (progressUpdatedAt !== null) {
    return progressUpdatedAt;
  }

  return job.startedAt ?? job.createdAt;
}

function readIsoDateParam(params: Record<string, unknown> | null, key: string): Date | null {
  if (params === null) {
    return null;
  }

  const value = params[key];
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
