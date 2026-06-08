import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  createCorsMiddleware,
  parseCorsAllowedOrigins,
} from '../../../src/middleware/cors.js';
import type { AppEnv } from '../../../src/types/app.js';

describe('createCorsMiddleware', () => {
  it('許可された Origin の API preflight に CORS ヘッダーを返す', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createCorsMiddleware(['https://app.lyra.test']));
    app.post('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.lyra.test',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.lyra.test');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('x-request-id');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('許可されていない Origin の API preflight は拒否する', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createCorsMiddleware(['https://app.lyra.test']));
    app.post('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('通常リクエストでは許可された Origin にだけ CORS ヘッダーを付与する', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createCorsMiddleware(['https://app.lyra.test']));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works', {
      headers: {
        Origin: 'https://app.lyra.test',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.lyra.test');
  });

  it('Origin がないサーバー間リクエストには CORS ヘッダーを付けない', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createCorsMiddleware(['https://app.lyra.test']));
    app.get('/healthz', (c) => c.json({ ok: true }));

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('許可された Origin のエラーレスポンスにも CORS ヘッダーを付与する', async () => {
    const app = new Hono<AppEnv>();
    app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR' } }, 500));
    app.use('*', createCorsMiddleware(['https://app.lyra.test']));
    app.get('/api/boom', () => {
      throw new Error('boom');
    });

    const response = await app.request('/api/boom', {
      headers: {
        Origin: 'https://app.lyra.test',
      },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.lyra.test');
  });
});

describe('parseCorsAllowedOrigins', () => {
  it('カンマ区切りの Origin を正規化する', () => {
    expect(parseCorsAllowedOrigins(' https://app.lyra.test,https://admin.lyra.test/ ')).toEqual([
      'https://app.lyra.test',
      'https://admin.lyra.test',
    ]);
  });

  it('未設定なら空配列にする', () => {
    expect(parseCorsAllowedOrigins(undefined)).toEqual([]);
  });
});
