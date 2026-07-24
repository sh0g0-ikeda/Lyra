import type { LyraMobileApiClient } from '@/lib/api';
import type { MobileStoreProductCatalogRecord } from '@/domain/types';
import { t } from '@/lib/i18n';
import {
  NativeStoreBillingError,
  type NativeStoreBillingBackend,
  type NativeStoreBillingProductDefinition,
  type NativeStoreServerEntitlement,
  type NativeStoreServerState
} from '@/lib/nativeStoreBilling';

type MobileStoreBillingApi = Pick<
  LyraMobileApiClient,
  | 'getBalance'
  | 'getCurrentSession'
  | 'getMobilePurchaseBinding'
  | 'restoreMobilePurchases'
  | 'verifyAppleMobilePurchase'
  | 'verifyGoogleMobilePurchase'
>;

export function toNativeStoreProductDefinitions(
  catalog: MobileStoreProductCatalogRecord,
  language: 'ja' | 'en' = 'ja'
): readonly NativeStoreBillingProductDefinition[] {
  const productIds = new Set<string>();
  return catalog.products.map((product) => {
    if (productIds.has(product.product_id)) {
      throw new NativeStoreBillingError('PRODUCT_UNAVAILABLE', false);
    }
    productIds.add(product.product_id);

    if (product.kind === 'subscription') {
      if (product.plan_code === null || product.credit_package_code !== null) {
        throw new NativeStoreBillingError('PRODUCT_UNAVAILABLE', false);
      }
      const label = subscriptionLabels[product.plan_code];
      return {
        id: product.product_id,
        kind: product.kind,
        title: t(language, label.title),
        description: t(language, label.description)
      };
    }

    if (product.credit_package_code === null || product.plan_code !== null) {
      throw new NativeStoreBillingError('PRODUCT_UNAVAILABLE', false);
    }
    const label = creditPackLabels[product.credit_package_code];
    return {
      id: product.product_id,
      kind: product.kind,
      title: t(language, label)
    };
  });
}

const subscriptionLabels = {
  standard: {
    title: 'shared.storeProduct.standard.title',
    description: 'shared.storeProduct.standard.description'
  },
  premium: {
    title: 'shared.storeProduct.premium.title',
    description: 'shared.storeProduct.premium.description'
  }
} as const;

const creditPackLabels = {
  credits_200: 'shared.storeProduct.credits200.title',
  credits_1000: 'shared.storeProduct.credits1000.title',
  credits_3000: 'shared.storeProduct.credits3000.title'
} as const;

export function createMobileStoreBillingBackend(
  api: MobileStoreBillingApi
): NativeStoreBillingBackend {
  const loadAuthoritativeState = async (): Promise<NativeStoreServerState> => {
    const [balance, session] = await Promise.all([
      api.getBalance(),
      api.getCurrentSession()
    ]);
    if (session.user.id.trim().length === 0) {
      throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
    }
    return {
      balance: {
        monthlyCredits: balance.monthly_credits,
        purchasedCredits: balance.purchased_credits
      },
      entitlement: {
        plan: personalPlan(balance.plan_code)
      }
    };
  };

  return {
    getAccountBinding: async () => {
      const binding = await api.getMobilePurchaseBinding();
      return {
        appleAppAccountToken: binding.apple_app_account_token,
        googleObfuscatedAccountId: binding.google_obfuscated_account_id,
        subscriptionPurchaseAllowed: binding.subscription_purchase_allowed
      };
    },
    verifyApplePurchase: async ({ signedTransaction, environment }) => {
      await api.verifyAppleMobilePurchase({
        signed_transaction: signedTransaction,
        environment
      });
      return loadAuthoritativeState();
    },
    verifyGooglePurchase: async ({ purchaseToken }) => {
      await api.verifyGoogleMobilePurchase({
        purchase_token: purchaseToken
      });
      return loadAuthoritativeState();
    },
    restorePurchases: async ({ appleSignedTransactions, googlePurchaseTokens }) => {
      await api.restoreMobilePurchases({
        apple_signed_transactions: appleSignedTransactions,
        google_purchase_tokens: googlePurchaseTokens
      });
      return loadAuthoritativeState();
    }
  };
}

function personalPlan(plan: string): NativeStoreServerEntitlement['plan'] {
  if (plan === 'free' || plan === 'standard' || plan === 'premium') {
    return plan;
  }
  throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
}
