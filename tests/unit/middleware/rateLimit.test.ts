import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_RULES } from '../../../src/domain/constants/rateLimit.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import {
  createPublicIpRateLimitMiddleware,
  createRateLimitMiddleware,
  type RateLimitResult,
  type RateLimitStore,
} from '../../../src/middleware/rateLimit.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class RecordingRateLimitStore implements RateLimitStore {
  public readonly calls: Array<{ key: string; maxRequests: number; windowSeconds: number }> = [];

  public async consume(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
    this.calls.push({ key, maxRequests, windowSeconds });

    return {
      allowed: true,
      remaining: maxRequests - 1,
      retryAfterSeconds: windowSeconds,
      resetAt: new Date('2026-05-01T00:00:00.000Z'),
    };
  }
}

describe('createRateLimitMiddleware', () => {
  it.each([
    ['/api/pages/page-1/generate'],
    ['/api/pages/page-1/autofill-from-scenes'],
    ['/api/episodes/episode-1/autofill-pages-from-story'],
    ['/api/episodes/episode-1/generate-page-skeleton'],
    ['/api/entities/import-image'],
    ['/api/entities/entity-1/generate-reference'],
  ])('%s は generation bucket で制限する', async (path) => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request(path, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'generation:user-1',
        maxRequests: RATE_LIMIT_RULES.generation.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.generation.windowSeconds,
      },
    ]);
  });

  it('StoryAI route は story bucket で制限する', async () => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request('/api/story/collaborate', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'story:user-1',
        maxRequests: RATE_LIMIT_RULES.story.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.story.windowSeconds,
      },
    ]);
  });
});

describe('createPublicIpRateLimitMiddleware', () => {
  it('公開webhookをX-Forwarded-For末尾のIP単位の webhook bucket で制限する', async () => {
    const store = new RecordingRateLimitStore();
    const app = new Hono<AppEnv>();
    app.use('*', createPublicIpRateLimitMiddleware(store, 'webhook'));
    app.all('*', (c) => c.json({ ok: true }));

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
    });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'webhook:public:10.0.0.1',
        maxRequests: RATE_LIMIT_RULES.webhook.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.webhook.windowSeconds,
      },
    ]);
  });

  it('CloudFront-Viewer-Address がある場合はportを落として優先する', async () => {
    const store = new RecordingRateLimitStore();
    const app = new Hono<AppEnv>();
    app.use('*', createPublicIpRateLimitMiddleware(store, 'webhook'));
    app.all('*', (c) => c.json({ ok: true }));

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'cloudfront-viewer-address': '198.51.100.7:443',
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
    });

    expect(response.status).toBe(200);
    expect(store.calls[0]?.key).toBe('webhook:public:198.51.100.7');
  });

  it('公開IPヘッダーが不正な場合は unknown に丸める', async () => {
    const store = new RecordingRateLimitStore();
    const app = new Hono<AppEnv>();
    app.use('*', createPublicIpRateLimitMiddleware(store, 'webhook'));
    app.all('*', (c) => c.json({ ok: true }));

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'x-forwarded-for': 'not an ip value with spaces',
      },
    });

    expect(response.status).toBe(200);
    expect(store.calls[0]?.key).toBe('webhook:public:unknown');
  });
});

function createAuthenticatedTestApp(store: RateLimitStore): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.use('*', createRateLimitMiddleware(store));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}
