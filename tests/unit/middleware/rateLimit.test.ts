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
  it('生成操作は通常の連続操作を妨げない上限を使用する', () => {
    expect(RATE_LIMIT_RULES.generation).toEqual({ maxRequests: 60, windowSeconds: 60 });
    expect(RATE_LIMIT_RULES.storyAi).toEqual({ maxRequests: 60, windowSeconds: 60 });
  });

  it.each([
    ['/api/pages/page-1/generate'],
    ['/api/entities/import-image'],
    ['/api/entities/entity-1/generate-reference'],
  ])('%s uses the generation bucket', async (path) => {
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

  it.each([
    ['/api/pages/page-1/autofill-from-scenes'],
    ['/api/episodes/episode-1/autofill-pages-from-story'],
    ['/api/episodes/episode-1/generate-page-skeleton'],
    ['/api/story/collaborate'],
    ['/api/story/improve-episode-draft'],
  ])('%s uses the text AI bucket', async (path) => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request(path, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'storyAi:user-1',
        maxRequests: RATE_LIMIT_RULES.storyAi.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.storyAi.windowSeconds,
      },
    ]);
  });

  it.each([
    ['/api/works/work-1'],
    ['/api/scenes/scene-1'],
  ])('%s uses the story editing bucket', async (path) => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request(path, { method: 'PUT' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'story:user-1',
        maxRequests: RATE_LIMIT_RULES.story.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.story.windowSeconds,
      },
    ]);
  });

  it('page skeleton generation and story autofill do not consume the generation bucket', async () => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    await app.request('/api/episodes/episode-1/generate-page-skeleton', { method: 'POST' });
    await app.request('/api/episodes/episode-1/autofill-pages-from-story', { method: 'POST' });

    expect(store.calls.map((call) => call.key)).toEqual([
      'storyAi:user-1',
      'storyAi:user-1',
    ]);
  });

  it.each([
    ['/api/organizations/org-1/invitations'],
    ['/api/organizations/org-1/invitations/invitation-1/resend'],
    ['/api/organizations/org-1/invitations/invitation-1/revoke'],
    ['/api/organization-invitations/accept'],
    ['/api/invitations/token-1/accept'],
  ])('%s uses the invitation bucket', async (path) => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request(path, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'invitation:user-1',
        maxRequests: RATE_LIMIT_RULES.invitation.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.invitation.windowSeconds,
      },
    ]);
  });

  it.each([
    ['/api/billing/checkout/subscription'],
    ['/api/billing/checkout/credits'],
    ['/api/billing/customer-portal'],
    ['/api/organizations/org-1/billing/checkout/subscription'],
    ['/api/organizations/org-1/billing/subscription-checkout-session'],
    ['/api/organizations/org-1/billing/checkout/credits'],
    ['/api/organizations/org-1/billing/credit-pack-checkout-session'],
    ['/api/organizations/org-1/billing/customer-portal'],
    ['/api/organizations/org-1/billing/customer-portal-session'],
  ])('%s uses the billing action bucket', async (path) => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request(path, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'billingAction:user-1',
        maxRequests: RATE_LIMIT_RULES.billingAction.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.billingAction.windowSeconds,
      },
    ]);
  });

  it('read routes use the read bucket', async () => {
    const store = new RecordingRateLimitStore();
    const app = createAuthenticatedTestApp(store);

    const response = await app.request('/api/works', { method: 'GET' });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'read:user-1',
        maxRequests: RATE_LIMIT_RULES.read.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.read.windowSeconds,
      },
    ]);
  });
});

describe('createPublicIpRateLimitMiddleware', () => {
  it('public webhooks use the last X-Forwarded-For IP for the webhook bucket', async () => {
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

  it('CloudFront-Viewer-Address takes precedence with the port removed', async () => {
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

  it('invalid public IP headers are normalized to unknown', async () => {
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
