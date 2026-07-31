import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { PersonalSubscriptionSummary } from '../../../src/domain/types/billing.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../../../src/services/billing/MobileStorePurchaseService.js';

describe('mobile purchase app wiring', () => {
  it('既定構成では購入APIとprovider webhookを公開しない', async () => {
    const app = createApp({ enableDevAuthBypass: true });

    expect((await app.request('/api/mobile-purchases/binding')).status).toBe(404);
    expect(
      (
        await app.request('/api/webhooks/mobile-purchases/apple', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signedPayload: 'not-mounted' }),
        })
      ).status,
    ).toBe(404);
  });

  it('注入した依存だけを認証APIとprovider webhookへ配線する', async () => {
    const service = new FakeService();
    const verifier = new FakeGoogleVerifier();
    const app = createApp({
      enableDevAuthBypass: true,
      mobileStorePurchaseService: service,
      googlePubSubPushVerifier: verifier,
    });

    const binding = await app.request('/api/mobile-purchases/binding');
    const webhook = await app.request('/api/webhooks/mobile-purchases/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer trusted-token',
      },
      body: JSON.stringify({
        message: { messageId: 'message-1', data: 'e30=' },
      }),
    });

    expect(binding.status).toBe(200);
    expect(webhook.status).toBe(200);
    expect(service.bindingRequests).toBe(1);
    expect(verifier.authorizations).toEqual(['Bearer trusted-token']);
  });
});

class FakeService implements MobileStorePurchaseServicePort {
  public bindingRequests = 0;
  public listProducts(): readonly [] {
    return [];
  }
  public async getAccountBinding() {
    this.bindingRequests += 1;
    return {
      appleAppAccountToken: '11111111-1111-4111-8111-111111111111',
      googleObfuscatedAccountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
  public async handleAppleNotification(): Promise<void> {}
  public async handleGoogleRtdn(): Promise<void> {}
}

class FakeGoogleVerifier {
  public readonly authorizations: Array<string | undefined> = [];
  public async verifyAuthorization(authorization: string | undefined): Promise<void> {
    this.authorizations.push(authorization);
  }
}
