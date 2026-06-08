import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_RULES } from '../../../src/domain/constants/rateLimit.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import {
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
  it('キャラ生成リクエストを generation bucket として制限する', async () => {
    const store = new RecordingRateLimitStore();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', user);
      await next();
    });
    app.use('*', createRateLimitMiddleware(store));
    app.post('/api/entities/:id/generate-reference', (c) => c.json({ ok: true }));

    const response = await app.request('/api/entities/entity-1/generate-reference', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        key: 'generation:user-1',
        maxRequests: RATE_LIMIT_RULES.generation.maxRequests,
        windowSeconds: RATE_LIMIT_RULES.generation.windowSeconds,
      },
    ]);
  });
});
