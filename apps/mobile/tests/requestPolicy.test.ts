import { describe, expect, it } from 'vitest';

import {
  apiRetryDelay,
  isRetryableRequestError,
  requestTimeoutMs,
  shouldRetryApiQuery
} from '@/lib/requestPolicy';
import { ApiError } from '@/lib/api';

describe('request policy', () => {
  it('読み取りは15秒、書き込みは30秒でタイムアウトする', () => {
    expect(requestTimeoutMs('GET')).toBe(15_000);
    expect(requestTimeoutMs(undefined)).toBe(15_000);
    expect(requestTimeoutMs('POST')).toBe(30_000);
    expect(requestTimeoutMs('PUT')).toBe(30_000);
    expect(requestTimeoutMs('DELETE')).toBe(30_000);
  });

  it('一時的な通信失敗だけを再試行する', () => {
    expect(isRetryableRequestError(new TypeError('Network request failed'))).toBe(true);
    expect(isRetryableRequestError(new ApiError('busy', 429, null))).toBe(true);
    expect(isRetryableRequestError(new ApiError('gateway', 502, null))).toBe(true);
    expect(isRetryableRequestError(new ApiError('unavailable', 503, null))).toBe(true);
    expect(isRetryableRequestError(new ApiError('timeout', 504, null))).toBe(true);
    expect(isRetryableRequestError(new ApiError('unauthorized', 401, null))).toBe(false);
    expect(isRetryableRequestError(new ApiError('conflict', 409, null))).toBe(false);
    expect(isRetryableRequestError(new DOMException('timed out', 'AbortError'))).toBe(false);
  });

  it('再試行間隔を指数的に延ばす', () => {
    expect(apiRetryDelay(0)).toBe(500);
    expect(apiRetryDelay(1)).toBe(1_000);
    expect(apiRetryDelay(2)).toBe(2_000);
    expect(apiRetryDelay(9)).toBe(4_000);
  });
  it('429は自動再試行せず利用者の明示操作を待つ', () => {
    expect(shouldRetryApiQuery(0, new ApiError('busy', 429, 'RATE_LIMITED')))
      .toBe(false);
    expect(shouldRetryApiQuery(0, new ApiError('unavailable', 503, null)))
      .toBe(true);
  });
});
