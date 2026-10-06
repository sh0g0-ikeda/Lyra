import { requireWebImageDeliveryAccess } from './webImageDelivery.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  episodeExportAcceptedResponseSchema,
  episodeExportLegacyStatusResponseSchema,
  episodeExportStatusResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ConflictError, ValidationError } from '../domain/errors/index.js';
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
    const version = parseExportContractVersion(c);
    const result = await dependencies.episodeExportService.getExport(
      user.id,
      jobId,
      organizationId,
    );
    c.header('Cache-Control', 'no-store');
    if (version === 'v1') {
      const downloadUrl = await legacyDownloadUrl(result, () => dependencies.episodeExportService.createDownload(user.id, jobId, organizationId));
      return c.json(assertMobileResponseContract(episodeExportLegacyStatusResponseSchema, toLegacyStatusResponse(result, downloadUrl)));
    }
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


  app.post('/web/episodes/:episodeId/exports', async (c) => {
    requireWebImageDeliveryAccess(c);
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
        audience: 'authorized_web',
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

  app.get('/web/exports/:jobId', async (c) => {
    requireWebImageDeliveryAccess(c);
    const user = c.get('user');
    const jobId = parseUuid(c, 'jobId');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const version = parseExportContractVersion(c);
    const result = await dependencies.episodeExportService.getExport(
      user.id,
      jobId,
      organizationId,
      'authorized_web',
    );
    c.header('Cache-Control', 'no-store');
    if (version === 'v1') {
      const downloadUrl = await legacyDownloadUrl(result, () => dependencies.episodeExportService.createDownload(user.id, jobId, organizationId, 'authorized_web'));
      return c.json(assertMobileResponseContract(episodeExportLegacyStatusResponseSchema, toLegacyStatusResponse(result, downloadUrl)));
    }
    return c.json(
      assertMobileResponseContract(
        episodeExportStatusResponseSchema,
        toStatusResponse(result),
      ),
    );
  });

  app.get('/web/exports/:jobId/download', async (c) => {
    requireWebImageDeliveryAccess(c);
    const user = c.get('user');
    const jobId = parseUuid(c, 'jobId');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const result = await dependencies.episodeExportService.createDownload(
      user.id,
      jobId,
      organizationId,
      'authorized_web',
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

function parseExportContractVersion(c: Context<AppEnv>): 'v1' | 'v2' {
  const value = c.req.query('export_contract');
  if (value === undefined || value === 'v1') return 'v1';
  if (value === 'v2') return 'v2';
  throw new ValidationError('export_contract must be v1 or v2');
}

async function legacyDownloadUrl(status: EpisodeExportStatus, download: () => Promise<{ url: string }>): Promise<string | undefined> {
  if (status.status !== 'completed' || !status.downloadReady) return undefined;
  try {
    // Reuse the scoped, audience-checked download path; metadata alone never grants access.
    return (await download()).url;
  } catch (error) {
    // Expiry, deletion or a signer outage can race a status read. Metadata remains usable.
    if (error instanceof ConflictError) return undefined;
    throw error;
  }
}

function toLegacyStatusResponse(status: EpisodeExportStatus, downloadUrl: string | undefined): Record<string, unknown> {
  return {
    id: status.jobId, episode_id: status.episodeId, format: status.format, filename: status.filename,
    status: status.status, progress_stage: status.progressStage, progress_percent: status.progressPercent,
    error_code: status.error?.code ?? null, message_key: null,
    expires_at: status.expiresAt.toISOString(), completed_at: status.completedAt?.toISOString() ?? null,
    cancel_supported: false, cancel_reason_code: 'EXPORT_CANCEL_UNSUPPORTED',
    ...(downloadUrl === undefined ? {} : { download_url: downloadUrl }),
  };
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
