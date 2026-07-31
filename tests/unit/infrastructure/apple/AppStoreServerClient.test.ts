import { describe, expect, it } from 'vitest';
import {
  AppStoreServerClient,
  type AppleSignedDataVerifierFactory,
} from '../../../../src/infrastructure/apple/AppStoreServerClient.js';

describe('AppStoreServerClient', () => {
  it('選択環境の公式verifierで署名済みtransactionだけを検証する', async () => {
    const factory = new FakeAppleVerifierFactory();
    const client = createClient(factory);

    const purchase = await client.verifyTransaction({
      signedTransaction: 'signed.jws.from.store',
      environment: 'sandbox',
    });

    expect(factory.environments).toEqual(['sandbox']);
    expect(purchase).toMatchObject({
      store: 'apple',
      environment: 'sandbox',
      productId: 'jp.lyra.credits.200',
      externalPurchaseId: 'original-1',
      transactionId: 'transaction-1',
      state: 'active',
      accountBinding: '11111111-1111-4111-8111-111111111111',
      providerCompletion: 'none',
    });
  });

  it('署名済みrefundとrevocation通知をterminal stateへ正規化する', async () => {
    const client = createClient(
      new FakeAppleVerifierFactory({
        notificationType: 'REVOKE',
        revocationType: 'FAMILY_REVOKE',
      }),
    );

    const purchase = await client.verifyNotification('signed.notification.jws');

    expect(purchase).toMatchObject({
      state: 'revoked',
      eventId: 'notification-1',
      providerEventType: 'apple.REVOKE',
    });
  });

  it('期限切れtransactionをactiveとして扱わない', async () => {
    const client = createClient(
      new FakeAppleVerifierFactory({
        expiresDate: Date.parse('2026-07-30T00:00:00.000Z'),
      }),
    );

    const purchase = await client.verifyTransaction({
      signedTransaction: 'expired',
      environment: 'sandbox',
    });

    expect(purchase.state).toBe('expired');
  });
});

function createClient(factory: AppleSignedDataVerifierFactory): AppStoreServerClient {
  return new AppStoreServerClient(
    {
      bundleId: 'jp.lyra.app',
      appAppleId: 123456789,
      rootCertificates: [Buffer.from('root')],
      allowSandbox: true,
      allowProduction: true,
      timeoutMs: 1_000,
    },
    factory,
  );
}

class FakeAppleVerifierFactory implements AppleSignedDataVerifierFactory {
  public readonly environments: Array<'sandbox' | 'production'> = [];

  public constructor(
    private readonly options: {
      notificationType?: string;
      revocationType?: string;
      expiresDate?: number;
    } = {},
  ) {}

  public create(environment: 'sandbox' | 'production') {
    this.environments.push(environment);
    return {
      verifyAndDecodeTransaction: async (_signedTransaction: string) => this.transaction(),
      verifyAndDecodeNotification: async (_signedPayload: string) => ({
        notificationType: this.options.notificationType ?? 'DID_RENEW',
        notificationUUID: 'notification-1',
        signedDate: Date.parse('2026-07-31T00:00:00.000Z'),
        data: {
          environment: environment === 'sandbox' ? 'Sandbox' : 'Production',
          signedTransactionInfo: 'inner.transaction.jws',
          signedRenewalInfo: 'inner.renewal.jws',
        },
      }),
      verifyAndDecodeRenewalInfo: async (_signedRenewal: string) => ({ autoRenewStatus: 1 }),
    };
  }

  private transaction() {
    return {
      originalTransactionId: 'original-1',
      transactionId: 'transaction-1',
      productId: 'jp.lyra.credits.200',
      appAccountToken: '11111111-1111-4111-8111-111111111111',
      signedDate: Date.parse('2026-07-31T00:00:00.000Z'),
      purchaseDate: Date.parse('2026-07-31T00:00:00.000Z'),
      expiresDate: this.options.expiresDate,
      revocationType: this.options.revocationType,
    };
  }
}
