import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createPublicIpRateLimitMiddleware, type RateLimitStore } from '../../../src/middleware/rateLimit.js';
import type { AppEnv } from '../../../src/types/app.js';

describe('公開APIの偽装IPヘッダー', () => {
  it('信頼を設定していない場合に任意のヘッダーでbucketを変更できない', async () => {
    const keys: string[] = [];
    const store: RateLimitStore = { consume: async (key) => { keys.push(key); return { allowed: true, remaining: 1, retryAfterSeconds: 1, resetAt: new Date() }; } };
    const app = new Hono<AppEnv>();
    app.use('*', createPublicIpRateLimitMiddleware(store, 'webhook'));
    app.post('/', c => c.json({ received: true }));
    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      expect((await app.request('/', { method: 'POST', headers: { 'CloudFront-Viewer-Address': `${ip}:1234`, 'cf-connecting-ip': ip, 'x-real-ip': ip, 'x-forwarded-for': ip, 'Stripe-Signature': 'requires-actual-verification' } })).status).toBe(200);
    }
    expect(keys[0]).toBe(keys[1]);
  });
  it('origin認証に成功した場合だけCloudFrontの本人IPを使う', async () => {
    const keys: string[] = [];
    const store: RateLimitStore = { consume: async (key) => { keys.push(key); return { allowed: true, remaining: 1, retryAfterSeconds: 1, resetAt: new Date() }; } };
    const app = new Hono<AppEnv>();
    app.use('*', createPublicIpRateLimitMiddleware(store, 'webhook', { headerName: 'x-test-origin', headerValue: 'test-only-origin' }));
    app.post('/', c => c.json({ received: true }));
    for (const proof of ['wrong', 'test-only-origin']) {
      await app.request('/', { method: 'POST', headers: { 'x-test-origin': proof, 'CloudFront-Viewer-Address': '[2001:db8::1]:1234' } });
    }
    expect(keys).toEqual(['webhook:public:unknown', 'webhook:public:2001:db8::1']);
  });
});
