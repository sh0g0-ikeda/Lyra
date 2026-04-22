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
});
