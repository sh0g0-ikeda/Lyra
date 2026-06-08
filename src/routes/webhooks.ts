import { Hono } from 'hono';
import { PayloadTooLargeError, ValidationError } from '../domain/errors/index.js';
import type { StripeWebhookServicePort } from '../services/billing/StripeWebhookService.js';
import type { AppEnv } from '../types/app.js';

const MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024;

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

    const rawBody = await readLimitedRawBody(c.req.raw, c.req.header('Content-Length'));
    await dependencies.stripeWebhookService.handleWebhook(rawBody, signature);

    return c.json({ received: true });
  });

  return app;
}

async function readLimitedRawBody(request: Request, contentLengthHeader: string | undefined): Promise<Buffer> {
  const contentLength = parseContentLength(contentLengthHeader);
  if (contentLength !== null && contentLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
    throw new PayloadTooLargeError('Stripe webhook payload is too large');
  }

  if (request.body === null) {
    return Buffer.alloc(0);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
      throw new PayloadTooLargeError('Stripe webhook payload is too large');
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ValidationError('Content-Length must be a non-negative integer');
  }

  return parsed;
}
