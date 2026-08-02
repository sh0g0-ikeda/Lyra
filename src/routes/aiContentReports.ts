import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import {
  aiContentReportBodySchema,
  type AiContentReportServicePort,
} from '../services/moderation/AiContentReportService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const aiContentReportResponseSchema = z.object({
  report_id: z.uuid(),
  status: z.literal('received'),
}).strict();

export interface AiContentReportRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  aiContentReportService: AiContentReportServicePort;
}

export function createAiContentReportRoutes(
  dependencies: AiContentReportRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/ai-content-reports', async (c) => {
    const parsedBody = aiContentReportBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'AI content report',
      }),
    );
    if (!parsedBody.success) {
      throw new ValidationError(formatZodValidationError(parsedBody.error));
    }

    const receipt = await dependencies.aiContentReportService.submit({
      userId: c.get('user').id,
      contentKind: parsedBody.data.content_kind,
      contentId: parsedBody.data.content_id ?? null,
      reason: parsedBody.data.reason,
      requestId: c.get('requestId'),
    });

    return c.json(
      assertMobileResponseContract(aiContentReportResponseSchema, {
        report_id: receipt.reportId,
        status: receipt.status,
      }),
      202,
    );
  });

  return app;
}
