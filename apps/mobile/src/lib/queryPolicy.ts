import { ApiError } from './api';

const MAX_QUERY_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

export function shouldRetryMobileQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES || !(error instanceof ApiError)) {
    return false;
  }
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

export function mobileQueryRetryDelay(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptIndex), MAX_RETRY_DELAY_MS);
}
