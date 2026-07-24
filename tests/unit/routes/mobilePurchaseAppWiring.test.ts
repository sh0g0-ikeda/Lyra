import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type {
  MobileStoreAccountBinding,
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';

describe('mobile purchase app wiring', () => {
  it('dev auth bypassがない購入APIはservice実行前に401で拒否する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createApp({
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
    });

    const response = await app.request('/api/mobile-purchases/binding');

    expect(response.status).toBe(401);
    expect(service.accountBindingRequests).toBe(0);
  });

  it('有効な依存関係がある場合に認証済み購入APIを公開する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const app = createApp({
      enableDevAuthBypass: true,
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: new FakeGooglePubSubPushVerifier(),
    });

    const response = await app.request('/api/mobile-purchases/binding');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      apple_app_account_token: '11111111-1111-4111-8111-111111111111',
      google_obfuscated_account_id: 'google-binding',
    });
  });

  it('provider webhookを認証購入APIとは別の公開経路へ配線する', async () => {
    const service = new FakeMobileStorePurchaseService();
    const verifier = new FakeGooglePubSubPushVerifier();
    const app = createApp({
      enableDevAuthBypass: true,
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: verifier,
    });

    const response = await app.request('/api/webhooks/mobile-purchases/google', {
      method: 'POST',
      headers: {
        authorization: 'Bearer trusted-pubsub-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          messageId: 'message-1',
          data: 'eyJwYWNrYWdlTmFtZSI6ImpwLmx5cmEuYXBwIn0=',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(verifier.authorizations).toEqual(['Bearer trusted-pubsub-token']);
    expect(service.googleNotifications).toHaveLength(1);
  });
});

class FakeMobileStorePurchaseService implements MobileStorePurchaseServicePort {
  public accountBindingRequests = 0;
  public readonly googleNotifications: Array<{
    messageId: string;
    data: string;
    publishTime: Date | null;
  }> = [];

  public listProducts(_store: 'apple' | 'google'): readonly [] {
    return [];
  }

  public async getAccountBinding(_userId: string): Promise<MobileStoreAccountBinding> {
    this.accountBindingRequests += 1;
    return {
      appleAppAccountToken: '11111111-1111-4111-8111-111111111111',
      googleObfuscatedAccountId: 'google-binding',
      subscriptionPurchaseAllowed: true,
    };
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

  public async handleGoogleRtdn(input: {
    messageId: string;
    data: string;
    publishTime: Date | null;
  }): Promise<void> {
    this.googleNotifications.push(input);
  }
}

class FakeGooglePubSubPushVerifier {
  public readonly authorizations: Array<string | undefined> = [];

  public async verifyAuthorization(authorization: string | undefined): Promise<void> {
    this.authorizations.push(authorization);
  }
}
