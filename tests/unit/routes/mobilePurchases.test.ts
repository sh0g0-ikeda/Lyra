import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  mobilePurchaseAccountBindingSchema,
  mobileStoreProductCatalogSchema,
  mobileStorePurchaseResultSchema,
  mobileStoreRestoreResultSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import type { PersonalSubscriptionSummary } from '../../../src/domain/types/billing.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createMobilePurchaseRoutes } from '../../../src/routes/mobilePurchases.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

describe('mobile purchase routes', () => {
  it('要求storeのserver allowlistだけをcontract shapeで返す', async () => {
    const service = new FakeService();
    const app = createRoutes(service);

    const response = await app.request('/catalog/apple');
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(mobileStoreProductCatalogSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      store: 'apple',
      products: [
        {
          product_id: 'apple.standard',
          kind: 'subscription',
          plan_code: 'standard',
          credit_package_code: null,
        },
      ],
    });
  });

  it('認証user専用のstore account bindingを返す', async () => {
    const response = await createRoutes(new FakeService()).request('/binding');

    expect(response.status).toBe(200);
    expect(
      mobilePurchaseAccountBindingSchema.safeParse(await response.json()).success,
    ).toBe(true);
  });

  it('Apple verifyは署名と環境だけをserviceへ渡す', async () => {
    const service = new FakeService();
    const response = await createRoutes(service).request('/apple/verify', {
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
    expect(
      mobileStorePurchaseResultSchema.safeParse(await response.json()).success,
    ).toBe(true);
  });

  it('client指定のorganization・product・price・stateをstrict bodyで拒否する', async () => {
    const service = new FakeService();
    const response = await createRoutes(service).request('/google/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchase_token: 'google.purchase.token',
        organization_id: 'org-1',
        product_id: 'client-controlled',
        price: 1,
        state: 'active',
      }),
    });

    expect(response.status).toBe(422);
    expect(service.googleRequests).toEqual([]);
  });

  it('restore evidenceを50件ずつに制限してpersonal userへ渡す', async () => {
    const service = new FakeService();
    const response = await createRoutes(service).request('/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apple_signed_transactions: ['apple.jws.1'],
        google_purchase_tokens: ['google.token.1'],
      }),
    });

    expect(response.status).toBe(200);
    expect(service.restoreRequests).toEqual([
      {
        userId: user.id,
        appleSignedTransactions: ['apple.jws.1'],
        googlePurchaseTokens: ['google.token.1'],
      },
    ]);
    expect(
      mobileStoreRestoreResultSchema.safeParse(await response.json()).success,
    ).toBe(true);
  });
});

function createRoutes(service: FakeService) {
  const app = createMobilePurchaseRoutes({
    authMiddleware: authenticatedAs(user),
    rateLimitMiddleware: passThrough(),
    mobileStorePurchaseService: service,
  });
  app.onError(errorHandler);
  return app;
}

class FakeService implements MobileStorePurchaseServicePort {
  public readonly appleRequests: Array<{
    userId: string;
    signedTransaction: string;
    environment: 'sandbox' | 'production';
  }> = [];
  public readonly googleRequests: Array<{ userId: string; purchaseToken: string }> = [];
  public readonly restoreRequests: Array<{
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }> = [];

  public listProducts(store: 'apple' | 'google') {
    return store === 'apple'
      ? [
          {
            store,
            productId: 'apple.standard',
            kind: 'subscription' as const,
            planCode: 'standard' as const,
          },
        ]
      : [];
  }

  public async getAccountBinding() {
    return {
      appleAppAccountToken: user.id,
      googleObfuscatedAccountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subscriptionPurchaseAllowed: true,
    };
  }

  public async getPersonalSubscriptionSummary(): Promise<PersonalSubscriptionSummary | null> {
    return null;
  }

  public async verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: 'sandbox' | 'production';
  }): Promise<MobileStorePurchaseResult> {
    this.appleRequests.push(input);
    return result('apple');
  }

  public async verifyGooglePurchase(input: {
    userId: string;
    purchaseToken: string;
  }): Promise<MobileStorePurchaseResult> {
    this.googleRequests.push(input);
    return result('google');
  }

  public async restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]> {
    this.restoreRequests.push(input);
    return [result('apple'), result('google')];
  }

  public async handleAppleNotification(): Promise<void> {}
  public async handleGoogleRtdn(): Promise<void> {}
}

function result(store: 'apple' | 'google'): MobileStorePurchaseResult {
  return {
    store,
    state: 'active',
    productKind: 'credit_pack',
    planCode: null,
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
