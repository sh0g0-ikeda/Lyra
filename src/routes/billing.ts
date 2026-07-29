import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import {
  createCreditCheckoutBodySchema,
  createSubscriptionCheckoutBodySchema,
} from '../lib/validators/billing.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { BillingServicePort } from '../services/billing/BillingService.js';
import type { CreditServicePort } from '../services/credit/CreditService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';
import {
  billingBalanceSchema,
  organizationCreditCheckoutSchema,
  organizationCustomerPortalSchema,
  organizationSubscriptionCheckoutSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

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
    const [balance, subscription] = await Promise.all([
      dependencies.creditService.getBalance(user.id),
      dependencies.billingService.getPersonalSubscriptionSummary(user.id),
    ]);

    const payload = {
      monthly_credits: balance.monthlyCredits,
      purchased_credits: balance.purchasedCredits,
      total_credits: balance.totalCredits,
      monthly_expires_at: balance.monthlyExpiresAt?.toISOString() ?? null,
      plan_code: user.planCode,
      current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: subscription?.cancelAtPeriodEnd ?? false,
      subscription_plans: dependencies.billingService.getSubscriptionPlanCatalog().map((plan) => ({
        plan_code: plan.planCode,
        display_name_ja: plan.displayNameJa,
        display_name_en: plan.displayNameEn,
        monthly_credits: plan.monthlyCredits,
        amount_jpy: plan.amountJpy,
        minimum_contract_months: plan.minimumContractMonths,
        trial_days: plan.trialDays,
        is_enterprise: plan.isEnterprise,
        configured: plan.configured,
      })),
    };
    return c.json(assertMobileResponseContract(billingBalanceSchema, payload));
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
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.billingService.createSubscriptionCheckoutSession(user, body.data.plan_code);
    const payload = {
      session_id: result.sessionId,
      url: result.url,
    };
    return c.json(
      assertMobileResponseContract(organizationSubscriptionCheckoutSchema, payload),
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
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.billingService.createCreditCheckoutSession(user, body.data.package_code);
    const payload = {
      session_id: result.sessionId,
      package_code: result.packageCode,
      url: result.url,
    };
    return c.json(
      assertMobileResponseContract(organizationCreditCheckoutSchema, payload),
      201,
    );
  });

  app.post('/customer-portal', async (c) => {
    const user = c.get('user');
    const result = await dependencies.billingService.createCustomerPortalSession(user.id);
    const payload = {
      url: result.url,
    };
    return c.json(assertMobileResponseContract(organizationCustomerPortalSchema, payload));
  });

  return app;
}
