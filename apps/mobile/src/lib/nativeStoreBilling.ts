import * as ExpoIap from 'expo-iap';

export type NativeStoreProductKind = 'subscription' | 'credit_pack';
export type NativeStoreName = 'apple' | 'google';
export type NativeStorePurchaseState = 'pending' | 'purchased' | 'unknown';
export type NativeStoreBillingErrorCode =
  | 'ALREADY_OWNED'
  | 'CONNECTION_FAILED'
  | 'DUPLICATE_SUBMIT'
  | 'FINISH_FAILED'
  | 'NETWORK'
  | 'NOT_CONNECTED'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  | 'PURCHASE_CANCELLED'
  | 'PURCHASE_FAILED'
  | 'PURCHASE_PENDING'
  | 'RESTORE_FAILED'
  | 'STORE_UNAVAILABLE'
  | 'VERIFICATION_FAILED';

export interface NativeStoreBillingProductDefinition {
  id: string;
  kind: NativeStoreProductKind;
  title: string;
  description?: string;
}

export interface NativeStoreCatalogProduct extends NativeStoreBillingProductDefinition {
  available: boolean;
  displayPrice: string | null;
}

export interface NativeStorePurchase {
  id: string;
  productId: string;
  purchaseState: NativeStorePurchaseState;
  purchaseToken?: string | null;
  store: NativeStoreName | 'unknown';
  environmentIOS?: 'sandbox' | 'production' | null;
  nativePurchase?: object;
}

export interface NativeStorePurchaseRequest {
  request: {
    apple: { appAccountToken: string; sku: string };
    google: { obfuscatedAccountId: string; skus: string[] };
  };
  type: 'in-app' | 'subs';
}

export interface NativeStoreProduct {
  id: string;
  title: string;
  description?: string | null;
  displayPrice: string;
  type: 'in-app' | 'subs';
}

export interface NativeStoreSubscription {
  remove(): void;
}

export interface NativeStoreBillingSdk {
  endConnection(): Promise<void>;
  fetchProducts(input: { skus: string[]; type: 'in-app' | 'subs' }): Promise<readonly NativeStoreProduct[] | null>;
  finishTransaction(input: { isConsumable: boolean; purchase: NativeStorePurchase }): Promise<void>;
  getAvailablePurchases(): Promise<readonly NativeStorePurchase[]>;
  initConnection(): Promise<boolean>;
  purchaseErrorListener(listener: (error: { code: string }) => void): NativeStoreSubscription;
  purchaseUpdatedListener(listener: (purchase: NativeStorePurchase) => void | Promise<void>): NativeStoreSubscription;
  requestPurchase(input: NativeStorePurchaseRequest): Promise<unknown>;
  restorePurchases(): Promise<void>;
}

export interface NativeStoreAccountBinding {
  appleAppAccountToken: string;
  googleObfuscatedAccountId: string;
  subscriptionPurchaseAllowed: boolean;
}

export interface NativeStoreServerBalance {
  monthlyCredits: number;
  purchasedCredits: number;
}

export interface NativeStoreServerEntitlement {
  plan: 'free' | 'standard' | 'premium';
}

export interface NativeStoreServerState {
  balance: NativeStoreServerBalance;
  entitlement: NativeStoreServerEntitlement;
}

