import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import type { PersonalSubscriptionSummary } from '../../../src/domain/types/billing.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createMobilePurchaseWebhookRoutes } from '../../../src/routes/mobilePurchaseWebhooks.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../../../src/types/app.js';

describe('mobile purchase webhook routes', () => {
  it('Apple signedPayload以外のfieldを拒否して検証serviceへ渡す', async () => {
    const service = new FakeService();
    const app = createRoutes(service, new FakeGoogleVerifier());

    const response = await app.request('/apple', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'apple.signed.notification' }),
    });

    expect(response.status).toBe(200);
    expect(service.appleNotifications).toEqual(['apple.signed.notification']);
  });

  it('Google PubSub OIDC検証後だけbounded RTDNをserviceへ渡す', async () => {
    const service = new FakeService();
    const verifier = new FakeGoogleVerifier();
    const app = createRoutes(service, verifier);

    const response = await app.request('/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer trusted-oidc-token',
      },
      body: JSON.stringify({
        message: {
          messageId: 'message-1',
          data: 'eyJwYWNrYWdlTmFtZSI6ImpwLmx5cmEuYXBwIn0=',
          publishTime: '2026-07-31T00:00:00.000Z',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(verifier.authorizations).toEqual(['Bearer trusted-oidc-token']);
    expect(service.googleNotifications).toEqual([
      {
        messageId: 'message-1',
        data: 'eyJwYWNrYWdlTmFtZSI6ImpwLmx5cmEuYXBwIn0=',
        publishTime: new Date('2026-07-31T00:00:00.000Z'),
      },
    ]);
  });
});

function createRoutes(service: FakeService, verifier: FakeGoogleVerifier) {
  const app = createMobilePurchaseWebhookRoutes({
    rateLimitMiddleware: passThrough(),
    mobileStorePurchaseService: service,
    googlePubSubPushVerifier: verifier,
  });
  app.onError(errorHandler);
  return app;
}

class FakeService implements MobileStorePurchaseServicePort {
  public readonly appleNotifications: string[] = [];
  public readonly googleNotifications: Array<{
    messageId: string;
    data: string;
    publishTime: Date | null;
  }> = [];

  public listProducts(): readonly [] {
    return [];
  }
  public async getAccountBinding() {
    return {
      appleAppAccountToken: 'binding',
      googleObfuscatedAccountId: 'binding',
      subscriptionPurchaseAllowed: true,
    };
  }
  public async getPersonalSubscriptionSummary(): Promise<PersonalSubscriptionSummary | null> {
    return null;
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
  public async handleAppleNotification(signedPayload: string): Promise<void> {
    this.appleNotifications.push(signedPayload);
  }
  public async handleGoogleRtdn(input: {
    messageId: string;
    data: string;
    publishTime: Date | null;
  }): Promise<void> {
    this.googleNotifications.push(input);
  }
}

class FakeGoogleVerifier {
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
