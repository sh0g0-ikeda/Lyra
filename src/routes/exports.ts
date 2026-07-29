import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  createEpisodeExportResponseSchema,
  exportJobSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { normalizeExportFilename } from '../domain/exportJob.js';
import { ValidationError } from '../domain/errors/index.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { createEpisodeExportBodySchema, exportIdempotencyKeySchema } from '../lib/validators/export.schema.js';
import type { EpisodeExportServicePort } from '../services/export/EpisodeExportService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { parseOptionalOrganizationId, recordOrganizationAudit, requireOrganizationCapability } from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const uuidSchema = z.string().uuid();

export interface ExportRouteDependencies { authMiddleware: MiddlewareHandler<AppEnv>; rateLimitMiddleware: MiddlewareHandler<AppEnv>; exportService: EpisodeExportServicePort; organizationService?: OrganizationServicePort; }

export function createExportRoutes(dependencies: ExportRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/episodes/:episodeId/exports', async (c) => {
    const episodeId = parseUuidParam(c.req.param('episodeId'));
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const idempotencyKey = exportIdempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'));
    if (!idempotencyKey.success) throw new ValidationError('Idempotency-Key must be 8 to 128 safe characters');
    const body = createEpisodeExportBodySchema.safeParse(await readJsonBody(c, { maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES, description: 'Export request' }));
    if (!body.success) throw new ValidationError(formatZodValidationError(body.error));
    const user = c.get('user');
    const filename = normalizeExportFilename(body.data.filename, body.data.format);
    const result = await dependencies.exportService.createExport({ userId: user.id, organizationId, episodeId, pageIds: body.data.page_ids, format: body.data.format, filename, idempotencyKey: idempotencyKey.data });
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'episode.export_queued', 'episode', episodeId, { export_job_id: result.jobId, format: body.data.format, page_count: body.data.page_ids.length });
    const payload = { job_id: result.jobId, status: result.status };
    return c.json(assertMobileResponseContract(createEpisodeExportResponseSchema, payload), 202);
  });

  app.get('/exports/:jobId', async (c) => {
    const jobId = parseUuidParam(c.req.param('jobId'));
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const payload = await dependencies.exportService.getExportStatus({
      userId: c.get('user').id,
      organizationId,
      jobId,
    });
    return c.json(assertMobileResponseContract(exportJobSchema, payload));
  });

  app.get('/exports/:jobId/download', async (c) => {
    const jobId = parseUuidParam(c.req.param('jobId'));
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'export');
    const status = await dependencies.exportService.getExportStatus({ userId: c.get('user').id, organizationId, jobId });
    if (status.download_url === undefined) throw new ValidationError('Export download is not ready');
    return c.redirect(status.download_url, 302);
  });
  return app;
}

function parseUuidParam(value: string): string { const parsed = uuidSchema.safeParse(value); if (!parsed.success) throw new ValidationError('Route parameter must be a valid UUID'); return parsed.data; }
