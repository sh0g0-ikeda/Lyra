import { createHmac } from 'node:crypto';
import type { ConsumerPaidPlanCode, CreditPackageCode } from './constants/billing.js';
import { ConfigurationError } from './errors/index.js';

export const STORE_PURCHASE_STORES = ['apple', 'google'] as const;
export const STORE_PURCHASE_ENVIRONMENTS = ['sandbox', 'production'] as const;
export const STORE_PURCHASE_KINDS = ['subscription', 'credit_pack'] as const;
export const STORE_PURCHASE_STATES = [
  'pending',
  'active',
  'cancelled',
  'expired',
  'refunded',
  'revoked',
  'failed',
] as const;

export type StorePurchaseStore = (typeof STORE_PURCHASE_STORES)[number];
export type StorePurchaseEnvironment = (typeof STORE_PURCHASE_ENVIRONMENTS)[number];
export type StorePurchaseKind = (typeof STORE_PURCHASE_KINDS)[number];
export type StorePurchaseState = (typeof STORE_PURCHASE_STATES)[number];

export type StoreProductDefinition =
  | {
      store: StorePurchaseStore;
      productId: string;
      kind: 'subscription';
      planCode: ConsumerPaidPlanCode;
      creditPackageCode?: never;
    }
  | {
      store: StorePurchaseStore;
      productId: string;
      kind: 'credit_pack';
      creditPackageCode: CreditPackageCode;
      planCode?: never;
    };

export interface StoreProductCatalog {
  resolve(store: StorePurchaseStore, productId: string): StoreProductDefinition | null;
  entries(): readonly StoreProductDefinition[];
}

export interface VerifiedStorePurchase {
  store: StorePurchaseStore;
  environment: StorePurchaseEnvironment;
  productId: string;
  externalPurchaseId: string;
  linkedExternalPurchaseId: string | null;
  transactionId: string | null;
  eventId: string | null;
  state: StorePurchaseState;
  observedAt: Date;
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
  accountBinding: string | null;
  isTestPurchase: boolean;
  providerEventType: string;
  providerCompletion: 'none' | 'acknowledge' | 'consume';
}

export interface StorePurchaseTransition {
  currentState: StorePurchaseState;
  currentObservedAt: Date;
  incomingState: StorePurchaseState;
  incomingObservedAt: Date;
}

export interface StorePurchaseTransitionResult {
  state: StorePurchaseState;
  observedAt: Date;
  ignoredAsStale: boolean;
}

export function createStoreProductCatalog(
  entries: readonly StoreProductDefinition[],
): StoreProductCatalog {
  const byStoreProduct = new Map<string, StoreProductDefinition>();

  for (const entry of entries) {
    const normalizedProductId = entry.productId.trim();
    if (normalizedProductId.length === 0 || normalizedProductId.length > 255) {
      throw new ConfigurationError('Mobile store product mapping contains an invalid product id');
    }

    const key = catalogKey(entry.store, normalizedProductId);
    if (byStoreProduct.has(key)) {
      throw new ConfigurationError(`Mobile store product mapping is duplicated for ${entry.store}`);
    }

    byStoreProduct.set(key, { ...entry, productId: normalizedProductId });
  }

  return {
    resolve(store: StorePurchaseStore, productId: string): StoreProductDefinition | null {
      return byStoreProduct.get(catalogKey(store, productId.trim())) ?? null;
    },
    entries(): readonly StoreProductDefinition[] {
      return [...byStoreProduct.values()];
    },
  };
}

export function transitionStorePurchaseState(
  input: StorePurchaseTransition,
): StorePurchaseTransitionResult {
  if (input.incomingObservedAt < input.currentObservedAt) {
    return {
      state: input.currentState,
      observedAt: input.currentObservedAt,
      ignoredAsStale: true,
    };
  }

  if (
    input.incomingObservedAt.getTime() === input.currentObservedAt.getTime() &&
    stateRank(input.incomingState) < stateRank(input.currentState)
  ) {
    return {
      state: input.currentState,
      observedAt: input.currentObservedAt,
      ignoredAsStale: true,
    };
  }

  return {
    state: input.incomingState,
    observedAt: input.incomingObservedAt,
    ignoredAsStale: false,
  };
}

export function createStoreIdentifierKey(
  secret: string,
  namespace: string,
  value: string,
): string {
  if (secret.trim().length < 32) {
    throw new ConfigurationError('Mobile store identifier key must be at least 32 characters');
  }
  if (namespace.length === 0 || value.length === 0) {
    throw new ConfigurationError('Mobile store identifier input is invalid');
  }

  return createHmac('sha256', secret)
    .update(`${namespace}:${value}`, 'utf8')
    .digest('base64url');
}

export function createGooglePlayObfuscatedAccountId(secret: string, userId: string): string {
  return createStoreIdentifierKey(secret, 'google-play-account', userId);
}

function catalogKey(store: StorePurchaseStore, productId: string): string {
  return `${store}:${productId}`;
}

function stateRank(state: StorePurchaseState): number {
  switch (state) {
    case 'pending':
      return 0;
    case 'active':
      return 1;
    case 'cancelled':
      return 2;
    case 'expired':
      return 3;
    case 'failed':
      return 4;
    case 'refunded':
      return 5;
    case 'revoked':
      return 6;
  }
}