export interface NativeStoreBillingBackend {
  getAccountBinding(): Promise<NativeStoreAccountBinding>;
  restorePurchases(input: {
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<NativeStoreServerState>;
  verifyApplePurchase(input: {
    signedTransaction: string;
    environment: 'sandbox' | 'production';
  }): Promise<NativeStoreServerState>;
  verifyGooglePurchase(input: { purchaseToken: string }): Promise<NativeStoreServerState>;
}

export class NativeStoreBillingError extends Error {
  public constructor(
    public readonly code: NativeStoreBillingErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'NativeStoreBillingError';
  }
}

export interface NativeStoreBillingState {
  connected: boolean;
  error: NativeStoreBillingError | null;
  lastVerified: NativeStoreServerState | null;
  loading: boolean;
  products: NativeStoreCatalogProduct[];
  restoring: boolean;
  submittingProductId: string | null;
}

export interface NativeStoreBillingAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getState(): NativeStoreBillingState;
  purchase(productId: string): Promise<void>;
  restore(): Promise<NativeStoreServerState[]>;
  subscribe(listener: (state: NativeStoreBillingState) => void): () => void;
}

interface NativeStoreBillingAdapterDependencies {
  backend: NativeStoreBillingBackend;
  products: readonly NativeStoreBillingProductDefinition[];
  sdk: NativeStoreBillingSdk;
}

export function createNativeStoreBillingAdapter(
  dependencies: NativeStoreBillingAdapterDependencies,
): NativeStoreBillingAdapter {
  return new NativeStoreBillingAdapterImplementation(dependencies);
}

class NativeStoreBillingAdapterImplementation implements NativeStoreBillingAdapter {
  private readonly listeners = new Set<(state: NativeStoreBillingState) => void>();
  private readonly processedPurchaseIds = new Set<string>();
  private readonly processingPurchaseIds = new Set<string>();
  private purchaseSubscription: NativeStoreSubscription | null = null;
  private errorSubscription: NativeStoreSubscription | null = null;
  private connecting: Promise<void> | null = null;
  private restoring = false;
  private state: NativeStoreBillingState = {
    connected: false,
    error: null,
    lastVerified: null,
    loading: false,
    products: [],
    restoring: false,
    submittingProductId: null
  };

  public constructor(private readonly dependencies: NativeStoreBillingAdapterDependencies) {}

  public getState(): NativeStoreBillingState {
    return this.state;
  }

