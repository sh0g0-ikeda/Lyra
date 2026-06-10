import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { StripeWebhookServicePort } from '../services/billing/StripeWebhookService.js';
import type { AppEnv } from '../types/app.js';
import { readLimitedRawBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface WebhookRouteDependencies {
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  stripeWebhookService: StripeWebhookServicePort;
}

export function createWebhookRoutes(dependencies: WebhookRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/stripe', async (c) => {
    const signature = c.req.header('Stripe-Signature');
    if (signature === undefined || signature.length === 0) {
      throw new ValidationError('Stripe-Signature header is required');
    }

    const rawBody = await readLimitedRawBody(c.req.raw, c.req.header('Content-Length'), {
      maxBytes: REQUEST_BODY_LIMITS.STRIPE_WEBHOOK_BYTES,
      description: 'Stripe webhook',
    });
    await dependencies.stripeWebhookService.handleWebhook(rawBody, signature);

    return c.json({ received: true });
  });

  return app;
}
