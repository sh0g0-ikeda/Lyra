import { describe, expect, it } from 'vitest';
import { AppStoreServerClient, type AppleSignedDataVerifierFactory } from '../../../../src/infrastructure/apple/AppStoreServerClient.js';

describe('AppStoreServerClient', () => {
  it('verifies a signed transaction with the selected official-verifier environment and ignores client pricing', async () => {
    const factory = new FakeAppleVerifierFactory();
    const client = new AppStoreServerClient(
      {
        bundleId: 'jp.lyra.app',
        appAppleId: 123456789,
        rootCertificates: [Buffer.from('root')],
        allowSandbox: true,
        allowProduction: true,
      },
      factory,
    );

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
    });
  });

  it('クライアントの環境ヒントが誤っていても有効なSandbox署名を検証する', async () => {
    const factory = new FakeAppleVerifierFactory({ transactionFailureEnvironments: ['production'] });
    const client = new AppStoreServerClient(
      {
        bundleId: 'jp.lyra.app',
        appAppleId: 123456789,
        rootCertificates: [Buffer.from('root')],
        allowSandbox: true,
        allowProduction: true,
      },
      factory,
    );

    const purchase = await client.verifyTransaction({
      signedTransaction: 'signed.sandbox.jws.from.testflight',
      environment: 'production',
    });

    expect(factory.environments).toEqual(['production', 'sandbox']);
    expect(purchase.environment).toBe('sandbox');
  });

  it('Sandboxが無効な場合はSandbox署名検証へフォールバックしない', async () => {
    const factory = new FakeAppleVerifierFactory({ transactionFailureEnvironments: ['production'] });
    const client = new AppStoreServerClient(
      {
        bundleId: 'jp.lyra.app',
        appAppleId: 123456789,
        rootCertificates: [Buffer.from('root')],
        allowSandbox: false,
        allowProduction: true,
      },
      factory,
    );

    await expect(client.verifyTransaction({
      signedTransaction: 'signed.sandbox.jws.from.testflight',
      environment: 'production',
    })).rejects.toThrow('Store purchase could not be verified');
    expect(factory.environments).toEqual(['production']);
  });

  it('maps signed Apple refund and revocation notifications to terminal states', async () => {
    const factory = new FakeAppleVerifierFactory({
      notificationType: 'REVOKE',
      revocationType: 'FAMILY_REVOKE',
    });
    const client = new AppStoreServerClient(
      {
        bundleId: 'jp.lyra.app',
        appAppleId: 123456789,
        rootCertificates: [Buffer.from('root')],
        allowSandbox: true,
        allowProduction: true,
      },
      factory,
    );

    const purchase = await client.verifyNotification('signed.notification.jws');

    expect(purchase).toMatchObject({
      state: 'revoked',
      eventId: 'notification-1',
      providerEventType: 'apple.REVOKE',
    });
  });
});

class FakeAppleVerifierFactory implements AppleSignedDataVerifierFactory {
  public readonly environments: Array<'sandbox' | 'production'> = [];

  public constructor(
    private readonly options: {
      notificationType?: string;
      revocationType?: string;
      transactionFailureEnvironments?: Array<'sandbox' | 'production'>;
    } = {},
  ) {}

  public create(environment: 'sandbox' | 'production') {
    this.environments.push(environment);
    return {
      verifyAndDecodeTransaction: async (_signedTransaction: string) => {
        if (this.options.transactionFailureEnvironments?.includes(environment) === true) {
          throw new Error('signature environment mismatch');
        }
        return this.transaction();
      },
      verifyAndDecodeNotification: async (_signedPayload: string) => ({
        notificationType: this.options.notificationType ?? 'DID_RENEW',
        notificationUUID: 'notification-1',
        signedDate: Date.parse('2026-07-25T00:00:00.000Z'),
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
      signedDate: Date.parse('2026-07-25T00:00:00.000Z'),
      revocationType: this.options.revocationType,
    };
  }
}
