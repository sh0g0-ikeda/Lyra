import { describe, expect, it } from 'vitest';
import { GooglePlayDeveloperClient, type GooglePlayDeveloperApiPort } from '../../../../src/infrastructure/google/GooglePlayDeveloperClient.js';

describe('GooglePlayDeveloperClient', () => {
  it('uses trusted Google subscription API fields instead of client product or price', async () => {
    const api = new FakeGooglePlayApi();
    const client = new GooglePlayDeveloperClient(api);

    const purchase = await client.verifyPurchase({ purchaseToken: 'purchase-token-not-persisted' });

    expect(api.subscriptionTokens).toEqual(['purchase-token-not-persisted']);
    expect(purchase).toMatchObject({
      store: 'google',
      environment: 'production',
      productId: 'jp.lyra.standard.monthly',
      externalPurchaseId: 'purchase-token-not-persisted',
      transactionId: 'GPA.1111-2222',
      state: 'active',
      autoRenewEnabled: true,
      accountBinding: 'server-obfuscated-account',
    });
  });

  it('falls back to the one-time product API only when subscription lookup is not found', async () => {
    const api = new FakeGooglePlayApi({ subscriptionNotFound: true });
    const client = new GooglePlayDeveloperClient(api);

    const purchase = await client.verifyPurchase({ purchaseToken: 'one-time-token' });

    expect(api.oneTimeTokens).toEqual(['one-time-token']);
    expect(purchase).toMatchObject({
      productId: 'jp.lyra.credits.200',
      transactionId: 'GPA.3333-4444',
      accountBinding: 'server-obfuscated-account',
      state: 'active',
      isTestPurchase: true,
    });
  });
});

class FakeGooglePlayApi implements GooglePlayDeveloperApiPort {
  public readonly subscriptionTokens: string[] = [];
  public readonly oneTimeTokens: string[] = [];

  public constructor(private readonly options: { subscriptionNotFound?: boolean } = {}) {}

  public async getSubscriptionPurchase(purchaseToken: string): Promise<unknown> {
    this.subscriptionTokens.push(purchaseToken);
    if (this.options.subscriptionNotFound === true) {
      throw { response: { status: 404 } };
    }

    return {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [
        {
          productId: 'jp.lyra.standard.monthly',
          latestSuccessfulOrderId: 'GPA.1111-2222',
          expiryTime: '2026-08-25T00:00:00.000Z',
          autoRenewingPlan: { autoRenewEnabled: true },
        },
      ],
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: 'server-obfuscated-account',
      },
    };
  }

  public async getOneTimeProductPurchase(purchaseToken: string): Promise<unknown> {
    this.oneTimeTokens.push(purchaseToken);
    return {
      purchaseStateContext: { purchaseState: 'PURCHASE_STATE_PURCHASED' },
      orderId: 'GPA.3333-4444',
      productLineItem: [{ productId: 'jp.lyra.credits.200' }],
      obfuscatedExternalAccountId: 'server-obfuscated-account',
      testPurchaseContext: {},
    };
  }
}
