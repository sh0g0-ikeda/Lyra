import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditPackageCode, PaidPlanCode } from '../../../src/domain/constants/billing.js';
import type {
  CreditCheckoutResult,
  CustomerPortalResult,
  PersonalSubscriptionSummary,
  SubscriptionCheckoutResult,
  SubscriptionPlanCatalogEntry,
} from '../../../src/domain/types/billing.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { RateLimitResult, RateLimitStore } from '../../../src/middleware/rateLimit.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { BillingServicePort } from '../../../src/services/billing/BillingService.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';
import type { StripeWebhookServicePort } from '../../../src/services/billing/StripeWebhookService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';

const jwtSecret = 'unit-test-secret';
const testUser: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeUserProvisioningService implements UserProvisioningPort {
  public constructor(private readonly authenticatedUser: AuthenticatedUser = testUser) {}

  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        ...this.authenticatedUser,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return {
      monthlyCredits: 25,
      purchasedCredits: 15,
      totalCredits: 40,
      monthlyExpiresAt: null,
    };
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }
}

class FakeBillingService implements BillingServicePort {
  public subscriptionPlanCode: PaidPlanCode | null = null;
  public creditPackageCode: CreditPackageCode | null = null;
  public portalUserId: string | null = null;
  public personalSubscriptionSummary: PersonalSubscriptionSummary | null = null;
  public personalSubscriptionSummaryUserId: string | null = null;
  public standardPlanMonthlyCredits = 50;
  public subscriptionCheckoutResult: SubscriptionCheckoutResult = {
    sessionId: 'cs_sub_123',
    url: 'https://checkout.stripe.test/subscription',
  };
  public creditCheckoutResult: CreditCheckoutResult = {
    sessionId: 'cs_pay_123',
    packageCode: 'credits_1000',
    url: 'https://checkout.stripe.test/credits',
  };
  public customerPortalResult: CustomerPortalResult = {
    url: 'https://billing.stripe.test/portal',
  };

  public async createSubscriptionCheckoutSession(
    _user: AuthenticatedUser,
    planCode: PaidPlanCode,
  ): Promise<SubscriptionCheckoutResult> {
    this.subscriptionPlanCode = planCode;
    return this.subscriptionCheckoutResult;
  }

  public async createCreditCheckoutSession(
    _user: AuthenticatedUser,
    packageCode: CreditPackageCode,
  ): Promise<CreditCheckoutResult> {
    this.creditPackageCode = packageCode;
    return {
      ...this.creditCheckoutResult,
      packageCode,
    };
  }

  public async createCustomerPortalSession(userId: string): Promise<CustomerPortalResult> {
    this.portalUserId = userId;
    return this.customerPortalResult;
  }

  public async getPersonalSubscriptionSummary(userId: string): Promise<PersonalSubscriptionSummary | null> {
    this.personalSubscriptionSummaryUserId = userId;
    return this.personalSubscriptionSummary;
  }

  public getSubscriptionPlanCatalog(): SubscriptionPlanCatalogEntry[] {
    return [
      {
        planCode: 'standard',
        displayNameJa: 'スタンダード',
        displayNameEn: 'Standard',
        monthlyCredits: this.standardPlanMonthlyCredits,
        amountJpy: 1000,
        minimumContractMonths: 1,
        trialDays: 0,
        isEnterprise: false,
        configured: true,
      },
      {
        planCode: 'premium',
        displayNameJa: 'プレミアム',
        displayNameEn: 'Premium',
        monthlyCredits: 175,
        amountJpy: 3000,
        minimumContractMonths: 1,
        trialDays: 0,
        isEnterprise: false,
        configured: true,
      },
    ];
  }
}

class FakeStripeWebhookService implements StripeWebhookServicePort {
  public signature: string | null = null;
  public payload: string | null = null;

  public async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.signature = signature;
    this.payload = rawBody.toString('utf8');
  }
}

class BlockingRateLimitStore implements RateLimitStore {
  private calls = 0;

  public async consume(): Promise<RateLimitResult> {
    this.calls += 1;

    if (this.calls === 1) {
      return {
        allowed: true,
        remaining: 0,
        retryAfterSeconds: 60,
        resetAt: new Date('2026-05-01T00:00:00.000Z'),
      };
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: new Date('2026-05-01T00:00:00.000Z'),
    };
  }
}

