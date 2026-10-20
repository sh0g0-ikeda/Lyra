import { describe, expect, it, vi } from 'vitest';

import { fetchXAuthCapabilities, xAllowedOnWeb } from '../../../apps/web/src/lib/xAuth.js';

describe('X sign-in capability', () => {
  it('iOSとtouch MacではX CTAをfail closedにする', () => {
    const enabled = { x_sign_in: true, x_android: true, x_ios: false };
    expect(xAllowedOnWeb(enabled, 'Win32', 0)).toBe(true);
    expect(xAllowedOnWeb(enabled, 'iPhone', 0)).toBe(false);
    expect(xAllowedOnWeb(enabled, 'MacIntel', 5)).toBe(false);
    expect(xAllowedOnWeb(undefined, 'Win32', 0)).toBe(false);
  });

  it('credentialsなしでcapabilityを取得し、失敗した応答は拒否する', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ x_sign_in: true, x_android: true, x_ios: false }), { status: 200 }));
    await expect(fetchXAuthCapabilities(fetcher)).resolves.toEqual({ x_sign_in: true, x_android: true, x_ios: false });
    expect(fetcher).toHaveBeenCalledWith('/api/auth/x/capabilities', expect.objectContaining({ credentials: 'omit' }));

    await expect(fetchXAuthCapabilities(async () => new Response('{}', { status: 503 }))).rejects.toThrow('X_CAPABILITY_UNAVAILABLE');
  });
  it('10秒応答しない場合に取得を中止して操作を復帰できる', async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('ABORTED'))));
      const rejected = expect(fetchXAuthCapabilities(fetcher)).rejects.toThrow('ABORTED');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});