  public subscribe(listener: (state: NativeStoreBillingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public async connect(): Promise<void> {
    if (this.state.connected) {
      return;
    }
    if (this.connecting !== null) {
      return this.connecting;
    }
    this.connecting = this.connectInternal().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  public async disconnect(): Promise<void> {
    this.purchaseSubscription?.remove();
    this.errorSubscription?.remove();
    this.purchaseSubscription = null;
    this.errorSubscription = null;
    this.processedPurchaseIds.clear();
    this.processingPurchaseIds.clear();
    this.restoring = false;
    try {
      await this.dependencies.sdk.endConnection();
    } catch {
      // The connection is being disposed. A provider-side close error is not actionable here.
    }
    this.updateState({
      connected: false,
      loading: false,
      restoring: false,
      submittingProductId: null
    });
  }

  public async purchase(productId: string): Promise<void> {
    if (!this.state.connected) {
      throw this.fail('NOT_CONNECTED', false);
    }
    if (this.state.submittingProductId !== null || this.restoring) {
      throw this.fail('DUPLICATE_SUBMIT', false);
    }
    const product = this.dependencies.products.find((candidate) => candidate.id === productId);
    if (product === undefined) {
      throw this.fail('PRODUCT_NOT_FOUND', false);
    }
    if (!this.state.products.some((candidate) => candidate.id === productId && candidate.available)) {
      throw this.fail('PRODUCT_UNAVAILABLE', false);
    }

    this.updateState({ error: null, submittingProductId: productId });
    try {
      const binding = await this.dependencies.backend.getAccountBinding();
      if (product.kind === 'subscription' && !binding.subscriptionPurchaseAllowed) {
        throw this.fail('ALREADY_OWNED', false);
      }
      await this.dependencies.sdk.requestPurchase(buildPurchaseRequest(product, binding));
    } catch (error) {
      const normalized = error instanceof NativeStoreBillingError ? error : normalizeProviderError(error);
      this.updateState({ error: normalized, submittingProductId: null });
      throw normalized;
    }
  }

  public async restore(): Promise<NativeStoreServerState[]> {
    if (!this.state.connected) {
      throw this.fail('NOT_CONNECTED', false);
    }
    if (this.restoring || this.state.submittingProductId !== null) {
      throw this.fail('DUPLICATE_SUBMIT', false);
    }
    this.restoring = true;
    this.updateState({ error: null, restoring: true });
    try {
      await this.dependencies.sdk.restorePurchases();
      const purchases = await this.dependencies.sdk.getAvailablePurchases();
      const proofBundle = collectRestoreProofs(purchases, this.dependencies.products);
      if (proofBundle.overflowed) {
        throw new NativeStoreBillingError('RESTORE_FAILED', false);
      }
      if (proofBundle.appleSignedTransactions.length + proofBundle.googlePurchaseTokens.length === 0) {
        return [];
      }
      const verified = await this.dependencies.backend.restorePurchases({
        appleSignedTransactions: proofBundle.appleSignedTransactions,
        googlePurchaseTokens: proofBundle.googlePurchaseTokens
      });
      assertServerState(verified);
      for (const purchase of proofBundle.purchases) {
        await this.finishVerifiedPurchase(purchase);
        this.processedPurchaseIds.add(purchaseKey(purchase));
      }
      this.updateState({ error: null, lastVerified: verified });
      return [verified];
    } catch (error) {
      const normalized = error instanceof NativeStoreBillingError
        ? error
        : new NativeStoreBillingError('RESTORE_FAILED', true);
      this.updateState({ error: normalized });
      throw normalized;
    } finally {
      this.restoring = false;
      this.updateState({ restoring: false });
    }
  }

  private async connectInternal(): Promise<void> {
    this.updateState({ error: null, loading: true });
    this.purchaseSubscription = this.dependencies.sdk.purchaseUpdatedListener((purchase) =>
      this.handlePurchaseUpdate(purchase),
    );
    this.errorSubscription = this.dependencies.sdk.purchaseErrorListener((error) => {
      const normalized = normalizeProviderError(error);
      this.updateState({ error: normalized, submittingProductId: null });
    });
    try {
      const connected = await this.dependencies.sdk.initConnection();
      if (!connected) {
        throw new NativeStoreBillingError('STORE_UNAVAILABLE', true);
      }
      const products = await this.loadProducts();
      this.updateState({ connected: true, error: null, loading: false, products });
    } catch (error) {
      this.purchaseSubscription?.remove();
      this.errorSubscription?.remove();
      this.purchaseSubscription = null;
      this.errorSubscription = null;
      try {
        await this.dependencies.sdk.endConnection();
      } catch {
        // The failed connection has no usable state to preserve.
      }
      const normalized = error instanceof NativeStoreBillingError
        ? error
        : new NativeStoreBillingError('CONNECTION_FAILED', true);
      this.updateState({ connected: false, error: normalized, loading: false, products: [] });
      throw normalized;
    }
  }

  private async loadProducts(): Promise<NativeStoreCatalogProduct[]> {
    const inAppSkus = this.dependencies.products
      .filter((product) => product.kind === 'credit_pack')
      .map((product) => product.id);
    const subscriptionSkus = this.dependencies.products
      .filter((product) => product.kind === 'subscription')
      .map((product) => product.id);
    const responses = await Promise.all([
      inAppSkus.length === 0 ? Promise.resolve([]) : this.dependencies.sdk.fetchProducts({ skus: inAppSkus, type: 'in-app' }),
      subscriptionSkus.length === 0 ? Promise.resolve([]) : this.dependencies.sdk.fetchProducts({ skus: subscriptionSkus, type: 'subs' })
    ]);
    const storeProducts = new Map<string, NativeStoreProduct>();
    for (const response of responses) {
      for (const product of response ?? []) {
        storeProducts.set(product.id, product);
      }
    }
    return this.dependencies.products.map((product) => {
      const storeProduct = storeProducts.get(product.id);
      return {
        ...product,
        available: storeProduct !== undefined,
        displayPrice: storeProduct?.displayPrice ?? null,
        title: storeProduct?.title || product.title,
        description: storeProduct?.description ?? product.description
      };
    });
  }

  private async handlePurchaseUpdate(purchase: NativeStorePurchase): Promise<void> {
    if (this.restoring) {
      return;
    }
    if (purchase.purchaseState === 'pending') {
      this.updateState({
        error: new NativeStoreBillingError('PURCHASE_PENDING', false),
        submittingProductId: null
      });
      return;
    }
    if (purchase.purchaseState !== 'purchased') {
      this.updateState({
        error: new NativeStoreBillingError('PURCHASE_FAILED', true),
        submittingProductId: null
      });
      return;
    }

    const key = purchaseKey(purchase);
    if (this.processedPurchaseIds.has(key) || this.processingPurchaseIds.has(key)) {
      return;
    }
    this.processingPurchaseIds.add(key);
    try {
      const verified = await this.verifyPurchase(purchase);
      await this.finishVerifiedPurchase(purchase);
      this.processedPurchaseIds.add(key);
      this.updateState({ error: null, lastVerified: verified, submittingProductId: null });
    } catch (error) {
      const normalized = error instanceof NativeStoreBillingError
        ? error
        : new NativeStoreBillingError('VERIFICATION_FAILED', true);
      this.updateState({ error: normalized, submittingProductId: null });
    } finally {
      this.processingPurchaseIds.delete(key);
    }
  }

  private async verifyPurchase(purchase: NativeStorePurchase): Promise<NativeStoreServerState> {
    const product = this.dependencies.products.find((candidate) => candidate.id === purchase.productId);
    if (product === undefined || purchase.purchaseToken == null || purchase.purchaseToken.length === 0) {
      throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
    }
    let verified: NativeStoreServerState;
    if (purchase.store === 'apple') {
      verified = await this.dependencies.backend.verifyApplePurchase({
        environment: purchase.environmentIOS === 'sandbox' ? 'sandbox' : 'production',
        signedTransaction: purchase.purchaseToken
      });
    } else if (purchase.store === 'google') {
      verified = await this.dependencies.backend.verifyGooglePurchase({ purchaseToken: purchase.purchaseToken });
    } else {
      throw new NativeStoreBillingError('VERIFICATION_FAILED', false);
    }
    assertServerState(verified);
    return verified;
  }

  private async finishVerifiedPurchase(purchase: NativeStorePurchase): Promise<void> {
    const product = this.dependencies.products.find((candidate) => candidate.id === purchase.productId);
    if (product === undefined) {
      throw new NativeStoreBillingError('PRODUCT_NOT_FOUND', false);
    }
    try {
      await this.dependencies.sdk.finishTransaction({
        isConsumable: product.kind === 'credit_pack',
        purchase
      });
    } catch {
      throw new NativeStoreBillingError('FINISH_FAILED', true);
    }
  }

  private fail(code: NativeStoreBillingErrorCode, retryable: boolean): NativeStoreBillingError {
    const error = new NativeStoreBillingError(code, retryable);
    this.updateState({ error });
    return error;
  }

  private updateState(patch: Partial<NativeStoreBillingState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

function buildPurchaseRequest(
  product: NativeStoreBillingProductDefinition,
  binding: NativeStoreAccountBinding,
): NativeStorePurchaseRequest {
  return {
    request: {
      apple: { appAccountToken: binding.appleAppAccountToken, sku: product.id },
      google: { obfuscatedAccountId: binding.googleObfuscatedAccountId, skus: [product.id] }
    },
    type: product.kind === 'subscription' ? 'subs' : 'in-app'
  };
}

function collectRestoreProofs(
  purchases: readonly NativeStorePurchase[],
  products: readonly NativeStoreBillingProductDefinition[],
): {
  appleSignedTransactions: string[];
  googlePurchaseTokens: string[];
  overflowed: boolean;
  purchases: NativeStorePurchase[];
} {
  const appleSignedTransactions: string[] = [];
  const googlePurchaseTokens: string[] = [];
  const verifiedPurchases: NativeStorePurchase[] = [];
  const knownProductIds = new Set(products.map((product) => product.id));
  const seenProofs = new Set<string>();
  let overflowed = false;
  for (const purchase of purchases) {
    if (purchase.purchaseState !== 'purchased' || !knownProductIds.has(purchase.productId)) {
      continue;
    }
    const token = purchase.purchaseToken;
    if (token == null || token.length === 0) {
      continue;
    }
    const key = purchaseKey(purchase);
    if (seenProofs.has(key)) {
      continue;
    }
    if (verifiedPurchases.length >= 50) {
      overflowed = true;
      break;
    }
    seenProofs.add(key);
    if (purchase.store === 'apple') {
      appleSignedTransactions.push(token);
      verifiedPurchases.push(purchase);
    } else if (purchase.store === 'google') {
      googlePurchaseTokens.push(token);
      verifiedPurchases.push(purchase);
    }
  }
  return { appleSignedTransactions, googlePurchaseTokens, overflowed, purchases: verifiedPurchases };
}

function purchaseKey(purchase: NativeStorePurchase): string {
  return `${purchase.store}:${purchase.id}`;
}

function assertServerState(value: NativeStoreServerState): void {
  if (
    !Number.isFinite(value?.balance?.monthlyCredits)
    || !Number.isFinite(value?.balance?.purchasedCredits)
    || !isPlan(value?.entitlement?.plan)
  ) {
    throw new NativeStoreBillingError('VERIFICATION_FAILED', true);
  }
}

function isPlan(value: unknown): value is NativeStoreServerEntitlement['plan'] {
  return value === 'free' || value === 'standard' || value === 'premium';
}

function normalizeProviderError(error: unknown): NativeStoreBillingError {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown';
  if (code === 'user-cancelled') return new NativeStoreBillingError('PURCHASE_CANCELLED', false);
  if (code === 'already-owned') return new NativeStoreBillingError('ALREADY_OWNED', false);
  if (code === 'pending') return new NativeStoreBillingError('PURCHASE_PENDING', false);
  if (code === 'network-error' || code === 'connection-closed' || code === 'service-disconnected' || code === 'service-timeout') {
    return new NativeStoreBillingError('NETWORK', true);
  }
  if (code === 'item-unavailable' || code === 'sku-not-found') return new NativeStoreBillingError('PRODUCT_UNAVAILABLE', false);
  if (code === 'billing-unavailable' || code === 'iap-not-available') return new NativeStoreBillingError('STORE_UNAVAILABLE', true);
  return new NativeStoreBillingError('PURCHASE_FAILED', true);
}

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
        title: product.title,
        type: product.type
      }));
    },
    finishTransaction: async ({ isConsumable, purchase }) => {
      if (purchase.nativePurchase === undefined) {
        throw new Error('Native purchase is unavailable');
      }
      await ExpoIap.finishTransaction({
        isConsumable,
        purchase: purchase.nativePurchase as ExpoIap.Purchase
      });
    },
    getAvailablePurchases: async () => (await ExpoIap.getAvailablePurchases()).map(normalizeExpoPurchase),
    initConnection: () => ExpoIap.initConnection(),
    purchaseErrorListener: (listener) => ExpoIap.purchaseErrorListener((error) => listener({ code: error.code ?? 'unknown' })),
    purchaseUpdatedListener: (listener) => ExpoIap.purchaseUpdatedListener((purchase) => listener(normalizeExpoPurchase(purchase))),
    requestPurchase: (input) => ExpoIap.requestPurchase(input),
    restorePurchases: () => ExpoIap.restorePurchases()
  };
}

function normalizeExpoPurchase(purchase: ExpoIap.Purchase): NativeStorePurchase {
  return {
    environmentIOS: 'environmentIOS' in purchase && purchase.environmentIOS === 'sandbox' ? 'sandbox' : 'production',
    id: purchase.id,
    nativePurchase: purchase,
    productId: purchase.productId,
    purchaseState: purchase.purchaseState,
    purchaseToken: purchase.purchaseToken,
    store: purchase.store === 'apple' || purchase.store === 'google' ? purchase.store : 'unknown'
  };
}