describe('billing routes', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const app = createTestApp(new FakeBillingService(), new FakeStripeWebhookService());

    const response = await app.request('/api/billing/balance');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    });
  });

  it('returns the credit balance when the JWT is valid', async () => {
    const billingService = new FakeBillingService();
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();

    const response = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      monthly_credits: 25,
      purchased_credits: 15,
      total_credits: 40,
      monthly_expires_at: null,
      plan_code: 'free',
      current_period_end: null,
      cancel_at_period_end: false,
      subscription_plans: [
        {
          plan_code: 'standard',
          display_name_ja: 'スタンダード',
          display_name_en: 'Standard',
          monthly_credits: 50,
          amount_jpy: 1000,
          minimum_contract_months: 1,
          trial_days: 0,
          is_enterprise: false,
          configured: true,
        },
        {
          plan_code: 'premium',
          display_name_ja: 'プレミアム',
          display_name_en: 'Premium',
          monthly_credits: 175,
          amount_jpy: 3000,
          minimum_contract_months: 1,
          trial_days: 0,
          is_enterprise: false,
          configured: true,
        },
      ],
    });
    expect(billingService.personalSubscriptionSummaryUserId).toBeNull();
  });

  it('保存済み購読の更新日と解約予定をcredit期限とは別に返す', async () => {
    const billingService = new FakeBillingService();
    billingService.personalSubscriptionSummary = {
      planCode: 'standard',
      status: 'active',
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
    };
    const paidUser: AuthenticatedUser = {
      ...testUser,
      planCode: 'standard',
    };
    const app = createTestApp(
      billingService,
      new FakeStripeWebhookService(),
      undefined,
      paidUser,
    );
    const token = await createToken();

    const response = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        monthly_expires_at: null,
        plan_code: 'standard',
        current_period_end: '2026-08-01T00:00:00.000Z',
        cancel_at_period_end: true,
      }),
    );
    expect(billingService.personalSubscriptionSummaryUserId).toBe(testUser.id);
  });

  it('Stripe summaryがない場合に検証済みstore購読を同じwire fieldへ返す', async () => {
    const billingService = new FakeBillingService();
    const mobileStoreService = new FakeMobileStoreSubscriptionService({
      planCode: 'premium',
      status: 'active',
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
    });
    const paidUser: AuthenticatedUser = { ...testUser, planCode: 'premium' };
    const app = createTestApp(
      billingService,
      new FakeStripeWebhookService(),
      undefined,
      paidUser,
      mobileStoreService,
    );
    const token = await createToken();

    const response = await app.request('/api/billing/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan_code: 'premium',
      current_period_end: '2026-09-01T00:00:00.000Z',
      cancel_at_period_end: false,
    });
    expect(mobileStoreService.summaryUserIds).toEqual([testUser.id]);
  });

  it('billing response contractに違反するplanを成功payloadとして返さない', async () => {
    const billingService = new FakeBillingService();
    billingService.standardPlanMonthlyCredits = -1;
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();

    const response = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'Mobile response contract validation failed',
      },
    });
  });

  it('creates subscription checkout sessions for consumer plans and rejects enterprise plans', async () => {
    const billingService = new FakeBillingService();
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();

    const response = await app.request('/api/billing/checkout/subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_code: 'standard',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      session_id: 'cs_sub_123',
      url: 'https://checkout.stripe.test/subscription',
    });
    expect(billingService.subscriptionPlanCode).toBe('standard');

    const premiumResponse = await app.request('/api/billing/checkout/subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_code: 'premium',
      }),
    });

    expect(premiumResponse.status).toBe(201);
    await expect(premiumResponse.json()).resolves.toEqual({
      session_id: 'cs_sub_123',
      url: 'https://checkout.stripe.test/subscription',
    });
    expect(billingService.subscriptionPlanCode).toBe('premium');

    const enterpriseResponse = await app.request('/api/billing/checkout/subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_code: 'enterprise_a',
      }),
    });

    expect(enterpriseResponse.status).toBe(422);
    expect(billingService.subscriptionPlanCode).toBe('premium');
  });

  it('creates a credit checkout session', async () => {
    const billingService = new FakeBillingService();
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();

    const response = await app.request('/api/billing/checkout/credits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        package_code: 'credits_1000',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      session_id: 'cs_pay_123',
      package_code: 'credits_1000',
      url: 'https://checkout.stripe.test/credits',
    });
    expect(billingService.creditPackageCode).toBe('credits_1000');
  });

  it('returns a customer portal URL', async () => {
    const billingService = new FakeBillingService();
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();

    const response = await app.request('/api/billing/customer-portal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://billing.stripe.test/portal',
    });
    expect(billingService.portalUserId).toBe(testUser.id);
  });

  it('個人課金の3成功JSONは契約外Service値を500にする', async () => {
    const billingService = new FakeBillingService();
    billingService.subscriptionCheckoutResult = {
      sessionId: '',
      url: 'https://checkout.stripe.test/subscription',
    };
    billingService.creditCheckoutResult = {
      sessionId: '',
      packageCode: 'credits_1000',
      url: 'https://checkout.stripe.test/credits',
    };
    billingService.customerPortalResult = { url: '' };
    const app = createTestApp(billingService, new FakeStripeWebhookService());
    const token = await createToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const responses = await Promise.all([
      app.request('/api/billing/checkout/subscription', {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan_code: 'standard' }),
      }),
      app.request('/api/billing/checkout/credits', {
        method: 'POST',
        headers,
        body: JSON.stringify({ package_code: 'credits_1000' }),
      }),
      app.request('/api/billing/customer-portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
    }
  });

  it('accepts signed Stripe webhooks without user authentication', async () => {
    const webhookService = new FakeStripeWebhookService();
    const app = createTestApp(new FakeBillingService(), webhookService);

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=test',
      },
      body: '{"id":"evt_123"}',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(webhookService.signature).toBe('t=1,v1=test');
    expect(webhookService.payload).toBe('{"id":"evt_123"}');
  });

  it('returns 422 when the Stripe signature header is missing', async () => {
    const app = createTestApp(new FakeBillingService(), new FakeStripeWebhookService());

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(422);
  });

  it('rejects oversized Stripe webhook payloads before calling the Stripe service', async () => {
    const webhookService = new FakeStripeWebhookService();
    const app = createTestApp(new FakeBillingService(), webhookService);
    const body = 'x'.repeat(256 * 1024 + 1);

    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
        'Stripe-Signature': 't=1,v1=test',
      },
      body,
    });

    expect(response.status).toBe(413);
    expect(webhookService.payload).toBeNull();
  });

  it('rate limits Stripe webhooks by public IP', async () => {
    const webhookService = new FakeStripeWebhookService();
    const app = createTestApp(new FakeBillingService(), webhookService, new BlockingRateLimitStore());
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=test',
        'x-forwarded-for': '203.0.113.10',
      },
      body: '{"id":"evt_123"}',
    } as const;

    const firstResponse = await app.request('/api/webhooks/stripe', request);
    const secondResponse = await app.request('/api/webhooks/stripe', request);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get('retry-after')).toBe('60');
    await expect(secondResponse.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded for webhook. Retry after 60 seconds',
      },
    });
  });

  it('accepts signed Stripe webhooks sent to the root compatibility endpoint', async () => {
    const webhookService = new FakeStripeWebhookService();
    const app = createTestApp(new FakeBillingService(), webhookService);

    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=test',
      },
      body: '{"id":"evt_root"}',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(webhookService.signature).toBe('t=1,v1=test');
    expect(webhookService.payload).toBe('{"id":"evt_root"}');
  });

  it('keeps unsigned root POST requests hidden', async () => {
    const webhookService = new FakeStripeWebhookService();
    const app = createTestApp(new FakeBillingService(), webhookService);

    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(404);
    expect(webhookService.payload).toBeNull();
  });
});

