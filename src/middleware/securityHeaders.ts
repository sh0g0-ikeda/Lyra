import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/app.js';

const DEFAULT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;

/**
 * Adds defense-in-depth headers at the API edge. Route-specific headers, such
 * as local asset CORP/CORS during development, remain authoritative.
 */
export function createSecurityHeadersMiddleware(
  nodeEnv = process.env.NODE_ENV,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
      setHeaderIfAbsent(c.res.headers, name, value);
    }

    if (nodeEnv === 'production') {
      setHeaderIfAbsent(
        c.res.headers,
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }
  };
}

function setHeaderIfAbsent(headers: Headers, name: string, value: string): void {
  if (headers.get(name) === null) {
    headers.set(name, value);
  }
}
