import crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/app.js';

export function createRequestContextMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    c.set('requestId', requestId);

    await next();

    const durationMs = Date.now() - startedAt;
    const user = c.var.user;
    c.res.headers.set('x-request-id', requestId);

    console.info(
      JSON.stringify({
        level: 'info',
        event: 'http_request_completed',
        request_id: requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: durationMs,
        user_id: user?.id ?? null,
      }),
    );
  };
}
