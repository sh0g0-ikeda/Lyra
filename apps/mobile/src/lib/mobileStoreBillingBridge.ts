import type {
  CurrentSession,
  LyraMobileApiClient,
  MobileStoreProductCatalogRecord,
} from './api';
import { t, type UiLanguage } from './i18n';
import {
  NativeStoreBillingError,
  type NativeStoreBillingBackend,
  type NativeStoreBillingProductDefinition,
  type NativeStoreServerEntitlement,
  type NativeStoreServerState,
} from './nativeStoreBilling';

type MobileStoreBillingApi = Pick<
  LyraMobileApiClient,
  | 'getCurrentSession'
  | 'getMobilePurchaseBinding'
  | 'restoreMobilePurchases'
  | 'verifyAppleMobilePurchase'
  | 'verifyGoogleMobilePurchase'
>;

export function toNativeStoreProductDefinitions(
  catalog: MobileStoreProductCatalogRecord,
  language: UiLanguage,
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
      return {
        description: t(
          language,
          product.plan_code === 'standard'
            ? 'purchaseStandardDescription'
            : 'purchasePremiumDescription',
        ),
        id: product.product_id,
        kind: product.kind,
        title: t(
          language,
          product.plan_code === 'standard'
            ? 'purchaseStandardTitle'
            : 'purchasePremiumTitle',
        ),
      };
    }
    if (product.credit_package_code === null || product.plan_code !== null) {
      throw new NativeStoreBillingError('PRODUCT_UNAVAILABLE', false);
    }
    const titleKey = product.credit_package_code === 'credits_200'
      ? 'purchaseCredits200Title'
      : product.credit_package_code === 'credits_1000'
        ? 'purchaseCredits1000Title'
        : 'purchaseCredits3000Title';
    return {
      id: product.product_id,
      kind: product.kind,
      title: t(language, titleKey),
    };
  });
}

export function createMobileStoreBillingBackend(
  api: MobileStoreBillingApi,
): NativeStoreBillingBackend {
  const loadAuthoritativeState = async (): Promise<NativeStoreServerState> =>
    toServerState(await api.getCurrentSession());

  return {
    getAccountBinding: async () => {
      const binding = await api.getMobilePurchaseBinding();
      return {
        appleAppAccountToken: binding.apple_app_account_token,
        googleObfuscatedAccountId: binding.google_obfuscated_account_id,
        subscriptionPurchaseAllowed: binding.subscription_purchase_allowed,
      };
    },
    restorePurchases: async ({ appleSignedTransactions, googlePurchaseTokens }) => {
      await api.restoreMobilePurchases({
        apple_signed_transactions: appleSignedTransactions,
        google_purchase_tokens: googlePurchaseTokens,
      });
      return loadAuthoritativeState();
    },
    verifyApplePurchase: async ({ environment, signedTransaction }) => {
      await api.verifyAppleMobilePurchase({
        environment,
        signed_transaction: signedTransaction,
      });
      return loadAuthoritativeState();
    },
    verifyGooglePurchase: async ({ purchaseToken }) => {
      await api.verifyGoogleMobilePurchase({ purchase_token: purchaseToken });
      return loadAuthoritativeState();
    },
  };
}

function toServerState(session: CurrentSession): NativeStoreServerState {
  const balance = session.personal_credits;
  if (balance === null) {
    throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
  }
  return {
    balance: {
      monthlyCredits: balance.monthly_credits,
      purchasedCredits: balance.purchased_credits,
    },
    entitlement: { plan: personalPlan(session.user.plan_code) },
  };
}

function personalPlan(value: string): NativeStoreServerEntitlement['plan'] {
  if (value === 'free' || value === 'standard' || value === 'premium') return value;
  throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
}
