import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { CompositionGalleryItem } from '../domain/types/composition.js';
import { compositionGalleryQuerySchema } from '../lib/validators/composition.schema.js';
import type { CompositionGalleryServicePort } from '../services/composition/CompositionGalleryService.js';
import type { AppEnv } from '../types/app.js';

export interface CompositionRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  compositionGalleryService: CompositionGalleryServicePort;
}

export function createCompositionRoutes(dependencies: CompositionRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/compositions', async (c) => {
    const query = compositionGalleryQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      throw new ValidationError(query.error.message);
    }

    const compositions = await dependencies.compositionGalleryService.listCompositions({
      category: query.data.category ?? null,
      entityCount: query.data.entity_count ?? null,
      tag: query.data.tag ?? null,
      limit: query.data.limit,
    });

    return c.json({ compositions: compositions.map(toCompositionResponse) });
  });

  return app;
}

function toCompositionResponse(composition: CompositionGalleryItem): Record<string, unknown> {
  return {
    id: composition.id,
    name: composition.name,
    category: composition.category,
    entity_count: composition.entityCount,
    preview_cdn_url: composition.previewCdnUrl,
    composition_prompt: composition.compositionPrompt,
    shot_type: composition.shotType,
    angle: composition.angle,
    tags: composition.tags,
    created_at: composition.createdAt.toISOString(),
  };
}
