import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  entitiesResponseSchema,
  entitySchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
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
import { env } from '../lib/env.js';
import type { EntityServicePort } from '../services/entity/EntityService.js';
import type { EntityReferenceServicePort } from '../services/entity/EntityReferenceService.js';
import type { EntityReferenceImageExportServicePort } from '../services/entity/EntityReferenceImageExportService.js';
import {
  createReferenceCandidateToken,
  parseReferenceCandidateToken,
} from '../services/entity/ReferenceCandidateToken.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, readOptionalJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const referenceCandidateImageQuerySchema = z
  .object({
    candidate_token: z.string().trim().min(1).max(4096).optional(),
    s3_key: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine((query) => query.candidate_token !== undefined || query.s3_key !== undefined, {
    message: 'candidate_token is required',
  });

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
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.created', 'entity', entity.id, {
      work_id: workId,
      entity_type: body.data.entity_type,
    });

    const payload = toEntityResponse(entity);
    return c.json(assertMobileResponseContract(entitySchema, payload), 201);
  });

  app.get('/works/:work_id/entities', async (c) => {
    const user = c.get('user');
    const workId = parseUuidParam(c, 'work_id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const entities = await dependencies.entityService.listEntities(user.id, workId, organizationId);

    const payload = {
      entities: entities.map(toEntityResponse),
    };
    return c.json(assertMobileResponseContract(entitiesResponseSchema, payload));
  });

  app.get('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const entity = await dependencies.entityService.getEntity(user.id, entityId, organizationId);

    const payload = toEntityResponse(entity);
    return c.json(assertMobileResponseContract(entitySchema, payload));
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

    const candidateS3Key = query.data.candidate_token === undefined
      ? query.data.s3_key
      : parseReferenceCandidateToken(query.data.candidate_token, {
        userId: user.id,
        entityId,
      }, {
        secret: getReferenceCandidateTokenSecret(),
      });
    if (candidateS3Key === undefined) {
      throw new ValidationError('candidate_token is required');
    }

    const exportedImage = await dependencies.entityReferenceImageExportService.exportCandidateImage(
      user.id,
      entityId,
      candidateS3Key,
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
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.updated', 'entity', entityId, {
      fields: Object.keys(body.data),
    });

    const payload = toEntityResponse(entity);
    return c.json(assertMobileResponseContract(entitySchema, payload));
  });

  app.delete('/entities/:id', async (c) => {
    const user = c.get('user');
    const entityId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.entityService.deleteEntity(user.id, entityId, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.deleted', 'entity', entityId);

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
      tmp_image_token: createReferenceCandidateToken({
        userId: user.id,
        entityId: body.data.entity_id ?? '',
        s3Key: result.tmpImageS3Key,
      }, {
        secret: getReferenceCandidateTokenSecret(),
      }),
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
      sourceS3Key: body.data.source_candidate_token === undefined
        ? body.data.source_s3_key
        : parseReferenceCandidateToken(body.data.source_candidate_token, {
          userId: user.id,
          entityId,
        }, {
          secret: getReferenceCandidateTokenSecret(),
        }),
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.reference_generation_queued', 'entity', entityId, {
      job_id: result.jobId,
      source_image_attached: body.data.source_candidate_token !== undefined || body.data.source_s3_key !== undefined,
    });

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

    const selectedS3Keys = body.data.selected_candidate_tokens === undefined
      ? (body.data.selected_s3_keys ?? [])
      : body.data.selected_candidate_tokens.map((token) =>
        parseReferenceCandidateToken(token, {
          userId: user.id,
          entityId,
        }, {
          secret: getReferenceCandidateTokenSecret(),
        }),
      );
    const primaryS3Key = body.data.primary_candidate_token === undefined
      ? body.data.primary_s3_key
      : parseReferenceCandidateToken(body.data.primary_candidate_token, {
        userId: user.id,
        entityId,
      }, {
        secret: getReferenceCandidateTokenSecret(),
      });

    const referenceSet = await dependencies.entityReferenceService.confirmReferences(user.id, entityId, {
      selectedS3Keys,
      primaryS3Key,
      promptSupplement: body.data.prompt_supplement,
    }, organizationId);
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.reference_confirmed', 'entity', entityId, {
      selected_count: selectedS3Keys.length,
      primary_selected: primaryS3Key !== undefined,
    });

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
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'entity.reference_deleted', 'entity', entityId, {
      ref_id: refIdResult.data,
    });

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

function getReferenceCandidateTokenSecret(): string {
  return env.REFERENCE_CANDIDATE_TOKEN_SECRET
    ?? env.SUPABASE_JWT_SECRET
    ?? env.STRIPE_WEBHOOK_SECRET
    ?? 'development-reference-candidate-token-secret';
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
