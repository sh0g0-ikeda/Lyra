import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createOriginGuardMiddleware } from '../../../src/middleware/originGuard.js';

describe('createOriginGuardMiddleware', () => {
  it('Origin Guard header が一致する場合に通す', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware({ headerName: 'X-Lyra-Origin-Guard', headerValue: 'secret' }));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works', {
      headers: { 'X-Lyra-Origin-Guard': 'secret' },
    });

    expect(response.status).toBe(200);
  });

  it('Origin Guard header がない通常リクエストを 404 にする', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware({ headerName: 'X-Lyra-Origin-Guard', headerValue: 'secret' }));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works');

    expect(response.status).toBe(404);
  });

  it('ALB health check 用の /healthz は header なしでも通す', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware({ headerName: 'X-Lyra-Origin-Guard', headerValue: 'secret' }));
    app.get('/healthz', (c) => c.json({ ok: true }));

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
  });

  it('設定がない場合は無効化される', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware({}));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works');

    expect(response.status).toBe(200);
  });
});
