import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { Entity } from '../domain/types/entity.js';
import type { EntityReferenceSet } from '../domain/types/entityReference.js';
import {
  confirmEntityReferenceBodySchema,
  createEntityBodySchema,
  generateEntityReferenceBodySchema,
  importEntityImageBodySchema,
  referenceIdParamSchema,
  updateEntityBodySchema,
  uuidParamSchema,
} from '../lib/validators/entity.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { signImageCdnUrl } from '../infrastructure/aws/CloudFrontImageUrlSigner.js';
import type { EntityServicePort } from '../services/entity/EntityService.js';
import type { EntityReferenceServicePort } from '../services/entity/EntityReferenceService.js';
import type { EntityReferenceImageExportServicePort } from '../services/entity/EntityReferenceImageExportService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, readOptionalJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const referenceCandidateImageQuerySchema = z
  .object({
    s3_key: z.string().trim().min(1).max(512),
  })
  .strict();

export interface EntityRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  entityService: EntityServicePort;
  entityReferenceService: EntityReferenceServicePort;
  entityReferenceImageExportService: EntityReferenceImageExportServicePort;
  organizationService?: OrganizationServicePort;
}

export function createEntityRoutes(dependencies: EntityRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/works/:work_id/entities', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'work_id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createEntityBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const entity = await dependencies.entityService.createEntity(user.id, workId, {
      entityType: body.data.entity_type,
      name: body.data.name,
      freeDescription: body.data.free_description ?? null,
      promptSupplement: body.data.prompt_supplement ?? null,
      structuredFields: body.data.structured_fields ?? {},
      speechProfile: body.data.speech_profile ?? {},
    }, organizationId);

    return c.json(toEntityResponse(entity), 201);
  });

  app.get('/works/:work_id/entities', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'work_id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const entities = await dependencies.entityService.listEntities(user.id, workId, organizationId);

    return c.json({
      entities: entities.map(toEntityResponse),
    });
  });

  app.get('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const entity = await dependencies.entityService.getEntity(user.id, entityId, organizationId);

    return c.json(toEntityResponse(entity));
  });

  app.get('/entities/:id/reference-set', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const referenceSet = await dependencies.entityReferenceService.getReferenceSet(user.id, entityId, organizationId);

    return c.json(await toReferenceSetResponse(referenceSet));
  });

  app.get('/entities/:id/reference/:ref_id/image', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const refIdResult = referenceIdParamSchema.safeParse(c.req.param('ref_id'));

    if (!refIdResult.success) {
      throw new ValidationError(formatZodValidationError(refIdResult.error));
    }

    const exportedImage = await dependencies.entityReferenceImageExportService.exportReferenceImage(
      user.id,
      entityId,
      refIdResult.data,
      organizationId,
    );

    return c.body(new Uint8Array(exportedImage.imageData), 200, {
      'Content-Type': exportedImage.mimeType,
      'Cache-Control': 'private, no-store',
    });
  });

  app.get('/entities/:id/reference-candidate-image', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const query = referenceCandidateImageQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      throw new ValidationError(formatZodValidationError(query.error));
    }

    const exportedImage = await dependencies.entityReferenceImageExportService.exportCandidateImage(
      user.id,
      entityId,
      query.data.s3_key,
      organizationId,
    );

    return c.body(new Uint8Array(exportedImage.imageData), 200, {
      'Content-Type': exportedImage.mimeType,
      'Cache-Control': 'private, no-store',
    });
  });

  app.put('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateEntityBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const entity = await dependencies.entityService.updateEntity(user.id, entityId, {
      entityType: body.data.entity_type,
      name: body.data.name,
      freeDescription: body.data.free_description,
      promptSupplement: body.data.prompt_supplement,
      structuredFields: body.data.structured_fields,
      speechProfile: body.data.speech_profile,
    }, organizationId);

    return c.json(toEntityResponse(entity));
  });

  app.delete('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.entityService.deleteEntity(user.id, entityId, organizationId);

    return c.body(null, 204);
  });

  app.post('/entities/import-image', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const body = importEntityImageBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.ENTITY_IMPORT_JSON_BYTES,
        description: 'Entity image import',
      }),
    );

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.entityReferenceService.importImage(user.id, {
      entityType: body.data.entity_type,
      imageBase64: body.data.image_base64,
    }, organizationId);

    return c.json({
      suggested_fields: result.suggestedFields,
      prompt_supplement: result.promptSupplement,
      tmp_image_s3_key: result.tmpImageS3Key,
    });
  });

  app.post('/entities/:id/generate-reference', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const body = generateEntityReferenceBodySchema.safeParse(
      await readOptionalJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Entity reference generation',
      }),
    );

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.entityReferenceService.enqueueReferenceGeneration(user.id, entityId, {
      sourceS3Key: body.data.source_s3_key,
    }, organizationId);

    return c.json({ job_id: result.jobId }, 202);
  });

  app.post('/entities/:id/reference/confirm', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = confirmEntityReferenceBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const referenceSet = await dependencies.entityReferenceService.confirmReferences(user.id, entityId, {
      selectedS3Keys: body.data.selected_s3_keys,
      primaryS3Key: body.data.primary_s3_key,
      promptSupplement: body.data.prompt_supplement,
    }, organizationId);

    return c.json(await toReferenceSetResponse(referenceSet));
  });

  app.delete('/entities/:id/reference/:ref_id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const refIdResult = referenceIdParamSchema.safeParse(c.req.param('ref_id'));

    if (!refIdResult.success) {
      throw new ValidationError(formatZodValidationError(refIdResult.error));
    }

    const referenceSet = await dependencies.entityReferenceService.deleteReference(
      user.id,
      entityId,
      refIdResult.data,
      organizationId,
    );

    return c.json(await toReferenceSetResponse(referenceSet));
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

function parseOptionalOrganizationId(c: Context<AppEnv>): string | null {
  const raw = c.req.query('organization_id');
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const result = uuidParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('organization_id must be a valid UUID');
  }
  return result.data;
}

async function requireOrganizationCapability(
  c: Context<AppEnv>,
  dependencies: EntityRouteDependencies,
  organizationId: string | null,
  capability: Parameters<NonNullable<EntityRouteDependencies['organizationService']>['requireMembership']>[2],
): Promise<void> {
  if (organizationId === null) {
    return;
  }
  if (dependencies.organizationService === undefined) {
    throw new ValidationError('Organization support is not configured');
  }
  const user = c.get('user');
  await dependencies.organizationService.requireMembership(organizationId, user.id, capability);
}

function toEntityResponse(entity: Entity): Record<string, unknown> {
  return {
    id: entity.id,
    work_id: entity.workId,
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

async function toReferenceSetResponse(referenceSet: EntityReferenceSet): Promise<Record<string, unknown>> {
  return {
    entity_id: referenceSet.entityId,
    primary_ref_id: referenceSet.primaryRefId,
    status: referenceSet.status,
    updated_at: referenceSet.updatedAt.toISOString(),
    reference_images: await Promise.all(referenceSet.images.map(toReferenceImageResponse)),
  };
}

async function toReferenceImageResponse(image: EntityReferenceSet['images'][number]): Promise<Record<string, unknown>> {
  const signedCdnUrl = await signImageCdnUrl(image.cdnUrl, image.s3Key);

  return {
    ref_id: image.refId,
    ...(signedCdnUrl === null ? {} : { cdn_url: signedCdnUrl }),
    source: image.source,
    created_at: image.createdAt,
  };
}
