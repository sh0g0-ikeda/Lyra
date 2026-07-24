import { describe, expect, it } from 'vitest';
import {
  createStoreProductCatalog,
  resolveStorePurchaseState,
  transitionStorePurchaseState,
} from '../../../src/domain/storePurchase.js';

describe('mobile store purchase domain', () => {
  it('server-side allowlist maps only configured Apple and Google products', () => {
    const catalog = createStoreProductCatalog([
      {
        store: 'apple',
        productId: 'com.lyra.standard.monthly',
        kind: 'subscription',
        planCode: 'standard',
      },
      {
        store: 'google',
        productId: 'lyra.credits.200',
        kind: 'credit_pack',
        creditPackageCode: 'credits_200',
      },
    ]);

    expect(catalog.resolve('apple', 'com.lyra.standard.monthly')).toEqual({
      store: 'apple',
      productId: 'com.lyra.standard.monthly',
      kind: 'subscription',
      planCode: 'standard',
    });
    expect(catalog.resolve('google', 'com.lyra.standard.monthly')).toBeNull();
    expect(catalog.resolve('google', 'unconfigured.product')).toBeNull();
  });

  it('maps provider evidence to pending, cancelled, renewal, refund, and revocation states', () => {
    expect(resolveStorePurchaseState('pending')).toBe('pending');
    expect(resolveStorePurchaseState('active')).toBe('active');
    expect(resolveStorePurchaseState('cancelled')).toBe('cancelled');
    expect(resolveStorePurchaseState('expired')).toBe('expired');
    expect(resolveStorePurchaseState('refunded')).toBe('refunded');
    expect(resolveStorePurchaseState('revoked')).toBe('revoked');
  });

  it('does not allow an older active observation to overwrite a newer refund or revocation', () => {
    const newerRefund = new Date('2026-07-24T10:00:00.000Z');
    const olderRenewal = new Date('2026-07-24T09:00:00.000Z');

    expect(
      transitionStorePurchaseState({
        currentState: 'refunded',
        currentObservedAt: newerRefund,
        incomingState: 'active',
        incomingObservedAt: olderRenewal,
      }),
    ).toEqual({
      state: 'refunded',
      observedAt: newerRefund,
      ignoredAsStale: true,
    });

    expect(
      transitionStorePurchaseState({
        currentState: 'active',
        currentObservedAt: olderRenewal,
        incomingState: 'revoked',
        incomingObservedAt: newerRefund,
      }),
    ).toEqual({
      state: 'revoked',
      observedAt: newerRefund,
      ignoredAsStale: false,
    });
  });
});
