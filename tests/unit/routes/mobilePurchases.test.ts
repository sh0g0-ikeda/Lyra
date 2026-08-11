import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createMobilePurchaseRoutes } from '../../../src/routes/mobilePurchases.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../../../src/types/app.js';
import {
  mobilePurchaseAccountBindingSchema,
  mobileStoreProductCatalogSchema,
  mobileStorePurchaseResultSchema,
  mobileStoreRestoreResultSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'cognito-subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

describe('mobile purchase routes', () => {
  it('returns only the requested store product catalog from the server allowlist', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/catalog/apple');

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(mobileStoreProductCatalogSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      products: [
        {
          credit_package_code: null,
          kind: 'subscription',
          plan_code: 'standard',
          product_id: 'apple.standard',
        },
      ],
      store: 'apple',
    });
    expect(service.catalogRequests).toEqual(['apple']);
  });

  it('returns the authenticated account binding in the mobile contract shape', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/binding');

    expect(response.status).toBe(200);
    expect(mobilePurchaseAccountBindingSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('rejects an unknown store before reading the product catalog', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/catalog/windows');

    expect(response.status).toBe(422);
    expect(service.catalogRequests).toEqual([]);
  });

  it('Apple verification accepts only a signed transaction and never forwards client price or workspace data', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/apple/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signed_transaction: 'signed.apple.jws',
        environment: 'sandbox',
      }),
    });

    expect(response.status).toBe(200);
    expect(service.appleRequests).toEqual([
      {
        userId: user.id,
        signedTransaction: 'signed.apple.jws',
        environment: 'sandbox',
      },
    ]);
    const payload = await response.json();
    expect(mobileStorePurchaseResultSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      store: 'apple',
      state: 'active',
      product_kind: 'credit_pack',
      plan_code: null,
      scheduled_plan_code: null,
      scheduled_plan_effective_at: null,
      credit_package_code: 'credits_200',
      credits_changed: 10,
      is_duplicate: false,
    });
  });

  it('rejects organization, product, price, and state fields before the service is called', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/google/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchase_token: 'token-not-logged',
        organization_id: 'org-1',
        product_id: 'client-controlled',
        price: 1,
        state: 'active',
      }),
    });

    expect(response.status).toBe(422);
    expect(service.googleRequests).toEqual([]);
  });

  it('returns a Google verification result in the mobile contract shape', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/google/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purchase_token: 'google.purchase.token' }),
    });

    expect(response.status).toBe(200);
    expect(mobileStorePurchaseResultSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('restore verifies only receipt evidence for the authenticated personal account', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apple_signed_transactions: ['apple.jws.1'],
        google_purchase_tokens: ['play-token-1'],
      }),
    });

    expect(response.status).toBe(200);
    expect(service.restoreRequests).toEqual([
      {
        userId: user.id,
        appleSignedTransactions: ['apple.jws.1'],
        googlePurchaseTokens: ['play-token-1'],
      },
    ]);
    expect(mobileStoreRestoreResultSchema.safeParse(await response.json()).success).toBe(true);
  });
});

class FakeMobileStorePurchaseService implements MobileStorePurchaseServicePort {
  public catalogRequests: Array<'apple' | 'google'> = [];
  public appleRequests: Array<{ userId: string; signedTransaction: string; environment: 'sandbox' | 'production' }> = [];
  public googleRequests: Array<{ userId: string; purchaseToken: string }> = [];
  public restoreRequests: Array<{
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }> = [];

  public listProducts(store: 'apple' | 'google') {
    this.catalogRequests.push(store);
    return store === 'apple'
      ? [
          {
            kind: 'subscription' as const,
            planCode: 'standard' as const,
            productId: 'apple.standard',
            store,
          },
        ]
      : [
          {
            creditPackageCode: 'credits_200' as const,
            kind: 'credit_pack' as const,
            productId: 'google.credits.200',
            store,
          },
        ];
  }

  public async getAccountBinding(_userId: string): Promise<{
    appleAppAccountToken: string;
    googleObfuscatedAccountId: string;
    subscriptionPurchaseAllowed: boolean;
  }> {
    return {
      appleAppAccountToken: user.id,
      googleObfuscatedAccountId: 'google-account-binding',
      subscriptionPurchaseAllowed: true,
    };
  }

  public async verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: 'sandbox' | 'production';
  }): Promise<MobileStorePurchaseResult> {
    this.appleRequests.push(input);
    return buildResult('apple');
  }

  public async verifyGooglePurchase(input: { userId: string; purchaseToken: string }): Promise<MobileStorePurchaseResult> {
    this.googleRequests.push(input);
    return buildResult('google');
  }

  public async restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]> {
    this.restoreRequests.push(input);
    return [buildResult('apple'), buildResult('google')];
  }

  public async handleAppleNotification(_signedPayload: string): Promise<void> {}

  public async handleGoogleRtdn(_input: { messageId: string; data: string; publishTime: Date | null }): Promise<void> {}
}

function buildResult(store: 'apple' | 'google'): MobileStorePurchaseResult {
  return {
    store,
    state: 'active',
    productKind: 'credit_pack',
    planCode: null,
    scheduledPlanCode: null,
    scheduledPlanEffectiveAt: null,
    creditPackageCode: 'credits_200',
    creditsChanged: 10,
    isDuplicate: false,
  };
}

function authenticatedAs(authenticatedUser: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', authenticatedUser);
    await next();
  };
}

function passThrough(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}
