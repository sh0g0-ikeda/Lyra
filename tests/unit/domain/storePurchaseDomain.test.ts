import { describe, expect, it } from 'vitest';
import {
  createGooglePlayObfuscatedAccountId,
  createStoreIdentifierKey,
  createStoreProductCatalog,
  transitionStorePurchaseState,
} from '../../../src/domain/storePurchase.js';

describe('mobile store purchase domain', () => {
  it('設定済みのstoreとproduct IDだけをserver allowlistから解決する', () => {
    const catalog = createStoreProductCatalog([
      {
        store: 'apple',
        productId: 'jp.lyra.standard.monthly',
        kind: 'subscription',
        planCode: 'standard',
      },
      {
        store: 'google',
        productId: 'jp.lyra.credits.200',
        kind: 'credit_pack',
        creditPackageCode: 'credits_200',
      },
    ]);

    expect(catalog.resolve('apple', 'jp.lyra.standard.monthly')).toMatchObject({
      kind: 'subscription',
      planCode: 'standard',
    });
    expect(catalog.resolve('google', 'jp.lyra.standard.monthly')).toBeNull();
    expect(catalog.resolve('google', 'unknown.product')).toBeNull();
  });

  it('同一store内の重複product IDを拒否する', () => {
    expect(() =>
      createStoreProductCatalog([
        {
          store: 'apple',
          productId: 'duplicate',
          kind: 'subscription',
          planCode: 'standard',
        },
        {
          store: 'apple',
          productId: 'duplicate',
          kind: 'credit_pack',
          creditPackageCode: 'credits_200',
        },
      ]),
    ).toThrow(/duplicated/u);
  });

  it('provider識別子を43文字のkeyへ変換し元の値を含めない', () => {
    const secret = '01234567890123456789012345678901';
    const key = createStoreIdentifierKey(secret, 'apple:transaction', 'raw-transaction-id');

    expect(key).toHaveLength(43);
    expect(key).not.toContain('raw-transaction-id');
    expect(createGooglePlayObfuscatedAccountId(secret, 'user-id')).toHaveLength(43);
  });

  it('古い観測で新しい返金状態を上書きしない', () => {
    const newer = new Date('2026-07-31T10:00:00.000Z');
    const older = new Date('2026-07-31T09:00:00.000Z');

    expect(
      transitionStorePurchaseState({
        currentState: 'refunded',
        currentObservedAt: newer,
        incomingState: 'active',
        incomingObservedAt: older,
      }),
    ).toEqual({
      state: 'refunded',
      observedAt: newer,
      ignoredAsStale: true,
    });
  });
});
