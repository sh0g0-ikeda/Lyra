import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/app.js';

interface OriginGuardConfig {
  headerName?: string;
  headerValue?: string;
}

const ORIGIN_GUARD_EXEMPT_PATHS = new Set(['/healthz']);

export function createOriginGuardMiddleware(config: OriginGuardConfig): MiddlewareHandler<AppEnv> {
  const headerName = config.headerName?.trim();
  const headerValue = config.headerValue?.trim();

  if (headerName === undefined || headerName.length === 0 || headerValue === undefined || headerValue.length === 0) {
    return async (_c, next) => {
      return next();
    };
  }

  return async (c, next) => {
    if (ORIGIN_GUARD_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const receivedHeaderValue = c.req.header(headerName);
    if (receivedHeaderValue === undefined || !constantTimeEquals(receivedHeaderValue, headerValue)) {
      return c.notFound();
    }

    return next();
  };
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