function createTestApp(
  billingService: BillingServicePort,
  stripeWebhookService: StripeWebhookServicePort,
  rateLimitStore?: RateLimitStore,
  authenticatedUser: AuthenticatedUser = testUser,
  mobileStorePurchaseService?: MobileStorePurchaseServicePort,
): ReturnType<typeof createApp> {
  return createApp({
    billingService,
    creditService: new FakeCreditService(),
    rateLimitStore,
    stripeWebhookService,
    userProvisioningService: new FakeUserProvisioningService(authenticatedUser),
    jwtSecret,
    mobileStorePurchaseService,
    googlePubSubPushVerifier:
      mobileStorePurchaseService === undefined
        ? undefined
        : { verifyAuthorization: async () => undefined },
  });
}

class FakeMobileStoreSubscriptionService implements MobileStorePurchaseServicePort {
  public readonly summaryUserIds: string[] = [];

  public constructor(private readonly summary: PersonalSubscriptionSummary | null) {}

  public listProducts(): readonly [] {
    return [];
  }

  public async getAccountBinding() {
    return {
      appleAppAccountToken: '11111111-1111-4111-8111-111111111111',
      googleObfuscatedAccountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subscriptionPurchaseAllowed: true,
    };
  }

  public async getPersonalSubscriptionSummary(
    userId: string,
  ): Promise<PersonalSubscriptionSummary | null> {
    this.summaryUserIds.push(userId);
    return this.summary;
  }

  public async verifyApplePurchase(): Promise<MobileStorePurchaseResult> {
    throw new Error('not used');
  }

  public async verifyGooglePurchase(): Promise<MobileStorePurchaseResult> {
    throw new Error('not used');
  }

  public async restorePurchases(): Promise<MobileStorePurchaseResult[]> {
    throw new Error('not used');
  }

  public async handleAppleNotification(): Promise<void> {
    throw new Error('not used');
  }

  public async handleGoogleRtdn(): Promise<void> {
    throw new Error('not used');
  }
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: testUser.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(testUser.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
