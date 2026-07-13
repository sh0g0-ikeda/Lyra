import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';

describe('health route', () => {
  it('ヘルスチェックの場合にokを返す', async () => {
    const app = createApp();

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'lyra-api',
    });
  });

  it('DBへ接続できる場合にreadyを返す', async () => {
    const app = createApp({ readinessCheck: async () => undefined });

    const response = await app.request('/readyz');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      service: 'lyra-api',
    });
  });

  it('DBへ接続できない場合に詳細を隠して503を返す', async () => {
    const app = createApp({
      readinessCheck: async () => {
        throw new Error('sensitive database connection detail');
      },
    });

    const response = await app.request('/readyz');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'unavailable',
      service: 'lyra-api',
    });
  });
});
