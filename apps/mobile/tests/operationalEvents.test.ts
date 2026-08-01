import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureHandledException,
  recordOperationalMetric,
  setOperationalEventSinks
} from '@/lib/operationalEvents';

describe('operational event sinks', () => {
  afterEach(() => {
    setOperationalEventSinks(null);
  });

  it('初期化前と無効環境ではmetricとexceptionを外部送信しない', () => {
    expect(() => {
      recordOperationalMetric({
        name: 'auth_failure',
        requestId: null,
        status: 401
      });
      captureHandledException(new Error('not sent'));
    }).not.toThrow();
  });

  it('production adapterが設定された場合だけ型付きeventを渡す', () => {
    const metric = vi.fn();
    const exception = vi.fn();
    setOperationalEventSinks({ exception, metric });
    const error = new Error('captured');

    recordOperationalMetric({
      name: 'job_failure',
      jobId: '11111111-1111-4111-8111-111111111111',
      requestId: null
    });
    captureHandledException(error);

    expect(metric).toHaveBeenCalledWith({
      name: 'job_failure',
      jobId: '11111111-1111-4111-8111-111111111111',
      requestId: null
    });
    expect(exception).toHaveBeenCalledWith(error);
  });
});
