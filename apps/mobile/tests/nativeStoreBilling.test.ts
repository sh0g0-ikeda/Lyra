import { describe, expect, it, vi } from 'vitest';

import {
  NativeStoreBillingError,
  createNativeStoreBillingAdapter,
  type NativeStoreBillingSdk,
  type NativeStorePurchase,
} from '@/lib/nativeStoreBilling';

vi.mock('expo-iap', () => ({
  endConnection: vi.fn(),
  fetchProducts: vi.fn(),
  finishTransaction: vi.fn(),
  getAvailablePurchases: vi.fn(),
  getStorefront: vi.fn(),
  initConnection: vi.fn(),
  purchaseErrorListener: vi.fn(),
  purchaseUpdatedListener: vi.fn(),
  requestPurchase: vi.fn(),
  restorePurchases: vi.fn()
}));

const serverState = {
  balance: { monthlyCredits: 100, purchasedCredits: 200 },
  entitlement: { plan: 'standard' as const }
};

const products = [
  { id: 'lyra.credits.200', kind: 'credit_pack' as const, title: '200 credits' },
  { id: 'lyra.standard.monthly', kind: 'subscription' as const, title: 'Standard' }
];

interface SdkHarness {
  sdk: NativeStoreBillingSdk;
  emitPurchase: (purchase: NativeStorePurchase) => Promise<void>;
  emitError: (error: { code: string }) => void;
  finishTransaction: ReturnType<typeof vi.fn>;
  requestPurchase: ReturnType<typeof vi.fn>;
  restorePurchases: ReturnType<typeof vi.fn>;
}

function createSdkHarness(): SdkHarness {
  let onPurchase: ((purchase: NativeStorePurchase) => void | Promise<void>) | undefined;
  let onError: ((error: { code: string }) => void) | undefined;
  const finishTransaction = vi.fn().mockResolvedValue(undefined);
  const requestPurchase = vi.fn().mockResolvedValue(null);
  const restorePurchases = vi.fn().mockResolvedValue(undefined);
  const sdk: NativeStoreBillingSdk = {
    endConnection: vi.fn().mockResolvedValue(undefined),
    fetchProducts: vi.fn().mockResolvedValue([
      { id: 'lyra.credits.200', title: '200 credits', displayPrice: '$2.99', type: 'in-app' },
      { id: 'lyra.standard.monthly', title: 'Standard', displayPrice: '$4.99', type: 'subs' }
    ]),
    finishTransaction,
    getAvailablePurchases: vi.fn().mockResolvedValue([]),
    getStorefront: vi.fn().mockResolvedValue('JPN'),
    initConnection: vi.fn().mockResolvedValue(true),
    purchaseErrorListener: vi.fn((listener) => {
      onError = listener;
      return { remove: vi.fn() };
    }),
    purchaseUpdatedListener: vi.fn((listener) => {
      onPurchase = listener;
      return { remove: vi.fn() };
    }),
    requestPurchase,
    restorePurchases
  };
  return {
    sdk,
    emitPurchase: async (purchase) => {
      await onPurchase?.(purchase);
    },
    emitError: (error) => onError?.(error),
    finishTransaction,
    requestPurchase,
    restorePurchases
  };
}

function createBackend(): Parameters<typeof createNativeStoreBillingAdapter>[0]['backend'] {
  return {
    getAccountBinding: vi.fn().mockResolvedValue({
      appleAppAccountToken: 'apple-account-token',
      googleObfuscatedAccountId: 'google-account-token',
      subscriptionPurchaseAllowed: true
    }),
    restorePurchases: vi.fn().mockResolvedValue(serverState),
    verifyApplePurchase: vi.fn().mockResolvedValue(serverState),
    verifyGooglePurchase: vi.fn().mockResolvedValue(serverState)
  };
}

