import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import {
  createCreditCheckoutBodySchema,
  createSubscriptionCheckoutBodySchema,
} from '../lib/validators/billing.schema.js';
import type { BillingServicePort } from '../services/billing/BillingService.js';
import type { CreditServicePort } from '../services/credit/CreditService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface BillingRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  billingService: BillingServicePort;
  creditService: CreditServicePort;
}

export function createBillingRoutes(dependencies: BillingRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/balance', async (c) => {
    const user = c.get('user');
    const balance = await dependencies.creditService.getBalance(user.id);

    return c.json({
      monthly_credits: balance.monthlyCredits,
      purchased_credits: balance.purchasedCredits,
      total_credits: balance.totalCredits,
      monthly_expires_at: balance.monthlyExpiresAt?.toISOString() ?? null,
    });
  });

  app.post('/checkout/subscription', async (c) => {
    const user = c.get('user');
    const body = createSubscriptionCheckoutBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Billing checkout',
      }),
    );
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const result = await dependencies.billingService.createSubscriptionCheckoutSession(user, body.data.plan_code);
    return c.json(
      {
        session_id: result.sessionId,
        url: result.url,
      },
      201,
    );
  });

  app.post('/checkout/credits', async (c) => {
    const user = c.get('user');
    const body = createCreditCheckoutBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Billing checkout',
      }),
    );
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const result = await dependencies.billingService.createCreditCheckoutSession(user, body.data.package_code);
    return c.json(
      {
        session_id: result.sessionId,
        package_code: result.packageCode,
        url: result.url,
      },
      201,
    );
  });

  app.post('/customer-portal', async (c) => {
    const user = c.get('user');
    const result = await dependencies.billingService.createCustomerPortalSession(user.id);

    return c.json({
      url: result.url,
    });
  });

  return app;
}
