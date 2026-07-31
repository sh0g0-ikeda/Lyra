import { Hono, type MiddlewareHandler } from 'hono';
import {
  entityReferenceUploadPresignResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import {
  entityReferenceUploadPresignBodySchema,
} from '../lib/validators/entity.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type {
  EntityReferenceUploadServicePort,
} from '../services/entity/EntityReferenceUploadService.js';
import type {
  OrganizationServicePort,
} from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface EntityReferenceUploadRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  entityReferenceUploadService: EntityReferenceUploadServicePort;
  organizationService?: OrganizationServicePort;
}

export function createEntityReferenceUploadRoutes(
  dependencies: EntityReferenceUploadRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/uploads/entity-reference/presign', async (c) => {
    const user = c.get('user');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'generate');
    const body = entityReferenceUploadPresignBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Entity reference upload presign',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.entityReferenceUploadService.createPresignedUpload(
      user.id,
      {
        mimeType: body.data.mime_type,
        sizeBytes: body.data.size_bytes,
        entityId: body.data.entity_id ?? null,
      },
      organizationId,
    );

    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(entityReferenceUploadPresignResponseSchema, {
        upload_url: result.uploadUrl,
        upload_token: result.uploadToken,
        expires_at: result.expiresAt.toISOString(),
        upload_headers: result.uploadHeaders,
      }),
      201,
    );
  });

  return app;
}
