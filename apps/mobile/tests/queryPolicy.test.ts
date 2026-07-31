import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import {
  mobileQueryRetryDelay,
  shouldRetryMobileQuery,
} from '../src/lib/queryPolicy';

describe('mobile query policy', () => {
  it('一時障害だけを上限付きで再試行する', () => {
    expect(shouldRetryMobileQuery(0, new ApiError('SERVER_ERROR', 500, 'x'))).toBe(
      true,
    );
    expect(
      shouldRetryMobileQuery(1, new ApiError('RATE_LIMITED', 429, 'x')),
    ).toBe(true);
    expect(
      shouldRetryMobileQuery(2, new ApiError('SERVER_ERROR', 503, 'x')),
    ).toBe(false);
    expect(
      shouldRetryMobileQuery(0, new ApiError('REQUEST_FAILED', 400, 'x')),
    ).toBe(false);
  });

  it('再試行間隔を指数的かつ上限内に保つ', () => {
    expect(mobileQueryRetryDelay(0)).toBe(1_000);
    expect(mobileQueryRetryDelay(1)).toBe(2_000);
    expect(mobileQueryRetryDelay(20)).toBe(8_000);
  });
});
