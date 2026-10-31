export const GENERATION_WORKER_WARM_IDLE_SECONDS = 20 * 60;
export const GENERATION_WORKER_RECONCILE_INTERVAL_MS = 30_000;
export const GENERATION_WORKER_AWS_TIMEOUT_MS = 2_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WARM_START_JST_HOUR = 13;
const WARM_END_JST_HOUR = 1;

export function getGenerationWorkerWarmFloor(now: Date, leaseUntil: Date | null, hasActiveJobs: boolean): 0 | 1 {
  const jstHour = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  const inWarmWindow = jstHour >= WARM_START_JST_HOUR || jstHour < WARM_END_JST_HOUR;
  return inWarmWindow || hasActiveJobs || (leaseUntil !== null && leaseUntil.getTime() > now.getTime()) ? 1 : 0;
}