describe('native store billing adapter', () => {
  it('商品取得を順番に実行してStoreKit診断結果を安全に保持する', async () => {
    const harness = createSdkHarness();
    let resolveInApp: ((products: readonly {
      id: string;
      title: string;
      displayPrice: string;
      type: 'in-app';
    }[]) => void) | undefined;
    harness.sdk.fetchProducts = vi.fn(({ type }) => {
      if (type === 'in-app') {
        return new Promise((resolve) => {
          resolveInApp = resolve;
        });
      }
      return Promise.resolve([
        { id: 'lyra.standard.monthly', title: 'Standard', displayPrice: '$4.99', type: 'subs' }
      ]);
    });
    const adapter = createNativeStoreBillingAdapter({
      backend: createBackend(),
      products,
      sdk: harness.sdk
    });

    const connecting = adapter.connect();
    await vi.waitFor(() => {
      expect(harness.sdk.fetchProducts).toHaveBeenCalledTimes(1);
    });
    expect(harness.sdk.fetchProducts).toHaveBeenNthCalledWith(1, {
      skus: ['lyra.credits.200'],
      type: 'in-app'
    });

    resolveInApp?.([
      { id: 'lyra.credits.200', title: '200 credits', displayPrice: '$2.99', type: 'in-app' }
    ]);
    await connecting;

    expect(harness.sdk.fetchProducts).toHaveBeenNthCalledWith(2, {
      skus: ['lyra.standard.monthly'],
      type: 'subs'
    });
    expect(adapter.getState().diagnostics).toEqual({
      allProducts: null,
      connected: true,
      inApp: {
        errorCode: null,
        requestedProductIds: ['lyra.credits.200'],
        returnedProductIds: ['lyra.credits.200']
      },
      storefront: 'JPN',
      storefrontErrorCode: null,
      subscriptions: {
        errorCode: null,
        requestedProductIds: ['lyra.standard.monthly'],
        returnedProductIds: ['lyra.standard.monthly']
      }
    });
  });

  it('種別別照会が空の場合に全商品照会で購入可能な商品を復元する', async () => {
    const harness = createSdkHarness();
    harness.sdk.fetchProducts = vi.fn(({ type }) => {
      if (type !== 'all') {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        { id: 'lyra.credits.200', title: '200 credits', displayPrice: '$2.99', type: 'in-app' },
        { id: 'lyra.standard.monthly', title: 'Standard', displayPrice: '$4.99', type: 'subs' }
      ]);
    });
    const adapter = createNativeStoreBillingAdapter({
      backend: createBackend(),
      products,
      sdk: harness.sdk
    });

    await adapter.connect();

    expect(harness.sdk.fetchProducts).toHaveBeenNthCalledWith(3, {
      skus: ['lyra.credits.200', 'lyra.standard.monthly'],
      type: 'all'
    });
    expect(adapter.getState().products).toEqual([
      expect.objectContaining({ available: true, id: 'lyra.credits.200' }),
      expect.objectContaining({ available: true, id: 'lyra.standard.monthly' })
    ]);
    expect(adapter.getState().diagnostics?.allProducts).toEqual({
      errorCode: null,
      requestedProductIds: ['lyra.credits.200', 'lyra.standard.monthly'],
      returnedProductIds: ['lyra.credits.200', 'lyra.standard.monthly']
    });
  });

  it('購入完了をサーバー検証してからだけ消費型取引をfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.purchase('lyra.credits.200');
    expect(harness.requestPurchase).toHaveBeenCalledWith({
      request: {
        apple: { appAccountToken: 'apple-account-token', sku: 'lyra.credits.200' },
        google: { obfuscatedAccountId: 'google-account-token', skus: ['lyra.credits.200'] }
      },
      type: 'in-app'
    });
    expect(harness.finishTransaction).not.toHaveBeenCalled();

    await harness.emitPurchase({
      id: 'google-transaction-1',
      productId: 'lyra.credits.200',
      purchaseState: 'purchased',
      purchaseToken: 'google-purchase-token',
      store: 'google'
    });

    expect(backend.verifyGooglePurchase).toHaveBeenCalledWith({ purchaseToken: 'google-purchase-token' });
    expect(harness.finishTransaction).toHaveBeenCalledWith({
      isConsumable: true,
      purchase: expect.objectContaining({ id: 'google-transaction-1' })
    });
    expect(adapter.getState().lastVerified).toEqual(serverState);
  });

  it('サーバー状態が返らない場合は取引をfinishせず検証失敗にする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    backend.verifyApplePurchase = vi.fn().mockResolvedValue({
      balance: null,
      entitlement: null
    });
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    const failures: NativeStoreBillingError[] = [];
    adapter.subscribe((state) => {
      if (state.error !== null) failures.push(state.error);
    });
    await adapter.connect();

    await harness.emitPurchase({
      id: 'apple-transaction-1',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-apple-transaction',
      store: 'apple',
      environmentIOS: 'production'
    });

    expect(harness.finishTransaction).not.toHaveBeenCalled();
    expect(failures.at(-1)).toMatchObject({ code: 'VERIFICATION_FAILED', retryable: true });
  });

  it('pending purchaseはサーバー送信もfinishもせず保留状態として知らせる', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await harness.emitPurchase({
      id: 'pending-1',
      productId: 'lyra.standard.monthly',
      purchaseState: 'pending',
      purchaseToken: 'pending-token',
      store: 'google'
    });

    expect(backend.verifyGooglePurchase).not.toHaveBeenCalled();
    expect(harness.finishTransaction).not.toHaveBeenCalled();
    expect(adapter.getState().error).toMatchObject({ code: 'PURCHASE_PENDING', retryable: false });
  });

  it('同じイベントを再送されてもサーバー検証とfinishを一度だけ行う', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();
    const replay = {
      id: 'apple-transaction-replay',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased' as const,
      purchaseToken: 'signed-transaction-replay',
      store: 'apple' as const,
      environmentIOS: 'production' as const
    };

    await harness.emitPurchase(replay);
    await harness.emitPurchase(replay);

    expect(backend.verifyApplePurchase).toHaveBeenCalledTimes(1);
    expect(harness.finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('subscriptionはserver確認後に非消費型transactionとしてfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.purchase('lyra.standard.monthly');
    expect(harness.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({ type: 'subs' }));
    await harness.emitPurchase({
      environmentIOS: 'production',
      id: 'apple-subscription-1',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-subscription-transaction',
      store: 'apple'
    });

    expect(backend.verifyApplePurchase).toHaveBeenCalledWith({
      environment: 'production',
      signedTransaction: 'signed-subscription-transaction'
    });
    expect(harness.finishTransaction).toHaveBeenCalledWith(expect.objectContaining({ isConsumable: false }));
  });

  it('復元ではnative復元後にproofを一括検証し、確認済みの取引だけfinishする', async () => {
    const harness = createSdkHarness();
    const backend = createBackend();
    harness.sdk.getAvailablePurchases = vi.fn().mockResolvedValue([
      {
        id: 'apple-restore',
        productId: 'lyra.standard.monthly',
        purchaseState: 'purchased',
        purchaseToken: 'signed-restored-transaction',
        store: 'apple'
      },
      {
        id: 'google-restore',
        productId: 'lyra.credits.200',
        purchaseState: 'purchased',
        purchaseToken: 'restored-google-token',
        store: 'google'
      }
    ]);
    const adapter = createNativeStoreBillingAdapter({ backend, products, sdk: harness.sdk });
    await adapter.connect();

    const result = await adapter.restore();

    expect(harness.restorePurchases).toHaveBeenCalledTimes(1);
    expect(backend.restorePurchases).toHaveBeenCalledWith({
      appleSignedTransactions: ['signed-restored-transaction'],
      googlePurchaseTokens: ['restored-google-token']
    });
    expect(harness.finishTransaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual([serverState]);
  });

  it('cancelled/already-owned/network provider errorsを安定した安全なcodeへ正規化する', async () => {
    const harness = createSdkHarness();
    const adapter = createNativeStoreBillingAdapter({ backend: createBackend(), products, sdk: harness.sdk });
    await adapter.connect();

    harness.emitError({ code: 'user-cancelled' });
    expect(adapter.getState().error).toMatchObject({ code: 'PURCHASE_CANCELLED', retryable: false });
    harness.emitError({ code: 'already-owned' });
    expect(adapter.getState().error).toMatchObject({ code: 'ALREADY_OWNED', retryable: false });
    harness.emitError({ code: 'network-error' });
    expect(adapter.getState().error).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('disconnect時にlistenerとnative connectionを解放する', async () => {
    const harness = createSdkHarness();
    const adapter = createNativeStoreBillingAdapter({ backend: createBackend(), products, sdk: harness.sdk });
    await adapter.connect();

    await adapter.disconnect();

    expect(harness.sdk.endConnection).toHaveBeenCalledTimes(1);
    expect(adapter.getState().connected).toBe(false);
  });
});
