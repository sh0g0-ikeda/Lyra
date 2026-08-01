import * as ExpoIap from 'expo-iap';
import type {
  NativeStoreBillingSdk,
  NativeStorePurchase,
} from './nativeStoreBilling';

export function createExpoIapSdk(): NativeStoreBillingSdk {
  return {
    endConnection: async () => {
      await ExpoIap.endConnection();
    },
    fetchProducts: async (input) => {
      const products = await ExpoIap.fetchProducts(input);
      return (products ?? []).map((product) => ({
        description: product.description,
        displayPrice: product.displayPrice,
        id: product.id,
        subscriptionOffers: product.type === 'subs' && product.platform === 'android'
          ? (product.subscriptionOfferDetailsAndroid ?? []).map((offer) => ({
              offerToken: offer.offerToken,
              sku: product.id,
            }))
          : undefined,
        title: product.title,
        type: product.type,
      }));
    },
    finishTransaction: async ({ isConsumable, purchase }) => {
      if (purchase.nativePurchase === undefined) {
        throw new Error('Native purchase is unavailable');
      }
      await ExpoIap.finishTransaction({
        isConsumable,
        purchase: purchase.nativePurchase as ExpoIap.Purchase,
      });
    },
    getAvailablePurchases: async () =>
      (await ExpoIap.getAvailablePurchases()).map(normalizeExpoPurchase),
    initConnection: () => ExpoIap.initConnection(),
    purchaseErrorListener: (listener) =>
      ExpoIap.purchaseErrorListener((error) => listener({ code: error.code ?? 'unknown' })),
    purchaseUpdatedListener: (listener) =>
      ExpoIap.purchaseUpdatedListener((purchase) => listener(normalizeExpoPurchase(purchase))),
    requestPurchase: (input) => ExpoIap.requestPurchase(input),
    restorePurchases: () => ExpoIap.restorePurchases(),
  };
}

function normalizeExpoPurchase(purchase: ExpoIap.Purchase): NativeStorePurchase {
  const normalizedEnvironment = 'environmentIOS' in purchase
    && typeof purchase.environmentIOS === 'string'
    ? purchase.environmentIOS.toLowerCase()
    : null;
  const environmentIOS = normalizedEnvironment === 'sandbox'
    || normalizedEnvironment === 'production'
    ? normalizedEnvironment
    : null;
  return {
    environmentIOS,
    id: purchase.id,
    nativePurchase: purchase,
    productId: purchase.productId,
    purchaseState: purchase.purchaseState,
    purchaseToken: purchase.purchaseToken,
    store: purchase.store === 'apple' || purchase.store === 'google'
      ? purchase.store
      : 'unknown',
  };
}
