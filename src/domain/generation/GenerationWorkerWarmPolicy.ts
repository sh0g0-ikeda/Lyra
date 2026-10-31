export const GENERATION_WORKER_WARM_IDLE_SECONDS = 20 * 60;
export const GENERATION_WORKER_RECONCILE_INTERVAL_MS = 30_000;
export const GENERATION_WORKER_AWS_TIMEOUT_MS = 2_000;
export function getGenerationWorkerWarmFloor(now: Date, leaseUntil: Date | null, hasActiveJobs: boolean): 0 | 1 {
  // Calendar time does not reserve capacity; work and the shared idle lease do.
  return hasActiveJobs || (leaseUntil !== null && leaseUntil.getTime() > now.getTime()) ? 1 : 0;
}
