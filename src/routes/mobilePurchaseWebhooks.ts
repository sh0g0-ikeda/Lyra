import { Hono, type MiddlewareHandler } from 'hono';
import { z, type ZodError } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { GooglePubSubPushVerifier } from '../infrastructure/google/GooglePubSubPushVerifier.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { MobileStorePurchaseServicePort } from '../services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const appleNotificationSchema = z
  .object({
    signedPayload: z.string().trim().min(1).max(32_768),
  })
  .strict();

const googlePushSchema = z
  .object({
    message: z
      .object({
        messageId: z.string().trim().min(1).max(512),
        data: z.string().trim().min(1).max(65_536),
        publishTime: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
    subscription: z.string().max(2_048).optional(),
  })
  .strict();

export interface MobilePurchaseWebhookDependencies {
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  mobileStorePurchaseService: MobileStorePurchaseServicePort;
  googlePubSubPushVerifier: Pick<GooglePubSubPushVerifier, 'verifyAuthorization'>;
}

export function createMobilePurchaseWebhookRoutes(
  dependencies: MobilePurchaseWebhookDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/apple', async (c) => {
    const body = parseBody(appleNotificationSchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
        description: 'Apple store notification',
      }),
    ));
    await dependencies.mobileStorePurchaseService.handleAppleNotification(body.signedPayload);
    return c.json({ received: true });
  });

  app.post('/google', async (c) => {
    await dependencies.googlePubSubPushVerifier.verifyAuthorization(c.req.header('Authorization'));
    const body = parseBody(googlePushSchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
        description: 'Google Play notification',
      }),
    ));
    await dependencies.mobileStorePurchaseService.handleGoogleRtdn({
      messageId: body.message.messageId,
      data: body.message.data,
      publishTime: body.message.publishTime === undefined ? null : new Date(body.message.publishTime),
    });
    return c.json({ received: true });
  });

  return app;
}

function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (result.success) {
    return result.data;
  }
  throw new ValidationError(formatZodValidationError(result.error));
}
