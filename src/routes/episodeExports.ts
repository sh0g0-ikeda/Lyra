import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  episodeExportAcceptedResponseSchema,
  episodeExportStatusResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import {
  createEpisodeExportBodySchema,
  episodeExportIdempotencyKeySchema,
  episodeExportUuidSchema,
} from '../lib/validators/episodeExport.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type {
  EpisodeExportServicePort,
  EpisodeExportStatus,
} from '../services/export/EpisodeExportService.js';
import type {
  OrganizationServicePort,
} from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import {
  readJsonBody,
  REQUEST_BODY_LIMITS,
} from './requestBody.js';

export interface EpisodeExportRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  episodeExportService: EpisodeExportServicePort;
  organizationService?: OrganizationServicePort;
}

export function createEpisodeExportRoutes(
  dependencies: EpisodeExportRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/episodes/:episodeId/exports', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuid(c, 'episodeId');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');

    const idempotencyKey = episodeExportIdempotencyKeySchema.safeParse(
      c.req.header('Idempotency-Key'),
    );
    if (!idempotencyKey.success) {
      throw new ValidationError('Idempotency-Key must be 8 to 128 safe ASCII characters');
    }
    const body = createEpisodeExportBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Episode export request',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.episodeExportService.createExport(
      user.id,
      episodeId,
      {
        format: body.data.format,
        pageIds: body.data.page_ids,
        filename: body.data.filename,
        idempotencyKey: idempotencyKey.data,
      },
      organizationId,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(episodeExportAcceptedResponseSchema, {
        job_id: result.jobId,
        status: result.status,
      }),
      202,
    );
  });

  app.get('/exports/:jobId', async (c) => {
    const user = c.get('user');
    const jobId = parseUuid(c, 'jobId');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const result = await dependencies.episodeExportService.getExport(
      user.id,
      jobId,
      organizationId,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(
        episodeExportStatusResponseSchema,
        toStatusResponse(result),
      ),
    );
  });

  app.get('/exports/:jobId/download', async (c) => {
    const user = c.get('user');
    const jobId = parseUuid(c, 'jobId');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const result = await dependencies.episodeExportService.createDownload(
      user.id,
      jobId,
      organizationId,
    );
    c.header('Cache-Control', 'private, no-store');
    return c.redirect(result.url, 302);
  });

  return app;
}

function parseUuid(c: Context<AppEnv>, name: 'episodeId' | 'jobId'): string {
  const parsed = episodeExportUuidSchema.safeParse(c.req.param(name));
  if (!parsed.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }
  return parsed.data;
}

function toStatusResponse(status: EpisodeExportStatus) {
  return {
    job_id: status.jobId,
    status: status.status,
    progress: {
      stage: status.progressStage,
      percent: status.progressPercent,
    },
    error: status.error,
    created_at: status.createdAt.toISOString(),
    started_at: status.startedAt?.toISOString() ?? null,
    completed_at: status.completedAt?.toISOString() ?? null,
    expires_at: status.expiresAt.toISOString(),
    download_ready: status.downloadReady,
  };
}
