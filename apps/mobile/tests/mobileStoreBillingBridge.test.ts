import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, MobileStoreProductCatalogRecord } from '../src/lib/api';
import {
  createMobileStoreBillingBackend,
  toNativeStoreProductDefinitions,
} from '../src/lib/mobileStoreBillingBridge';
import { NativeStoreBillingError } from '../src/lib/nativeStoreBilling';

const session: CurrentSession = {
  organizations: [],
  personal_credits: {
    monthly_credits: 100,
    monthly_expires_at: null,
    purchased_credits: 200,
    total_credits: 300,
  },
  user: {
    display_name: null,
    email: 'user@example.com',
    id: 'user-1',
    plan_code: 'standard',
  },
};

const catalog: MobileStoreProductCatalogRecord = {
  products: [
    {
      credit_package_code: null,
      kind: 'subscription',
      plan_code: 'standard',
      product_id: 'lyra.standard.monthly',
    },
    {
      credit_package_code: 'credits_200',
      kind: 'credit_pack',
      plan_code: null,
      product_id: 'lyra.credits.200',
    },
  ],
  store: 'apple',
};

function createApi() {
  return {
    getCurrentSession: vi.fn().mockResolvedValue(session),
    getMobilePurchaseBinding: vi.fn().mockResolvedValue({
      apple_app_account_token: '3d813cbb-47fb-4d4a-8c9a-00f018076a2a',
      google_obfuscated_account_id: 'a'.repeat(43),
      subscription_purchase_allowed: true,
    }),
    restoreMobilePurchases: vi.fn().mockResolvedValue({ purchases: [] }),
    verifyAppleMobilePurchase: vi.fn().mockResolvedValue({}),
    verifyGoogleMobilePurchase: vi.fn().mockResolvedValue({}),
  };
}

describe('mobile store billing bridge', () => {
  it('server catalogを価格なしのnative商品定義へ変換する', () => {
    expect(toNativeStoreProductDefinitions(catalog, 'ja')).toEqual([
      expect.objectContaining({
        id: 'lyra.standard.monthly',
        kind: 'subscription',
        title: 'Standard',
      }),
      expect.objectContaining({
        id: 'lyra.credits.200',
        kind: 'credit_pack',
        title: '200クレジット',
      }),
    ]);
    expect(JSON.stringify(toNativeStoreProductDefinitions(catalog, 'ja'))).not.toMatch(
      /price|amount|currency|￥|¥|\$/iu,
    );
  });

  it('重複product IDをnative storeへ渡さずfail closedにする', () => {
    const duplicate = {
      ...catalog,
      products: [catalog.products[0]!, catalog.products[0]!],
    };
    expect(() => toNativeStoreProductDefinitions(duplicate, 'ja')).toThrow(
      NativeStoreBillingError,
    );
  });

  it('proof検証後に/api/meの個人残高とplanをauthorityとして返す', async () => {
    const api = createApi();
    const backend = createMobileStoreBillingBackend(api);

    await expect(backend.verifyApplePurchase({
      environment: 'sandbox',
      signedTransaction: 'signed-proof',
    })).resolves.toEqual({
      balance: { monthlyCredits: 100, purchasedCredits: 200 },
      entitlement: { plan: 'standard' },
    });
    expect(api.verifyAppleMobilePurchase).toHaveBeenCalledWith({
      environment: 'sandbox',
      signed_transaction: 'signed-proof',
    });
    expect(api.verifyAppleMobilePurchase.mock.invocationCallOrder[0]).toBeLessThan(
      api.getCurrentSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('個人残高を確認できなければtransaction finish前の検証失敗にする', async () => {
    const api = createApi();
    api.getCurrentSession.mockResolvedValue({ ...session, personal_credits: null });
    const backend = createMobileStoreBillingBackend(api);

    await expect(backend.verifyGooglePurchase({ purchaseToken: 'google-proof' }))
      .rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  });
});
