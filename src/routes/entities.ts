import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { Entity } from '../domain/types/entity.js';
import {
  createEntityBodySchema,
  updateEntityBodySchema,
  uuidParamSchema,
} from '../lib/validators/entity.schema.js';
import type { EntityServicePort } from '../services/entity/EntityService.js';
import type { AppEnv } from '../types/app.js';

export interface EntityRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  entityService: EntityServicePort;
}

export function createEntityRoutes(dependencies: EntityRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/works/:work_id/entities', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'work_id');
    const body = createEntityBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const entity = await dependencies.entityService.createEntity(user.id, workId, {
      entityType: body.data.entity_type,
      name: body.data.name,
      freeDescription: body.data.free_description ?? null,
      structuredFields: body.data.structured_fields ?? {},
      speechProfile: body.data.speech_profile ?? {},
    });

    return c.json(toEntityResponse(entity), 201);
  });

  app.get('/works/:work_id/entities', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'work_id');
    const entities = await dependencies.entityService.listEntities(user.id, workId);

    return c.json({
      entities: entities.map(toEntityResponse),
    });
  });

  app.get('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const entity = await dependencies.entityService.getEntity(user.id, entityId);

    return c.json(toEntityResponse(entity));
  });

  app.put('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const body = updateEntityBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const entity = await dependencies.entityService.updateEntity(user.id, entityId, {
      entityType: body.data.entity_type,
      name: body.data.name,
      freeDescription: body.data.free_description,
      structuredFields: body.data.structured_fields,
      speechProfile: body.data.speech_profile,
    });

    return c.json(toEntityResponse(entity));
  });

  app.delete('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    await dependencies.entityService.deleteEntity(user.id, entityId);

    return c.body(null, 204);
  });

  return app;
}

async function readJsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toEntityResponse(entity: Entity): Record<string, unknown> {
  return {
    id: entity.id,
    work_id: entity.workId,
    user_id: entity.userId,
    entity_type: entity.entityType,
    name: entity.name,
    free_description: entity.freeDescription,
    structured_fields: entity.structuredFields,
    prompt_supplement: entity.promptSupplement,
    speech_profile: entity.speechProfile,
    status: entity.status,
    created_at: entity.createdAt.toISOString(),
    updated_at: entity.updatedAt.toISOString(),
  };
}
