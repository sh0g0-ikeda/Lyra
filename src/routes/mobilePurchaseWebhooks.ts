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
    deliveryAttempt: z.number().int().min(1).max(10_000).optional(),
    message: z
      .object({
        attributes: z.record(z.string().max(256), z.string().max(2_048)).optional(),
        messageId: z.string().trim().min(1).max(512).optional(),
        message_id: z.string().trim().min(1).max(512).optional(),
        data: z.string().trim().min(1).max(65_536),
        orderingKey: z.string().max(1_024).optional(),
        publishTime: z.string().datetime({ offset: true }).optional(),
        publish_time: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
    subscription: z.string().max(2_048).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.message.messageId === undefined && value.message.message_id === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Pub/Sub message ID is required',
        path: ['message'],
      });
    }
    if (
      value.message.messageId !== undefined
      && value.message.message_id !== undefined
      && value.message.message_id !== value.message.messageId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pub/Sub message ID aliases must match',
        path: ['message', 'message_id'],
      });
    }
    if (
      value.message.publishTime !== undefined
      && value.message.publish_time !== undefined
      && value.message.publish_time !== value.message.publishTime
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pub/Sub publish time aliases must match',
        path: ['message', 'publish_time'],
      });
    }
  });

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
    const messageId = body.message.messageId ?? body.message.message_id;
    if (messageId === undefined) {
      throw new ValidationError('Store notification could not be verified');
    }
    const publishTime = body.message.publishTime ?? body.message.publish_time;
    await dependencies.mobileStorePurchaseService.handleGoogleRtdn({
      messageId,
      data: body.message.data,
      publishTime: publishTime === undefined ? null : new Date(publishTime),
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
