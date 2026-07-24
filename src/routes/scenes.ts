import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  entityStateSchema,
  entityStatesResponseSchema,
  sceneSchema,
  scenesResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import type { EntityState, Scene } from '../domain/types/scene.js';
import {
  createEntityStateBodySchema,
  createSceneBodySchema,
  sceneUuidParamSchema,
  updateEntityStateBodySchema,
  updateSceneBodySchema,
} from '../lib/validators/scene.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { SceneServicePort } from '../services/scene/SceneService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody } from './requestBody.js';

export interface SceneRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  sceneService: SceneServicePort;
  organizationService?: OrganizationServicePort;
}

export function createSceneRoutes(dependencies: SceneRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/episodes/:id/scenes', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createSceneBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const scene = await dependencies.sceneService.createScene(user.id, episodeId, {
      order: body.data.order,
      location: body.data.location ?? null,
      time: body.data.time ?? null,
      atmosphere: body.data.atmosphere ?? null,
      involvedEntityIds: body.data.involved_entity_ids ?? [],
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'scene.created', 'scene', scene.id, {
      episode_id: episodeId,
    });

    return c.json(assertMobileResponseContract(sceneSchema, toSceneResponse(scene)), 201);
  });

  app.get('/episodes/:id/scenes', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const scenes = await dependencies.sceneService.listScenes(user.id, episodeId, organizationId);

    const payload = { scenes: scenes.map(toSceneResponse) };
    return c.json(assertMobileResponseContract(scenesResponseSchema, payload));
  });

  app.put('/scenes/:id', async (c) => {
    const user = c.get('user');
    const sceneId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateSceneBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const scene = await dependencies.sceneService.updateScene(user.id, sceneId, {
      order: body.data.order,
      location: body.data.location,
      time: body.data.time,
      atmosphere: body.data.atmosphere,
      involvedEntityIds: body.data.involved_entity_ids,
      status: body.data.status,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'scene.updated', 'scene', sceneId, {
      fields: Object.keys(body.data),
    });

    return c.json(assertMobileResponseContract(sceneSchema, toSceneResponse(scene)));
  });

  app.delete('/scenes/:id', async (c) => {
    const user = c.get('user');
    const sceneId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.sceneService.deleteScene(user.id, sceneId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'scene.deleted', 'scene', sceneId);

    return c.body(null, 204);
  });

  app.get('/entities/:id/states', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const entityStates = await dependencies.sceneService.listEntityStates(user.id, entityId, organizationId);

    const payload = { entity_states: entityStates.map(toEntityStateResponse) };
    return c.json(assertMobileResponseContract(entityStatesResponseSchema, payload));
  });

  app.post('/entities/:id/states', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createEntityStateBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const entityState = await dependencies.sceneService.createEntityState(user.id, entityId, {
      sceneId: body.data.scene_id ?? null,
      costumeNote: body.data.costume_note ?? null,
      costumeRefId: body.data.costume_ref_id ?? null,
      conditionNote: body.data.condition_note ?? null,
      hairNote: body.data.hair_note ?? null,
      expressionDefault: body.data.expression_default,
      extraNote: body.data.extra_note ?? null,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity_state.created', 'entity_state', entityState.id, {
      entity_id: entityId,
      scene_id: body.data.scene_id ?? null,
    });

    return c.json(
      assertMobileResponseContract(entityStateSchema, toEntityStateResponse(entityState)),
      201,
    );
  });

  app.put('/entities/:id/states/:state_id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const stateId = parseUuidParam(c, 'state_id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateEntityStateBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const entityState = await dependencies.sceneService.updateEntityState(user.id, entityId, stateId, {
      sceneId: body.data.scene_id,
      costumeNote: body.data.costume_note,
      costumeRefId: body.data.costume_ref_id,
      conditionNote: body.data.condition_note,
      hairNote: body.data.hair_note,
      expressionDefault: body.data.expression_default,
      extraNote: body.data.extra_note,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity_state.updated', 'entity_state', stateId, {
      entity_id: entityId,
      fields: Object.keys(body.data),
    });

    return c.json(assertMobileResponseContract(entityStateSchema, toEntityStateResponse(entityState)));
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = sceneUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toSceneResponse(scene: Scene): Record<string, unknown> {
  return {
    id: scene.id,
    episode_id: scene.episodeId,
    order: scene.order,
    location: scene.location,
    time: scene.time,
    atmosphere: scene.atmosphere,
    involved_entity_ids: scene.involvedEntityIds,
    entity_states: scene.entityStates.map((entityState) => ({
      entity_id: entityState.entityId,
      state_id: entityState.stateId,
    })),
    status: scene.status,
    created_at: scene.createdAt.toISOString(),
    updated_at: scene.updatedAt.toISOString(),
  };
}

function toEntityStateResponse(entityState: EntityState): Record<string, unknown> {
  return {
    id: entityState.id,
    entity_id: entityState.entityId,
    scene_id: entityState.sceneId,
    costume_note: entityState.costumeNote,
    costume_ref_id: entityState.costumeRefId,
    condition_note: entityState.conditionNote,
    hair_note: entityState.hairNote,
    expression_default: entityState.expressionDefault,
    extra_note: entityState.extraNote,
    created_at: entityState.createdAt.toISOString(),
  };
}
