import type { MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/domain/errors/index.js';
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

  it('Google Pub/Sub が併記する alias と deliveryAttempt を受理する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
    });
    app.onError(errorHandler);

    const response = await app.request('/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer trusted-oidc-token',
      },
      body: JSON.stringify({
        deliveryAttempt: 2,
        message: {
          data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
          messageId: 'pubsub-message-2',
          message_id: 'pubsub-message-2',
          publishTime: '2026-08-09T04:32:54.000Z',
          publish_time: '2026-08-09T04:32:54.000Z',
        },
        subscription: 'projects/example/subscriptions/google-play-rtdn',
      }),
    });

    expect(response.status).toBe(200);
    expect(service.googleNotifications).toEqual([{
      messageId: 'pubsub-message-2',
      data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
      publishTime: new Date('2026-08-09T04:32:54.000Z'),
    }]);
  });

  it('Google Pub/Sub alias の値が一致しない場合に拒否する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
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
          data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
          messageId: 'canonical-message',
          message_id: 'different-message',
        },
      }),
    });

    expect(response.status).toBe(422);
    expect(service.googleNotifications).toEqual([]);
  });

  it('Google Pub/Sub の snake_case alias だけでも正規化して受理する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
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
          data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
          message_id: 'snake-case-message',
          publish_time: '2026-08-09T04:32:54.000Z',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(service.googleNotifications).toEqual([{
      messageId: 'snake-case-message',
      data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
      publishTime: new Date('2026-08-09T04:32:54.000Z'),
    }]);
  });

  it('Google Pub/Sub OIDC 検証失敗時は秘密値を含めず認証段階だけを記録する', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: new FakeMobileStorePurchaseService(),
      googlePubSubPushVerifier: {
        verifyAuthorization: async () => {
          throw new ValidationError('Store notification could not be verified');
        },
      },
    });
    app.onError(errorHandler);

    const response = await app.request('/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer must-not-appear-in-logs',
      },
      body: JSON.stringify({
        message: {
          messageId: 'pubsub-message-auth-failure',
          data: 'eyJwYWNrYWdlTmFtZSI6ImNvbS5seXJhLm1vYmlsZSJ9',
        },
      }),
    });

    expect(response.status).toBe(422);
    const diagnostic = warn.mock.calls
      .map(([entry]) => String(entry))
      .find((entry) => entry.includes('google_play_notification_rejected'));
    expect(diagnostic).toBeDefined();
    expect(JSON.parse(diagnostic ?? '{}')).toMatchObject({
      event: 'google_play_notification_rejected',
      stage: 'authorization',
      authorization_header_present: true,
    });
    expect(diagnostic).not.toContain('must-not-appear-in-logs');
    warn.mockRestore();
  });

  it('Google RTDN 処理失敗時は購入データを含めず通知段階だけを記録する', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new FakeMobileStorePurchaseService();
    service.googleError = new ValidationError('Store notification could not be verified');
    const app = createMobilePurchaseWebhookRoutes({
      rateLimitMiddleware: passThrough(),
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
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
          messageId: 'pubsub-message-notification-failure',
          data: 'c2Vuc2l0aXZlLXB1cmNoYXNlLXRva2Vu',
        },
      }),
    });

    expect(response.status).toBe(422);
    const diagnostic = warn.mock.calls
      .map(([entry]) => String(entry))
      .find((entry) => entry.includes('google_play_notification_rejected'));
    expect(JSON.parse(diagnostic ?? '{}')).toMatchObject({
      event: 'google_play_notification_rejected',
      stage: 'notification',
    });
    expect(diagnostic).not.toContain('c2Vuc2l0aXZlLXB1cmNoYXNlLXRva2Vu');
    warn.mockRestore();
  });
});

class FakeMobileStorePurchaseService implements MobileStorePurchaseServicePort {
  public readonly appleNotifications: string[] = [];
  public readonly googleNotifications: Array<{ messageId: string; data: string; publishTime: Date | null }> = [];
  public googleError: Error | null = null;

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
    if (this.googleError !== null) {
      throw this.googleError;
    }
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
