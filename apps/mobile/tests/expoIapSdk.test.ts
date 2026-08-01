import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpoIapSdk } from '../src/lib/expoIapSdk';

const expoIap = vi.hoisted(() => ({
  endConnection: vi.fn(),
  fetchProducts: vi.fn(),
  finishTransaction: vi.fn(),
  getAvailablePurchases: vi.fn(),
  initConnection: vi.fn(),
  purchaseErrorListener: vi.fn(),
  purchaseUpdatedListener: vi.fn(),
  requestPurchase: vi.fn(),
  restorePurchases: vi.fn(),
}));

vi.mock('expo-iap', () => expoIap);

describe('Expo IAP SDK bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Android subscriptionのoffer tokenを購入request用の形へ変換する', async () => {
    expoIap.fetchProducts.mockResolvedValueOnce([{
      description: 'Standard plan',
      displayPrice: '¥980',
      id: 'lyra.standard.monthly',
      platform: 'android',
      subscriptionOfferDetailsAndroid: [{
        basePlanId: 'standard-monthly',
        offerToken: 'play-offer-token',
        pricingPhases: { pricingPhaseList: [] },
      }],
      title: 'Standard',
      type: 'subs',
    }]);

    await expect(createExpoIapSdk().fetchProducts({
      skus: ['lyra.standard.monthly'],
      type: 'subs',
    })).resolves.toEqual([expect.objectContaining({
      id: 'lyra.standard.monthly',
      subscriptionOffers: [{
        offerToken: 'play-offer-token',
        sku: 'lyra.standard.monthly',
      }],
    })]);
  });

  it('Apple subscriptionにはAndroid専用offer tokenを付けない', async () => {
    expoIap.fetchProducts.mockResolvedValueOnce([{
      description: 'Standard plan',
      displayPrice: '¥980',
      id: 'lyra.standard.monthly',
      platform: 'ios',
      title: 'Standard',
      type: 'subs',
    }]);

    await expect(createExpoIapSdk().fetchProducts({
      skus: ['lyra.standard.monthly'],
      type: 'subs',
    })).resolves.toEqual([expect.objectContaining({
      id: 'lyra.standard.monthly',
      subscriptionOffers: undefined,
    })]);
  });

  it('StoreKitのSandbox環境値をserver契約の小文字へ正規化する', () => {
    let emitPurchase: ((purchase: {
      environmentIOS: string;
      id: string;
      productId: string;
      purchaseState: 'purchased';
      purchaseToken: string;
      store: 'apple';
    }) => void) | undefined;
    expoIap.purchaseUpdatedListener.mockImplementationOnce((listener) => {
      emitPurchase = listener;
      return { remove: vi.fn() };
    });
    const listener = vi.fn();
    createExpoIapSdk().purchaseUpdatedListener(listener);

    emitPurchase?.({
      environmentIOS: 'Sandbox',
      id: 'apple-transaction',
      productId: 'lyra.standard.monthly',
      purchaseState: 'purchased',
      purchaseToken: 'signed-transaction',
      store: 'apple',
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      environmentIOS: 'sandbox',
    }));
  });
});
