import { describe, expect, it, vi } from 'vitest';
import {
  NativeStoreBillingError,
  createNativeStoreBillingAdapter,
  type NativeStoreBillingSdk,
  type NativeStorePurchase,
} from '../src/lib/nativeStoreBilling';

const verifiedState = {
  balance: { monthlyCredits: 100, purchasedCredits: 200 },
  entitlement: { plan: 'standard' as const },
};

const products = [
  { id: 'lyra.credits.200', kind: 'credit_pack' as const, title: '200 credits' },
  { id: 'lyra.standard.monthly', kind: 'subscription' as const, title: 'Standard' },
];

interface SdkHarness {
  emitError(error: { code: string }): void;
  emitPurchase(purchase: NativeStorePurchase): Promise<void>;
  finishTransaction: ReturnType<typeof vi.fn>;
  sdk: NativeStoreBillingSdk;
}

function createSdkHarness(): SdkHarness {
  let onPurchase: ((purchase: NativeStorePurchase) => void | Promise<void>) | undefined;
  let onError: ((error: { code: string }) => void) | undefined;
  const finishTransaction = vi.fn().mockResolvedValue(undefined);
  const sdk: NativeStoreBillingSdk = {
    endConnection: vi.fn().mockResolvedValue(undefined),
    fetchProducts: vi.fn().mockResolvedValue([
      { displayPrice: '$2.99', id: 'lyra.credits.200', title: '200 credits', type: 'in-app' },
      {
        displayPrice: '$4.99',
        id: 'lyra.standard.monthly',
        subscriptionOffers: [{ offerToken: 'base-plan-offer', sku: 'lyra.standard.monthly' }],
        title: 'Standard',
        type: 'subs',
      },
    ]),
    finishTransaction,
    getAvailablePurchases: vi.fn().mockResolvedValue([]),
    initConnection: vi.fn().mockResolvedValue(true),
    purchaseErrorListener: vi.fn((listener) => {
      onError = listener;
      return { remove: vi.fn() };
    }),
    purchaseUpdatedListener: vi.fn((listener) => {
      onPurchase = listener;
      return { remove: vi.fn() };
    }),
    requestPurchase: vi.fn().mockResolvedValue(undefined),
    restorePurchases: vi.fn().mockResolvedValue(undefined),
  };
  return {
    emitError: (error) => onError?.(error),
    emitPurchase: async (purchase) => {
      await onPurchase?.(purchase);
    },
    finishTransaction,
    sdk,
  };
}

function createBackend(): Parameters<typeof createNativeStoreBillingAdapter>[0]['backend'] {
  return {
    getAccountBinding: vi.fn().mockResolvedValue({
      appleAppAccountToken: '3d813cbb-47fb-4d4a-8c9a-00f018076a2a',
      googleObfuscatedAccountId: 'a'.repeat(43),
      subscriptionPurchaseAllowed: true,
    }),
    restorePurchases: vi.fn().mockResolvedValue(verifiedState),
    verifyApplePurchase: vi.fn().mockResolvedValue(verifiedState),
    verifyGooglePurchase: vi.fn().mockResolvedValue(verifiedState),
  };
}

