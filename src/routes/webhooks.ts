import { Hono } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { StripeWebhookServicePort } from '../services/billing/StripeWebhookService.js';
import type { AppEnv } from '../types/app.js';

export interface WebhookRouteDependencies {
  stripeWebhookService: StripeWebhookServicePort;
}

export function createWebhookRoutes(dependencies: WebhookRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/stripe', async (c) => {
    const signature = c.req.header('Stripe-Signature');
    if (signature === undefined || signature.length === 0) {
      throw new ValidationError('Stripe-Signature header is required');
    }

    const rawBody = Buffer.from(await c.req.arrayBuffer());
    await dependencies.stripeWebhookService.handleWebhook(rawBody, signature);

    return c.json({ received: true });
  });

  return app;
}
