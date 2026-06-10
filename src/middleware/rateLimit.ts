import type { MiddlewareHandler } from 'hono';
import {
  EPISODE_STORY_AUTOFILL_ROUTE_PATTERN,
  ENTITY_IMPORT_ROUTE_PATTERN,
  ENTITY_GENERATION_ROUTE_PATTERN,
  PAGE_AUTOFILL_ROUTE_PATTERN,
  PAGE_GENERATION_ROUTE_PATTERN,
  PAGE_SKELETON_GENERATION_ROUTE_PATTERN,
  RATE_LIMIT_RULES,
  STORY_COLLABORATION_ROUTE_PATTERN,
  STORY_EPISODE_IMPROVEMENT_ROUTE_PATTERN,
  STORY_ROUTE_PREFIXES,
  type RateLimitBucket,
} from '../domain/constants/rateLimit.js';
import { RateLimitError } from '../domain/errors/index.js';
import type { AppEnv } from '../types/app.js';

const MAX_RATE_LIMIT_CLIENT_IP_LENGTH = 64;
const RATE_LIMIT_CLIENT_IP_PATTERN = /^[0-9A-Fa-f:.%-]+$/u;

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

export function createPublicIpRateLimitMiddleware(
  store: RateLimitStore,
  bucket: RateLimitBucket,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rule = RATE_LIMIT_RULES[bucket];
    const clientIp = resolveCloudFrontViewerAddress(c.req.header('cloudfront-viewer-address'))
      ?? resolveClientIp(c.req.header('cf-connecting-ip'))
      ?? resolveClientIp(c.req.header('x-real-ip'))
      ?? resolveForwardedForClientIp(c.req.header('x-forwarded-for'))
      ?? 'unknown';
    const result = await store.consume(
      `${bucket}:public:${clientIp}`,
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
    ENTITY_GENERATION_ROUTE_PATTERN.test(path) ||
    STORY_COLLABORATION_ROUTE_PATTERN.test(path) ||
    STORY_EPISODE_IMPROVEMENT_ROUTE_PATTERN.test(path)
  ) {
    return 'generation';
  }

  if (STORY_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'story';
  }

  return 'default';
}

function resolveCloudFrontViewerAddress(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const closeBracketIndex = trimmed.indexOf(']');
    return closeBracketIndex > 1
      ? resolveClientIp(trimmed.slice(1, closeBracketIndex))
      : null;
  }

  const firstColonIndex = trimmed.indexOf(':');
  const lastColonIndex = trimmed.lastIndexOf(':');
  if (
    firstColonIndex > 0 &&
    firstColonIndex === lastColonIndex &&
    /^\d+$/u.test(trimmed.slice(lastColonIndex + 1))
  ) {
    return resolveClientIp(trimmed.slice(0, lastColonIndex));
  }

  return resolveClientIp(trimmed);
}

function resolveForwardedForClientIp(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const candidates = value.split(',').reverse();
  for (const candidate of candidates) {
    const clientIp = resolveClientIp(candidate);
    if (clientIp !== null) {
      return clientIp;
    }
  }

  return null;
}

function resolveClientIp(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_RATE_LIMIT_CLIENT_IP_LENGTH ||
    !RATE_LIMIT_CLIENT_IP_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}
