import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createOriginGuardMiddleware } from '../../../src/middleware/originGuard.js';

const guardConfig = { headerName: 'X-Lyra-Origin-Guard', headerValue: 'secret' };

describe('createOriginGuardMiddleware', () => {
  it('passes protected requests when the Origin Guard header matches', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works', {
      headers: { 'X-Lyra-Origin-Guard': 'secret' },
    });

    expect(response.status).toBe(200);
  });

  it('hides protected requests when the Origin Guard header is missing', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works');

    expect(response.status).toBe(404);
  });

  it('allows the ALB health check path without the Origin Guard header', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.get('/healthz', (c) => c.json({ ok: true }));

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
  });

  it('allows the Stripe webhook path without the Origin Guard header', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.post('/api/webhooks/stripe', (c) => c.json({ ok: true }));

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Stripe-Signature': 't=1,v1=test',
      },
      body: '{}',
    });

    expect(response.status).toBe(200);
  });

  it('allows the root Stripe compatibility POST when a Stripe signature exists', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.post('/', (c) => c.json({ ok: true }));

    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'Stripe-Signature': 't=1,v1=test',
      },
      body: '{}',
    });

    expect(response.status).toBe(200);
  });

  it('keeps unsigned root POST hidden by Origin Guard', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware(guardConfig));
    app.post('/', (c) => c.json({ ok: true }));

    const response = await app.request('/', {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(404);
  });

  it('does nothing when the guard config is absent', async () => {
    const app = new Hono();
    app.use('*', createOriginGuardMiddleware({}));
    app.get('/api/works', (c) => c.json({ ok: true }));

    const response = await app.request('/api/works');

    expect(response.status).toBe(200);
  });
});
