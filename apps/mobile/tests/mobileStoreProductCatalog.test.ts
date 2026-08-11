import { describe, expect, it, vi } from 'vitest';

import { toNativeStoreProductDefinitions } from '@/lib/mobileStoreBillingBridge';

vi.mock('expo-iap', () => ({}));

describe('mobile store product catalog', () => {
  it('server catalogの現在platform IDだけをnative定義へ変換する', () => {
    expect(
      toNativeStoreProductDefinitions({
        products: [
          {
            credit_package_code: null,
            kind: 'subscription',
            plan_code: 'standard',
            product_id: 'apple.standard',
          },
          {
            credit_package_code: 'credits_200',
            kind: 'credit_pack',
            plan_code: null,
            product_id: 'apple.credits.200',
          },
        ],
        store: 'apple',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'apple.standard',
        kind: 'subscription',
        planCode: 'standard',
      }),
      expect.objectContaining({
        id: 'apple.credits.200',
        kind: 'credit_pack',
      }),
    ]);
  });

  it('重複または論理コードのないcatalogを購入定義にしない', () => {
    expect(() =>
      toNativeStoreProductDefinitions({
        products: [
          {
            credit_package_code: null,
            kind: 'subscription',
            plan_code: null,
            product_id: 'invalid',
          },
        ],
        store: 'google',
      }),
    ).toThrow();
  });
});
