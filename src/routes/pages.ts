import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { PageFinalizeServicePort } from '../services/page/PageFinalizeService.js';
import type { PageGenerationServicePort } from '../services/page/PageGenerationService.js';
import type { AppEnv } from '../types/app.js';

const uuidParamSchema = z.string().uuid();

export interface PageRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pageFinalizeService: PageFinalizeServicePort;
  pageGenerationService: PageGenerationServicePort;
}

export function createPageRoutes(dependencies: PageRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/pages/:id/generate', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const result = await dependencies.pageGenerationService.enqueuePageGeneration(user.id, pageId);

    return c.json({ job_id: result.jobId }, 202);
  });

  app.post('/pages/:id/confirm', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    await dependencies.pageFinalizeService.confirmPage(user.id, pageId);

    return c.body(null, 204);
  });

  app.post('/pages/:id/reopen', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    await dependencies.pageFinalizeService.reopenPage(user.id, pageId);

    return c.body(null, 204);
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}
