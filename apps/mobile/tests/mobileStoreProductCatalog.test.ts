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
      }),
      expect.objectContaining({
        id: 'apple.credits.200',
        kind: 'credit_pack',
      }),
    ]);
  });

  it('サブスク商品説明は据置価格に対応する月次100/350クレジットを表示する', () => {
    expect(
      toNativeStoreProductDefinitions({
        products: [
          { credit_package_code: null, kind: 'subscription', plan_code: 'standard', product_id: 'apple.standard' },
          { credit_package_code: null, kind: 'subscription', plan_code: 'premium', product_id: 'apple.premium' },
        ],
        store: 'apple',
      }, 'ja'),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'apple.standard', description: '毎月100クレジット' }),
      expect.objectContaining({ id: 'apple.premium', description: '毎月350クレジット' }),
    ]));
    expect(
      toNativeStoreProductDefinitions({
        products: [
          { credit_package_code: null, kind: 'subscription', plan_code: 'standard', product_id: 'google.standard' },
          { credit_package_code: null, kind: 'subscription', plan_code: 'premium', product_id: 'google.premium' },
        ],
        store: 'google',
      }, 'en'),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'google.standard', description: '100 credits each month' }),
      expect.objectContaining({ id: 'google.premium', description: '350 credits each month' }),
    ]));
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
