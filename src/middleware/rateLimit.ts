import type { MiddlewareHandler } from 'hono';
import {
  EPISODE_STORY_AUTOFILL_ROUTE_PATTERN,
  ENTITY_IMPORT_ROUTE_PATTERN,
  ENTITY_GENERATION_ROUTE_PATTERN,
  PAGE_AUTOFILL_ROUTE_PATTERN,
  PAGE_GENERATION_ROUTE_PATTERN,
  PAGE_SKELETON_GENERATION_ROUTE_PATTERN,
  RATE_LIMIT_RULES,
  STORY_ROUTE_PREFIXES,
  type RateLimitBucket,
} from '../domain/constants/rateLimit.js';
import { RateLimitError } from '../domain/errors/index.js';
import type { AppEnv } from '../types/app.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
}

export interface RateLimitStore {
  consume(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  public async consume(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const current = this.counters.get(key);

    if (current === undefined || current.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.counters.set(key, { count: 1, resetAt });

      return {
        allowed: true,
        remaining: Math.max(maxRequests - 1, 0),
        retryAfterSeconds: windowSeconds,
        resetAt: new Date(resetAt),
      };
    }

    if (current.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
        resetAt: new Date(current.resetAt),
      };
    }

    current.count += 1;
    this.counters.set(key, current);

    return {
      allowed: true,
      remaining: Math.max(maxRequests - current.count, 0),
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
      resetAt: new Date(current.resetAt),
    };
  }
}

export function createRateLimitMiddleware(store: RateLimitStore): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const bucket = classifyRateLimitBucket(c.req.path);
    const rule = RATE_LIMIT_RULES[bucket];
    const result = await store.consume(
      `${bucket}:${user.id}`,
      rule.maxRequests,
      rule.windowSeconds,
    );

    c.res.headers.set('x-ratelimit-limit', String(rule.maxRequests));
    c.res.headers.set('x-ratelimit-remaining', String(result.remaining));
    c.res.headers.set('x-ratelimit-reset', result.resetAt.toISOString());

    if (!result.allowed) {
      c.res.headers.set('retry-after', String(result.retryAfterSeconds));
      throw new RateLimitError(bucket, result.retryAfterSeconds);
    }

    await next();
    c.res.headers.set('x-ratelimit-limit', String(rule.maxRequests));
    c.res.headers.set('x-ratelimit-remaining', String(result.remaining));
    c.res.headers.set('x-ratelimit-reset', result.resetAt.toISOString());
  };
}

function classifyRateLimitBucket(path: string): RateLimitBucket {
  if (
    PAGE_GENERATION_ROUTE_PATTERN.test(path) ||
    PAGE_AUTOFILL_ROUTE_PATTERN.test(path) ||
    EPISODE_STORY_AUTOFILL_ROUTE_PATTERN.test(path) ||
    PAGE_SKELETON_GENERATION_ROUTE_PATTERN.test(path) ||
    ENTITY_IMPORT_ROUTE_PATTERN.test(path) ||
    ENTITY_GENERATION_ROUTE_PATTERN.test(path)
  ) {
    return 'generation';
  }

  if (STORY_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'story';
  }

  return 'default';
}
