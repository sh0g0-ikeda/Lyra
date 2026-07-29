import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

describe('entity generation availability API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('サーバーの生成機能設定をruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: false }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getEntityReferenceGenerationAvailability()).resolves.toEqual({
      enabled: false
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/api/entities/reference-generation-availability'
    );
  });

  it('壊れたavailability応答を利用しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ enabled: 'yes' }), { status: 200 })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getEntityReferenceGenerationAvailability()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE'
    });
  });
  it('旧APIが固定パスをIDとして422にした場合は生成APIを利用可能として扱う', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'id must be a valid UUID'
            }
          }),
          { status: 422 }
        )
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getEntityReferenceGenerationAvailability()).resolves.toEqual({
      enabled: true
    });
  });
});
