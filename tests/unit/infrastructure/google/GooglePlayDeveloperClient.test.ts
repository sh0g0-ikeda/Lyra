import { describe, expect, it } from 'vitest';
import {
  GooglePlayDeveloperClient,
  type GooglePlayDeveloperApiPort,
} from '../../../../src/infrastructure/google/GooglePlayDeveloperClient.js';

describe('GooglePlayDeveloperClient', () => {
  it('client claimではなくGoogle subscription APIの値だけを正規化する', async () => {
    const api = new FakeGooglePlayApi();
    const client = new GooglePlayDeveloperClient(api, () => new Date('2026-07-31T00:00:00.000Z'));

    const purchase = await client.verifyPurchase({ purchaseToken: 'purchase-token-not-persisted' });

    expect(api.subscriptionTokens).toEqual(['purchase-token-not-persisted']);
    expect(purchase).toMatchObject({
      store: 'google',
      environment: 'production',
      productId: 'jp.lyra.standard.monthly',
      externalPurchaseId: 'purchase-token-not-persisted',
      linkedExternalPurchaseId: 'previous-purchase-token',
      transactionId: 'GPA.1111-2222',
      state: 'active',
      autoRenewEnabled: true,
      accountBinding: 'server-obfuscated-account',
      providerCompletion: 'acknowledge',
    });
  });

  it('subscriptionが404の場合だけone-time product APIへfallbackする', async () => {
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
      providerCompletion: 'consume',
    });
  });

  it('すでにconsume済みのone-time purchaseは再consume対象にしない', async () => {
    const api = new FakeGooglePlayApi({
      subscriptionNotFound: true,
      oneTimeConsumptionState: 'CONSUMPTION_STATE_CONSUMED',
    });
    const client = new GooglePlayDeveloperClient(api);

    const purchase = await client.verifyPurchase({ purchaseToken: 'consumed-token' });

    expect(purchase).toMatchObject({
      state: 'active',
      providerCompletion: 'none',
    });
  });

  it('付与後にsubscriptionをacknowledgeしcredit packをconsumeする', async () => {
    const api = new FakeGooglePlayApi();
    const client = new GooglePlayDeveloperClient(api);

    await client.completePurchase({
      purchaseToken: 'subscription-token',
      productId: 'subscription-product',
      completion: 'acknowledge',
    });
    await client.completePurchase({
      purchaseToken: 'credit-token',
      productId: 'credit-product',
      completion: 'consume',
    });

    expect(api.acknowledged).toEqual([
      { purchaseToken: 'subscription-token', productId: 'subscription-product' },
    ]);
    expect(api.consumed).toEqual([
      { purchaseToken: 'credit-token', productId: 'credit-product' },
    ]);
  });
});

class FakeGooglePlayApi implements GooglePlayDeveloperApiPort {
  public readonly subscriptionTokens: string[] = [];
  public readonly oneTimeTokens: string[] = [];
  public readonly acknowledged: Array<{ purchaseToken: string; productId: string }> = [];
  public readonly consumed: Array<{ purchaseToken: string; productId: string }> = [];

  public constructor(
    private readonly options: {
      subscriptionNotFound?: boolean;
      oneTimeConsumptionState?: string;
    } = {},
  ) {}

  public async getSubscriptionPurchase(purchaseToken: string): Promise<unknown> {
    this.subscriptionTokens.push(purchaseToken);
    if (this.options.subscriptionNotFound === true) {
      throw { response: { status: 404 } };
    }

    return {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      latestOrderId: 'GPA.1111-2222',
      linkedPurchaseToken: 'previous-purchase-token',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      lineItems: [
        {
          productId: 'jp.lyra.standard.monthly',
          latestSuccessfulOrderId: 'GPA.1111-2222',
          expiryTime: '2026-08-31T00:00:00.000Z',
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
      purchaseStateContext: { purchaseState: 'PURCHASED' },
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      purchaseCompletionTime: '2026-07-31T00:00:00.000Z',
      orderId: 'GPA.3333-4444',
      productLineItem: [
        {
          productId: 'jp.lyra.credits.200',
          productOfferDetails:
            this.options.oneTimeConsumptionState === undefined
              ? undefined
              : { consumptionState: this.options.oneTimeConsumptionState },
        },
      ],
      obfuscatedExternalAccountId: 'server-obfuscated-account',
      testPurchaseContext: {},
    };
  }

  public async acknowledgeSubscription(
    purchaseToken: string,
    productId: string,
  ): Promise<void> {
    this.acknowledged.push({ purchaseToken, productId });
  }

  public async consumeProduct(purchaseToken: string, productId: string): Promise<void> {
    this.consumed.push({ purchaseToken, productId });
  }
}
