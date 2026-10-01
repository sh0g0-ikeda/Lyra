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

  it('production hint on a valid TestFlight receipt falls back only to an enabled sandbox verifier', async () => {
    const factory = new FakeAppleVerifierFactory({ transactionEnvironment: 'sandbox' });
    const result = await createClient(factory).verifyTransaction({ signedTransaction: 'testflight', environment: 'production' });
    expect(result.environment).toBe('sandbox');expect(factory.environments).toEqual(['production', 'sandbox']);
  });

  it('disabled sandbox is never enabled by an untrusted client environment hint', async () => {
    const factory = new FakeAppleVerifierFactory({ transactionEnvironment: 'sandbox' });
    const client = new AppStoreServerClient({ bundleId: 'jp.lyra.app', appAppleId: 1, rootCertificates: [], allowSandbox: false, allowProduction: true, timeoutMs: 50 }, factory);
    await expect(client.verifyTransaction({ signedTransaction: 'testflight', environment: 'sandbox' })).rejects.toThrow();
    expect(factory.environments).not.toContain('sandbox');
  });

  it('verified billing grace preserves access past the transaction expiry until its own deadline', async () => {
    const factory = new FakeAppleVerifierFactory({ notificationType: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD', expiresDate: Date.parse('2026-07-30T00:00:00Z'), gracePeriodExpiresDate: Date.parse('2026-08-03T00:00:00Z') });
    const purchase = await createClient(factory).verifyNotification('grace');
    expect(purchase).toMatchObject({ state: 'active', expiresAt: new Date('2026-08-03T00:00:00Z'), providerEventType: 'apple.DID_FAIL_TO_RENEW.GRACE_PERIOD' });
  });

  it('billing retry without verified grace does not invent indefinite entitlement', async () => {
    const purchase = await createClient(new FakeAppleVerifierFactory({ notificationType: 'DID_FAIL_TO_RENEW', expiresDate: Date.parse('2026-07-30T00:00:00Z') })).verifyNotification('retry');
    expect(purchase?.state).toBe('expired');
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
      subtype?: string;
      transactionEnvironment?: 'sandbox' | 'production';
      gracePeriodExpiresDate?: number;
      revocationType?: string;
      expiresDate?: number;
    } = {},
  ) {}

  public create(environment: 'sandbox' | 'production') {
    this.environments.push(environment);
    return {
      verifyAndDecodeTransaction: async (_signedTransaction: string) => { if (this.options.transactionEnvironment && this.options.transactionEnvironment !== environment) throw new Error('wrong environment'); return this.transaction(); },
      verifyAndDecodeNotification: async (_signedPayload: string) => ({
        notificationType: this.options.notificationType ?? 'DID_RENEW',
        subtype: this.options.subtype,
        notificationUUID: 'notification-1',
        signedDate: Date.parse('2026-07-31T00:00:00.000Z'),
        data: {
          environment: environment === 'sandbox' ? 'Sandbox' : 'Production',
          signedTransactionInfo: 'inner.transaction.jws',
          signedRenewalInfo: 'inner.renewal.jws',
        },
      }),
      verifyAndDecodeRenewalInfo: async (_signedRenewal: string) => ({ autoRenewStatus: 1, gracePeriodExpiresDate: this.options.gracePeriodExpiresDate }),
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
