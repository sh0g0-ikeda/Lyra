import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import {
  organizationSafetyReportBodySchema,
  type OrganizationSafetyReportServicePort,
} from '../services/moderation/OrganizationSafetyReportService.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const organizationSafetyReportResponseSchema = z.object({
  report_id: z.uuid(),
  status: z.literal('received'),
}).strict();

export interface OrganizationSafetyReportRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  organizationService: Pick<OrganizationServicePort, 'requireMembership'>;
  organizationSafetyReportService: OrganizationSafetyReportServicePort;
}

export function createOrganizationSafetyReportRoutes(
  dependencies: OrganizationSafetyReportRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/organization-safety-reports', async (c) => {
    const parsedBody = organizationSafetyReportBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Organization safety report',
      }),
    );
    if (!parsedBody.success) {
      throw new ValidationError(formatZodValidationError(parsedBody.error));
    }

    const user = c.get('user');
    await dependencies.organizationService.requireMembership(
      parsedBody.data.organization_id,
      user.id,
      'view_work',
    );
    const receipt = await dependencies.organizationSafetyReportService.submit({
      organizationId: parsedBody.data.organization_id,
      reporterUserId: user.id,
      targetKind: parsedBody.data.target_kind,
      reason: parsedBody.data.reason,
      requestId: c.get('requestId'),
    });

    return c.json(
      assertMobileResponseContract(organizationSafetyReportResponseSchema, {
        report_id: receipt.reportId,
        status: receipt.status,
      }),
      202,
    );
  });

  return app;
}
