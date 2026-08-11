import { describe, expect, it, vi } from 'vitest';

import { createMobileStoreBillingBackend } from '@/lib/mobileStoreBillingBridge';

vi.mock('expo-iap', () => ({}));

const balance = {
  monthly_credits: 50,
  purchased_credits: 10,
  total_credits: 60,
  monthly_expires_at: null,
  plan_code: 'standard' as const,
  current_period_end: '2026-08-01T00:00:00.000Z',
  cancel_at_period_end: false,
  subscription_store: 'apple' as const,
  scheduled_plan_code: 'premium' as const,
  scheduled_plan_effective_at: '2026-08-01T00:00:00.000Z',
  subscription_plans: []
};

const session = {
  user: { id: 'user-1', email: 'user@example.test', display_name: null, plan_code: 'standard' },
  personal_credits: {
    monthly_credits: 50,
    purchased_credits: 10,
    total_credits: 60,
    monthly_expires_at: null
  },
  organizations: []
};

const createApi = () => ({
  getBalance: vi.fn().mockResolvedValue(balance),
  getCurrentSession: vi.fn().mockResolvedValue(session),
  getMobilePurchaseBinding: vi.fn().mockResolvedValue({
    apple_app_account_token: '11111111-1111-4111-8111-111111111111',
    google_obfuscated_account_id: 'binding-hash',
    subscription_purchase_allowed: true
  }),
  restoreMobilePurchases: vi.fn().mockResolvedValue({ purchases: [] }),
  verifyAppleMobilePurchase: vi.fn().mockResolvedValue({}),
  verifyGoogleMobilePurchase: vi.fn().mockResolvedValue({})
});

describe('mobile store billing backend bridge', () => {
  it('bindingをnative SDK用の名前へ変換する', async () => {
    const api = createApi();
    const backend = createMobileStoreBillingBackend(api);

    await expect(backend.getAccountBinding()).resolves.toEqual({
      appleAppAccountToken: '11111111-1111-4111-8111-111111111111',
      googleObfuscatedAccountId: 'binding-hash',
      subscriptionPurchaseAllowed: true
    });
  });

  it('Google購入を検証した後だけ最新の個人残高とplanを返す', async () => {
    const api = createApi();
    const backend = createMobileStoreBillingBackend(api);

    await expect(
      backend.verifyGooglePurchase({ purchaseToken: 'google-purchase-token' })
    ).resolves.toEqual({
      balance: { monthlyCredits: 50, purchasedCredits: 10 },
      entitlement: {
        plan: 'standard',
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        scheduledPlan: 'premium',
        scheduledPlanEffectiveAt: '2026-08-01T00:00:00.000Z',
        store: 'apple'
      }
    });
    expect(api.verifyGoogleMobilePurchase).toHaveBeenCalledWith({
      purchase_token: 'google-purchase-token'
    });
    expect(api.getBalance).toHaveBeenCalledOnce();
    expect(api.getCurrentSession).toHaveBeenCalledOnce();
  });

  it('復元証跡をBackendへ渡してから最新状態を返す', async () => {
    const api = createApi();
    const backend = createMobileStoreBillingBackend(api);

    await backend.restorePurchases({
      appleSignedTransactions: ['apple-proof'],
      googlePurchaseTokens: ['google-proof']
    });

    expect(api.restoreMobilePurchases).toHaveBeenCalledWith({
      apple_signed_transactions: ['apple-proof'],
      google_purchase_tokens: ['google-proof']
    });
    expect(api.getBalance).toHaveBeenCalledOnce();
  });
});
