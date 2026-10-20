import { describe, expect, it, vi } from 'vitest';

import { fetchXAuthCapabilities, xAllowedOnMobile } from '@/lib/xAuth';

describe('X auth capabilities', () => {
  it('AndroidだけをXログイン対象にし、iOSと不完全なcapabilityはfail closedにする', () => {
    const enabled = { x_sign_in: true, x_android: true, x_ios: false };
    expect(xAllowedOnMobile(enabled, 'android')).toBe(true);
    expect(xAllowedOnMobile(enabled, 'ios')).toBe(false);
    expect(xAllowedOnMobile({ ...enabled, x_android: false }, 'android')).toBe(false);
    expect(xAllowedOnMobile(undefined, 'android')).toBe(false);
  });

  it('public capability endpointのHTTP失敗と不正なpayloadを拒否する', async () => {
    const unavailable = vi.fn(async () => new Response('{}', { status: 503 }));
    await expect(fetchXAuthCapabilities('https://api.example.test', unavailable)).rejects.toThrow('X_CAPABILITY_UNAVAILABLE');

    const malformed = vi.fn(async () => new Response(JSON.stringify({ x_sign_in: true }), { status: 200 }));
    await expect(fetchXAuthCapabilities('https://api.example.test', malformed)).rejects.toThrow();
  });
  it('10秒応答しない場合に取得を中止して操作を復帰できる', async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('ABORTED'))));
    await expect(fetchXAuthCapabilities('https://api.example.test', fetcher)).rejects.toThrow('ABORTED');
  }, 15_000);
});
