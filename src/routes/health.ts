import { Hono } from 'hono';
import type { AppEnv } from '../types/app.js';

export function createHealthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      service: 'lyra-api',
    }),
  );

  return app;
}
