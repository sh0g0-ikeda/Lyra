import { Hono } from 'hono';
import type { AppEnv } from '../types/app.js';

export type ReadinessCheck = () => Promise<void>;

interface HealthRouteDependencies {
  readinessCheck: ReadinessCheck;
}

export function createHealthRoutes(dependencies: HealthRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      service: 'lyra-api',
    }),
  );

  app.get('/readyz', async (c) => {
    try {
      await dependencies.readinessCheck();
      return c.json({ status: 'ready', service: 'lyra-api' });
    } catch {
      return c.json({ status: 'unavailable', service: 'lyra-api' }, 503);
    }
  });

  return app;
}
