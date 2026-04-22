import { Hono, type MiddlewareHandler } from 'hono';
import type { CreditServicePort } from '../services/credit/CreditService.js';
import type { AppEnv } from '../types/app.js';

export interface BillingRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  creditService: CreditServicePort;
}

export function createBillingRoutes(dependencies: BillingRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);

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

  return app;
}
