import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createMobilePurchaseWebhookRoutes } from '../../../src/routes/mobilePurchaseWebhooks.js';
import type {
  MobileStoreAccountBinding,
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../../../src/types/app.js';

describe('mobile purchase webhook routes', () => {
  it('passes only an Apple signed payload to the store service', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
    });
    app.onError(errorHandler);

    const response = await app.request('/apple', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'apple.signed.notification' }),
    });

    expect(response.status).toBe(200);
    expect(service.appleNotifications).toEqual(['apple.signed.notification']);
  });

  it('requires verified Google Pub/Sub OIDC before processing encoded RTDN data', async () => {
    const service = new FakeMobileStorePurchaseService();
    const verifier = new FakeGooglePubSubPushVerifier();
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: verifier,
    });
    app.onError(errorHandler);

    const response = await app.request('/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer trusted-oidc-token',
      },
      body: JSON.stringify({
        message: {
          messageId: 'pubsub-message-1',
          data: 'eyJwYWNrYWdlTmFtZSI6ImpwLmx5cmEuYXBwIn0=',
          publishTime: '2026-07-25T00:00:00.000Z',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(verifier.authorizations).toEqual(['Bearer trusted-oidc-token']);
    expect(service.googleNotifications).toEqual([
      {
        messageId: 'pubsub-message-1',
        data: 'eyJwYWNrYWdlTmFtZSI6ImpwLmx5cmEuYXBwIn0=',
        publishTime: new Date('2026-07-25T00:00:00.000Z'),
      },
    ]);
  });
});

class FakeMobileStorePurchaseService implements MobileStorePurchaseServicePort {
  public readonly appleNotifications: string[] = [];
  public readonly googleNotifications: Array<{ messageId: string; data: string; publishTime: Date | null }> = [];

  public listProducts(_store: 'apple' | 'google'): readonly [] {
    return [];
  }

  public async getAccountBinding(_userId: string): Promise<MobileStoreAccountBinding> {
    return {
      appleAppAccountToken: 'binding',
      googleObfuscatedAccountId: 'binding',
      subscriptionPurchaseAllowed: true,
    };
  }

  public async verifyApplePurchase(_input: {
    userId: string;
    signedTransaction: string;
    environment: 'sandbox' | 'production';
  }): Promise<MobileStorePurchaseResult> {
    throw new Error('not used');
  }

  public async verifyGooglePurchase(_input: { userId: string; purchaseToken: string }): Promise<MobileStorePurchaseResult> {
    throw new Error('not used');
  }

  public async restorePurchases(_input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]> {
    throw new Error('not used');
  }

  public async handleAppleNotification(signedPayload: string): Promise<void> {
    this.appleNotifications.push(signedPayload);
  }

  public async handleGoogleRtdn(input: { messageId: string; data: string; publishTime: Date | null }): Promise<void> {
    this.googleNotifications.push(input);
  }
}

class FakeGooglePubSubPushVerifier {
  public readonly authorizations: Array<string | undefined> = [];

  public async verifyAuthorization(authorization: string | undefined): Promise<void> {
    this.authorizations.push(authorization);
  }
}

function passThrough(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}
