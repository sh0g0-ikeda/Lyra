import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';

describe('画像を保持するページ再設計の能力確認', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('能力確認に成功した場合にだけ画像保持を有効と判断する', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ preserve_generated_images: true })));
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.getPageSkeletonCapabilities()).resolves.toEqual({ preserve_generated_images: true });
    expect(fetch.mock.calls[0]?.[0]).toContain('/api/story/page-skeleton-capabilities');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer token');
  });
  it.each([{ preserve_generated_images: 'true' }, {}, { preserve_generated_images: true, unknown: true }])('不正な能力応答の場合に有効と判断しない', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.getPageSkeletonCapabilities()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
  it('旧サーバーで能力APIがない場合に404を保ったまま失敗する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 })));
    const api = new LyraMobileApiClient(() => 'token');
    await expect(api.getPageSkeletonCapabilities()).rejects.toMatchObject({ status: 404 });
  });
});
