import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { PageGenerationWarmupService } from '../services/generation/PageGenerationWarmupService.js';
import type { AppEnv } from '../types/app.js';
import { parseOptionalOrganizationId } from './organizationRouteHelpers.js';

export interface PageGenerationWarmupRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  warmupService: Pick<PageGenerationWarmupService, 'warmup'>;
}
export function createPageGenerationWarmupRoutes(dependencies: PageGenerationWarmupRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);
  app.post('/pages/:id/generation-warmup', async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param('id'));
    if (!parsed.success) throw new ValidationError('Invalid page id');
    await dependencies.warmupService.warmup(c.get('user').id, parsed.data, parseOptionalOrganizationId(c));
    return c.body(null, 204);
  });
  return app;
}
