import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/app.js';

const API_CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const DEFAULT_API_CORS_HEADERS = 'authorization, content-type';
const API_CORS_MAX_AGE_SECONDS = '600';

/**
 * Allows browser clients hosted on explicit origins to call the API when the
 * web app and API are deployed on separate domains. Same-origin deployments do
 * not need this middleware and keep an empty allow-list.
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowAllOrigins = allowedOrigins.includes('*');
  const allowedOriginSet = new Set(allowedOrigins.filter((origin) => origin !== '*'));

  return async (c, next) => {
    const origin = c.req.header('Origin');
    const isApiRequest = c.req.path.startsWith('/api/');

    if (origin === undefined || !isApiRequest) {
      await next();
      return undefined;
    }

    const originAllowed = allowAllOrigins || allowedOriginSet.has(origin);
    if (!originAllowed) {
      if (c.req.method === 'OPTIONS') {
        return c.body(null, 403);
      }

      await next();
      return undefined;
    }

    applyCorsHeaders(c.res.headers, origin, c.req.header('Access-Control-Request-Headers'));

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
    applyCorsHeaders(c.res.headers, origin, c.req.header('Access-Control-Request-Headers'));
    return undefined;
  };
}

export function parseCorsAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null);
}

function applyCorsHeaders(headers: Headers, origin: string, requestedHeaders: string | undefined): void {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', API_CORS_METHODS);
  headers.set('Access-Control-Allow-Headers', requestedHeaders ?? DEFAULT_API_CORS_HEADERS);
  headers.set('Access-Control-Max-Age', API_CORS_MAX_AGE_SECONDS);
  headers.set('Vary', appendVary(headers.get('Vary'), 'Origin'));
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === '*') {
    return '*';
  }

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/u, '');
  }
}

function appendVary(currentValue: string | null, nextValue: string): string {
  if (currentValue === null || currentValue.length === 0) {
    return nextValue;
  }

  const values = currentValue.split(',').map((value) => value.trim().toLowerCase());
  return values.includes(nextValue.toLowerCase()) ? currentValue : `${currentValue}, ${nextValue}`;
}
