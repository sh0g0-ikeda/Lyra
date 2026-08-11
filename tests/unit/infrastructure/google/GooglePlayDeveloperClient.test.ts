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

  it('deferredダウングレードの現在商品・次回商品・旧tokenを署名元APIから分離する', async () => {
    const api = new FakeGooglePlayApi({ deferredDowngrade: true });
    const client = new GooglePlayDeveloperClient(api);

    const purchase = await client.verifyPurchase({ purchaseToken: 'new-purchase-token' });

    expect(purchase).toMatchObject({
      productId: 'jp.lyra.premium.monthly',
      renewalProductId: 'jp.lyra.standard.monthly',
      linkedExternalPurchaseId: 'old-purchase-token',
      expiresAt: new Date('2026-08-25T00:00:00.000Z'),
    });
  });

  it.each([400, 404])(
    'subscription lookup が status %i で商品種別不一致の場合に one-time product API へ進む',
    async (subscriptionStatus) => {
      const api = new FakeGooglePlayApi({ subscriptionStatus });
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
    },
  );

  it('subscription lookup が権限エラーの場合に one-time product API へ進まない', async () => {
    const api = new FakeGooglePlayApi({ subscriptionStatus: 403 });
    const client = new GooglePlayDeveloperClient(api);

    await expect(client.verifyPurchase({ purchaseToken: 'forbidden-token' }))
      .rejects.toThrow('Store purchase could not be verified');

    expect(api.oneTimeTokens).toEqual([]);
  });

  it.each([
    ['PURCHASED', 'active'],
    ['PENDING', 'pending'],
    ['CANCELLED', 'cancelled'],
  ] as const)('one-time product の状態 %s を内部状態 %s に変換する', async (purchaseState, expectedState) => {
    const api = new FakeGooglePlayApi({
      oneTimePurchaseState: purchaseState,
      subscriptionStatus: 404,
    });
    const client = new GooglePlayDeveloperClient(api);

    const purchase = await client.verifyPurchase({ purchaseToken: 'one-time-token' });

    expect(purchase.state).toBe(expectedState);
  });

  it('旧形式の one-time product 状態も既存購入の互換性のため受理する', async () => {
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

  public constructor(private readonly options: {
    oneTimePurchaseState?: string;
    deferredDowngrade?: boolean;
    subscriptionNotFound?: boolean;
    subscriptionStatus?: number;
  } = {}) {}

  public async getSubscriptionPurchase(purchaseToken: string): Promise<unknown> {
    this.subscriptionTokens.push(purchaseToken);
    const subscriptionStatus = this.options.subscriptionStatus
      ?? (this.options.subscriptionNotFound === true ? 404 : null);
    if (subscriptionStatus !== null) {
      throw { response: { status: subscriptionStatus } };
    }

    if (this.options.deferredDowngrade === true) {
      return {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        linkedPurchaseToken: 'old-purchase-token',
        lineItems: [
          {
            productId: 'jp.lyra.premium.monthly',
            latestSuccessfulOrderId: 'GPA.1111-2222',
            expiryTime: '2026-08-25T00:00:00.000Z',
            autoRenewingPlan: { autoRenewEnabled: false },
            deferredItemReplacement: { productId: 'jp.lyra.standard.monthly' },
          },
          {
            productId: 'jp.lyra.standard.monthly',
            expiryTime: '2026-09-25T00:00:00.000Z',
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
        externalAccountIdentifiers: {
          obfuscatedExternalAccountId: 'server-obfuscated-account',
        },
      };
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
      purchaseStateContext: { purchaseState: this.options.oneTimePurchaseState ?? 'PURCHASE_STATE_PURCHASED' },
      orderId: 'GPA.3333-4444',
      productLineItem: [{ productId: 'jp.lyra.credits.200' }],
      obfuscatedExternalAccountId: 'server-obfuscated-account',
      testPurchaseContext: {},
    };
  }
}