describe('native store billing adapter', () => {
  it('Google購入をserver検証してからだけ消費transactionをfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.purchase('lyra.credits.200');
    expect(harness.finishTransaction).not.toHaveBeenCalled();
    await harness.emitPurchase({
      id: 'google-transaction-1',
      productId: 'lyra.credits.200',
      purchaseState: 'purchased',
      purchaseToken: 'google-purchase-token',
      store: 'google',
    });

    expect(backend.verifyGooglePurchase).toHaveBeenCalledWith({
      purchaseToken: 'google-purchase-token',
    });
    expect(harness.finishTransaction).toHaveBeenCalledWith(expect.objectContaining({
      isConsumable: true,
    }));
  });

  it('Apple subscriptionはserver確認後だけ非消費transactionとしてfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();
    await adapter.purchase('lyra.standard.monthly');

    expect(harness.sdk.requestPurchase).toHaveBeenCalledWith({
      request: {
        apple: expect.objectContaining({ sku: 'lyra.standard.monthly' }),
        google: expect.objectContaining({
          skus: ['lyra.standard.monthly'],
          subscriptionOffers: [{
            offerToken: 'base-plan-offer',
            sku: 'lyra.standard.monthly',
          }],
        }),
      },
      type: 'subs',
    });

    await harness.emitPurchase({
      environmentIOS: 'sandbox',
      id: 'apple-transaction-1',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-apple-transaction',
      store: 'apple',
    });

    expect(backend.verifyApplePurchase).toHaveBeenCalledWith({
      environment: 'sandbox',
      signedTransaction: 'signed-apple-transaction',
    });
    expect(harness.finishTransaction).toHaveBeenCalledWith(expect.objectContaining({
      isConsumable: false,
    }));
  });

  it('検証応答が不正ならfinishせず安全な検証失敗にする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    backend.verifyApplePurchase = vi.fn().mockResolvedValue({
      balance: { monthlyCredits: Number.NaN, purchasedCredits: 0 },
      entitlement: { plan: 'standard' },
    });
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await harness.emitPurchase({
      environmentIOS: 'production',
      id: 'apple-invalid',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-transaction',
      store: 'apple',
    });

    expect(harness.finishTransaction).not.toHaveBeenCalled();
    expect(adapter.getState().error).toMatchObject({ code: 'VERIFICATION_FAILED' });
  });

  it('pendingはserver送信もfinishもせず保留として扱う', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await harness.emitPurchase({
      id: 'pending-1',
      productId: 'lyra.standard.monthly',
      purchaseState: 'pending',
      purchaseToken: 'pending-token',
      store: 'google',
    });

    expect(backend.verifyGooglePurchase).not.toHaveBeenCalled();
    expect(harness.finishTransaction).not.toHaveBeenCalled();
    expect(adapter.getState().error).toMatchObject({ code: 'PURCHASE_PENDING' });
  });

  it('同じpurchase eventを再送されても検証とfinishを一度だけ行う', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    const replay: NativeStorePurchase = {
      environmentIOS: 'production',
      id: 'apple-replay',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-replay',
      store: 'apple',
    };
    await adapter.connect();
    await harness.emitPurchase(replay);
    await harness.emitPurchase(replay);

    expect(backend.verifyApplePurchase).toHaveBeenCalledTimes(1);
    expect(harness.finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('復元proofをまとめてserver検証してから対応transactionだけfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    harness.sdk.getAvailablePurchases = vi.fn().mockResolvedValue([
      {
        environmentIOS: 'production',
        id: 'apple-restore',
        productId: 'lyra.standard.monthly',
        purchaseState: 'purchased',
        purchaseToken: 'signed-restored-transaction',
        store: 'apple',
      },
      {
        id: 'unknown-product',
        productId: 'not-configured',
        purchaseState: 'purchased',
        purchaseToken: 'must-not-send',
        store: 'google',
      },
    ]);
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.restore();

    expect(backend.restorePurchases).toHaveBeenCalledWith({
      appleSignedTransactions: ['signed-restored-transaction'],
      googlePurchaseTokens: [],
    });
    expect(harness.finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('cancel・already-owned・network errorをraw detailなしの安定codeへ変換する', async () => {
    const harness = createSdkHarness();
    const adapter = createNativeStoreBillingAdapter({
      backend: createBackend(),
      products,
      sdk: harness.sdk,
    });
    await adapter.connect();

    harness.emitError({ code: 'user-cancelled' });
    expect(adapter.getState().error).toMatchObject({ code: 'PURCHASE_CANCELLED' });
    harness.emitError({ code: 'already-owned' });
    expect(adapter.getState().error).toMatchObject({ code: 'ALREADY_OWNED' });
    harness.emitError({ code: 'network-error' });
    expect(adapter.getState().error).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(adapter.getState().error?.message).toBe('NETWORK');
  });

  it('接続失敗後に明示再試行できdisconnectでlistenerを解放する', async () => {
    const harness = createSdkHarness();
    const removePurchase = vi.fn();
    const removeError = vi.fn();
    harness.sdk.purchaseUpdatedListener = vi.fn(() => ({ remove: removePurchase }));
    harness.sdk.purchaseErrorListener = vi.fn(() => ({ remove: removeError }));
    harness.sdk.initConnection = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider secret'))
      .mockResolvedValueOnce(true);
    const adapter = createNativeStoreBillingAdapter({
      backend: createBackend(),
      products,
      sdk: harness.sdk,
    });

    await expect(adapter.connect()).rejects.toBeInstanceOf(NativeStoreBillingError);
    await expect(adapter.connect()).resolves.toBeUndefined();
    await adapter.disconnect();

    expect(adapter.getState().connected).toBe(false);
    expect(removePurchase).toHaveBeenCalled();
    expect(removeError).toHaveBeenCalled();
    });
  });

  it('復元でtransaction IDが異なっても同じproofは一度だけ検証してfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    harness.sdk.getAvailablePurchases = vi.fn().mockResolvedValue([
      {
        id: 'google-restore-original',
        productId: 'lyra.standard.monthly',
        purchaseState: 'purchased',
        purchaseToken: 'same-google-purchase-token',
        store: 'google',
      },
      {
        id: 'google-restore-replayed',
        productId: 'lyra.standard.monthly',
        purchaseState: 'purchased',
        purchaseToken: 'same-google-purchase-token',
        store: 'google',
      },
    ]);
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.restore();

    expect(backend.restorePurchases).toHaveBeenCalledWith({
      appleSignedTransactions: [],
      googlePurchaseTokens: ['same-google-purchase-token'],
    });
    expect(harness.finishTransaction).toHaveBeenCalledTimes(1);
  });
