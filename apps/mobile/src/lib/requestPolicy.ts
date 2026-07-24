const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;
export const SSE_IDLE_TIMEOUT_MS = 90_000;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

const isReadMethod = (method: string | undefined): boolean => {
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
};

export const requestTimeoutMs = (method: string | undefined): number =>
  isReadMethod(method) ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;

export const isRetryableRequestError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = Reflect.get(error, 'status');
  return typeof status === 'number' && RETRYABLE_STATUS_CODES.has(status);
};

export const apiRetryDelay = (failureCount: number): number =>
  Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, failureCount)));

export const shouldRetryApiQuery = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 && isRetryableRequestError(error);
