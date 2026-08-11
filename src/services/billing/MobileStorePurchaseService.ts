import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  SUBSCRIPTION_PLAN_DEFINITIONS,
  type ConsumerPaidPlanCode,
  type CreditPackageCode,
} from '../../domain/constants/billing.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import {
  createGooglePlayObfuscatedAccountId,
  createStoreIdentifierKey,
  transitionStorePurchaseState,
  type StoreProductCatalog,
  type StoreProductDefinition,
  type StorePurchaseEnvironment,
  type StorePurchaseState,
  type StorePurchaseStore,
  type VerifiedStorePurchase,
} from '../../domain/storePurchase.js';
import type { CreditBalance, CreditLedgerEntry } from '../../domain/types/credit.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { CreditRepository } from '../../repositories/CreditRepository.js';
import type {
  StorePurchaseRecord,
  StorePurchaseRepository,
} from '../../repositories/StorePurchaseRepository.js';
import { BillingCreditGrantService } from '../credit/BillingCreditGrantService.js';
import { normalizeExpiredMonthlyCredits, systemClock, type Clock } from '../credit/CreditBalanceExpiration.js';

export interface MobileStorePurchaseResult {
  store: StorePurchaseStore;
  state: StorePurchaseState;
  productKind: 'subscription' | 'credit_pack';
  planCode: ConsumerPaidPlanCode | null;
  creditPackageCode: CreditPackageCode | null;
  creditsChanged: number;
  isDuplicate: boolean;
}

export interface AppleStorePurchaseVerifierPort {
  verifyTransaction(input: {
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<VerifiedStorePurchase>;
  verifyNotification(signedPayload: string): Promise<VerifiedStorePurchase | null>;
}

export interface GooglePlayPurchaseVerifierPort {
  verifyPurchase(input: { purchaseToken: string }): Promise<VerifiedStorePurchase>;
}

export interface MobileStorePurchaseServicePort {
  listProducts(store: StorePurchaseStore): readonly StoreProductDefinition[];
  getAccountBinding(userId: string): Promise<MobileStoreAccountBinding>;
  verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<MobileStorePurchaseResult>;
  verifyGooglePurchase(input: { userId: string; purchaseToken: string }): Promise<MobileStorePurchaseResult>;
  restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]>;
  handleAppleNotification(signedPayload: string): Promise<void>;
  handleGoogleRtdn(input: { messageId: string; data: string; publishTime: Date | null }): Promise<void>;
}

export interface MobileStoreAccountBinding {
  appleAppAccountToken: string;
  googleObfuscatedAccountId: string;
  subscriptionPurchaseAllowed: boolean;
}

export interface MobileStorePurchaseServiceDependencies {
  storePurchaseRepository: StorePurchaseRepository;
  creditRepository: CreditRepository;
  productCatalog: StoreProductCatalog;
  appleVerifier: AppleStorePurchaseVerifierPort;
  googleVerifier: GooglePlayPurchaseVerifierPort;
  identifierSecret: string;
  allowAppleSandbox: boolean;
  allowGoogleTestPurchases: boolean;
  googleTestPurchaseAllowedUserIds?: ReadonlySet<string> | null;
  googleTestPurchasesExpireAt?: Date | null;
  googlePackageName: string;
  clock?: Clock;
}

export class MobileStorePurchaseService implements MobileStorePurchaseServicePort {
  private readonly clock: Clock;
  private readonly billingCreditGrantService: BillingCreditGrantService;

  public constructor(private readonly dependencies: MobileStorePurchaseServiceDependencies) {
    this.clock = dependencies.clock ?? systemClock;
    this.billingCreditGrantService = new BillingCreditGrantService(dependencies.creditRepository, this.clock);
  }

  public listProducts(store: StorePurchaseStore): readonly StoreProductDefinition[] {
    return this.dependencies.productCatalog.entries().filter((product) => product.store === store);
  }

  public async getAccountBinding(userId: string): Promise<MobileStoreAccountBinding> {
    return this.dependencies.storePurchaseRepository.transaction(async (client) => {
      const user = await this.dependencies.storePurchaseRepository.findUserForUpdate(userId, client);
      if (user === null) {
        throw new NotFoundError('Account was not found');
      }

      return {
        appleAppAccountToken: user.id,
        googleObfuscatedAccountId: createGooglePlayObfuscatedAccountId(this.dependencies.identifierSecret, user.id),
        subscriptionPurchaseAllowed: !(await this.dependencies.storePurchaseRepository.hasActiveStripeConsumerSubscription(
          user.id,
          client,
        )),
      };
    });
  }

  public async verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<MobileStorePurchaseResult> {
    const verified = await this.dependencies.appleVerifier.verifyTransaction({
      signedTransaction: input.signedTransaction,
      environment: input.environment,
    });
    if (
      verified.store !== 'apple'
      || (verified.environment === 'sandbox' && !this.dependencies.allowAppleSandbox)
    ) {
      throw new ValidationError('Store purchase could not be verified');
    }

    return this.applyVerifiedPurchase(verified, input.userId);
  }

  public async verifyGooglePurchase(input: {
    userId: string;
    purchaseToken: string;
  }): Promise<MobileStorePurchaseResult> {
    const verified = await this.dependencies.googleVerifier.verifyPurchase({ purchaseToken: input.purchaseToken });
    if (verified.store !== 'google' || !this.isGoogleTestPurchaseAllowed(verified, input.userId)) {
      throw new ValidationError('Store purchase could not be verified');
    }

    return this.applyVerifiedPurchase(verified, input.userId);
  }

  public async restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]> {
    const results: MobileStorePurchaseResult[] = [];

    for (const signedTransaction of input.appleSignedTransactions) {
      const verified = await this.dependencies.appleVerifier.verifyTransaction({
        signedTransaction,
        environment: 'sandbox',
      }).catch(async () =>
        this.dependencies.appleVerifier.verifyTransaction({
          signedTransaction,
          environment: 'production',
        }),
      );
      if (verified.environment === 'sandbox' && !this.dependencies.allowAppleSandbox) {
        continue;
      }
      results.push(await this.applyVerifiedPurchase(verified, input.userId));
    }

    for (const purchaseToken of input.googlePurchaseTokens) {
      const verified = await this.dependencies.googleVerifier.verifyPurchase({ purchaseToken });
      if (!this.isGoogleTestPurchaseAllowed(verified, input.userId)) {
        continue;
      }
      results.push(await this.applyVerifiedPurchase(verified, input.userId));
    }

    return results;
  }

  public async handleAppleNotification(signedPayload: string): Promise<void> {
    const verified = await this.dependencies.appleVerifier.verifyNotification(signedPayload);
    if (verified === null || (verified.environment === 'sandbox' && !this.dependencies.allowAppleSandbox)) {
      return;
    }

    await this.applyVerifiedPurchase(verified, null);
  }

  public async handleGoogleRtdn(input: {
    messageId: string;
    data: string;
    publishTime: Date | null;
  }): Promise<void> {
    const notification = parseGoogleRtdn(input.data);
    if (notification.packageName !== this.dependencies.googlePackageName) {
      throw new ValidationError('Store notification could not be verified');
    }

    const occurredAt = notification.eventTime ?? input.publishTime ?? this.clock();
    if (notification.kind === 'test') {
      await this.recordUnknownGoogleEvent({
        eventId: input.messageId,
        state: 'pending',
        occurredAt,
        providerEventType: 'google.test_notification',
      });
      return;
    }

    if (notification.kind === 'voided') {
      await this.applyGoogleVoidedPurchase({
        purchaseToken: notification.purchaseToken,
        orderId: notification.orderId,
        eventId: input.messageId,
        occurredAt,
      });
      return;
    }

    const verified = await this.dependencies.googleVerifier.verifyPurchase({
      purchaseToken: notification.purchaseToken,
    });
    if (!this.isGoogleTestPurchaseAllowed(verified, null)) {
      return;
    }

    await this.applyVerifiedPurchase(
      {
        ...verified,
        state: notification.overrideState ?? verified.state,
        eventId: input.messageId,
        observedAt: occurredAt,
        providerEventType: notification.providerEventType,
      },
      null,
    );
  }

  private isGoogleTestPurchaseAllowed(
    verified: VerifiedStorePurchase,
    requestedUserId: string | null,
  ): boolean {
    if (!verified.isTestPurchase) {
      return true;
    }
    if (!this.dependencies.allowGoogleTestPurchases) {
      return false;
    }
    const expiresAt = this.dependencies.googleTestPurchasesExpireAt ?? null;
    if (expiresAt !== null && this.clock().getTime() >= expiresAt.getTime()) {
      return false;
    }
    const allowedUserIds = this.dependencies.googleTestPurchaseAllowedUserIds ?? null;
    if (allowedUserIds === null) {
      return true;
    }
    if (requestedUserId !== null) {
      return allowedUserIds.has(requestedUserId);
    }
    if (verified.accountBinding === null) {
      return false;
    }
    for (const userId of allowedUserIds) {
      if (createGooglePlayObfuscatedAccountId(this.dependencies.identifierSecret, userId) === verified.accountBinding) {
        return true;
      }
    }
    return false;
  }

  private async applyVerifiedPurchase(
    verified: VerifiedStorePurchase,
    requestedUserId: string | null,
  ): Promise<MobileStorePurchaseResult> {
    const product = this.dependencies.productCatalog.resolve(verified.store, verified.productId);
    if (product === null) {
      throw new ValidationError('Store purchase could not be verified');
    }

    const externalPurchaseKey = createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      `${verified.store}:external-purchase`,
      verified.externalPurchaseId,
    );
    const transactionKey = verified.transactionId === null
      ? null
      : createStoreIdentifierKey(
          this.dependencies.identifierSecret,
          `${verified.store}:transaction`,
          verified.transactionId,
        );
    const eventKey = createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      `${verified.store}:event`,
      verified.eventId ?? `${verified.transactionId ?? verified.externalPurchaseId}:${verified.state}:${verified.observedAt.toISOString()}`,
    );

    const result = await this.dependencies.storePurchaseRepository.transaction(async (client) => {
      await this.dependencies.storePurchaseRepository.lockPurchaseKey(verified.store, externalPurchaseKey, client);
      const requestedUser = requestedUserId === null
        ? null
        : await this.dependencies.storePurchaseRepository.findUserForUpdate(requestedUserId, client);
      if (requestedUserId !== null && requestedUser === null) {
        throw new NotFoundError('Account was not found');
      }
      const existing = await this.dependencies.storePurchaseRepository.findPurchaseForUpdate(
        verified.store,
        externalPurchaseKey,
        client,
      );
      if (existing === null && requestedUserId === null) {
        await this.recordUnknownStoreEvent({
          store: verified.store,
          eventKey,
          state: verified.state,
          occurredAt: verified.observedAt,
          providerEventType: verified.providerEventType,
          client,
        });
        return null;
      }

      const userId = existing?.userId ?? requestedUserId;
      if (userId === null) {
        return null;
      }
      if (existing !== null && requestedUserId !== null && existing.userId !== requestedUserId) {
        throw new ForbiddenError('Store purchase belongs to another account');
      }

      const user = requestedUser ?? await this.dependencies.storePurchaseRepository.findUserForUpdate(userId, client);
      if (user === null) {
        throw new NotFoundError('Account was not found');
      }
      this.assertAccountBinding(verified, user.id);

      const transition = existing === null
        ? { state: verified.state, observedAt: verified.observedAt, ignoredAsStale: false }
        : transitionStorePurchaseState({
            currentState: existing.state,
            currentObservedAt: existing.lastObservedAt,
            incomingState: verified.state,
            incomingObservedAt: verified.observedAt,
          });
      if (existing !== null && !isCompatibleProduct(existing, product, verified.productId)) {
        throw new ValidationError('Store purchase could not be verified');
      }
      const purchase = existing === null
        ? await this.dependencies.storePurchaseRepository.createPurchase(
            {
              userId: user.id,
              store: verified.store,
              environment: verified.environment,
              externalPurchaseKey,
              productId: verified.productId,
              kind: product.kind,
              planCode: product.kind === 'subscription' ? product.planCode : null,
              creditPackageCode: product.kind === 'credit_pack' ? product.creditPackageCode : null,
              state: transition.state,
              transactionKey,
              expiresAt: verified.expiresAt,
              autoRenewEnabled: verified.autoRenewEnabled,
              lastObservedAt: transition.observedAt,
            },
            client,
          )
        : transition.ignoredAsStale
          ? existing
          : await this.dependencies.storePurchaseRepository.updatePurchase(
              existing.id,
              {
                productId: verified.productId,
                kind: product.kind,
                planCode: product.kind === 'subscription' ? product.planCode : null,
                creditPackageCode: product.kind === 'credit_pack' ? product.creditPackageCode : null,
                state: transition.state,
                transactionKey,
                expiresAt: verified.expiresAt,
                autoRenewEnabled: verified.autoRenewEnabled,
                lastObservedAt: transition.observedAt,
              },
              client,
            );

      const effectiveProduct = transition.ignoredAsStale
        ? this.dependencies.productCatalog.resolve(purchase.store, purchase.productId)
        : product;
      if (effectiveProduct === null) {
        throw new ValidationError('Store purchase could not be verified');
      }

      const effectiveTransactionKey = purchase.transactionKey;
      const operation = operationForPurchase(purchase, effectiveTransactionKey);
      const eventRecorded = await this.dependencies.storePurchaseRepository.recordEventIfNew(
        {
          purchaseId: purchase.id,
          store: verified.store,
          eventKey,
          transactionKey: operation === 'observe' ? null : effectiveTransactionKey,
          operation,
          providerEventType: verified.providerEventType,
          state: purchase.state,
          occurredAt: verified.observedAt,
        },
        client,
      );

      let creditsChanged = 0;
      if (eventRecorded && operation === 'grant') {
        creditsChanged = await this.grantCredits(purchase, effectiveProduct, effectiveTransactionKey, client);
      } else if (eventRecorded && operation === 'reverse') {
        creditsChanged = await this.reverseCredits(purchase, effectiveProduct, effectiveTransactionKey, client);
      }

      if (purchase.kind === 'subscription' && !transition.ignoredAsStale) {
        const effectivePlan = await this.dependencies.storePurchaseRepository.resolvePersonalPlan(user.id, client);
        await this.dependencies.storePurchaseRepository.updatePersonalPlan(user.id, effectivePlan ?? 'free', client);
      }

      return toResult(purchase, creditsChanged, !eventRecorded);
    });

    if (result === null) {
      return unavailableWebhookResult(verified.store, product);
    }

    return result;
  }

  private async grantCredits(
    purchase: StorePurchaseRecord,
    product: StoreProductDefinition,
    transactionKey: string | null,
    client: DatabaseClient,
  ): Promise<number> {
    if (transactionKey === null) {
      throw new ValidationError('Store purchase could not be verified');
    }
    if (
      product.kind === 'subscription' &&
      (await this.dependencies.storePurchaseRepository.hasActiveStripeConsumerSubscription(purchase.userId, client))
    ) {
      return 0;
    }

    const eventKey = createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      `${purchase.store}:credit-grant`,
      transactionKey,
    );

    if (product.kind === 'credit_pack') {
      const amount = CREDIT_PACKAGE_DEFINITIONS[product.creditPackageCode].purchasedCredits;
      await this.billingCreditGrantService.grantPurchasedCredits(
        {
          userId: purchase.userId,
          amount,
          description: 'Mobile store credit purchase',
          mobileStoreEventKey: eventKey,
        },
        client,
      );
      await this.dependencies.storePurchaseRepository.addGrantedCredits(purchase.id, amount, client);
      return amount;
    }

    const amount = SUBSCRIPTION_PLAN_DEFINITIONS[product.planCode].monthlyCredits;
    await this.billingCreditGrantService.grantMonthlyCredits(
      {
        userId: purchase.userId,
        amount,
        expiresAt: purchase.expiresAt,
        description: 'Mobile store subscription allowance',
        mobileStoreEventKey: eventKey,
      },
      client,
    );
    await this.dependencies.storePurchaseRepository.addGrantedCredits(purchase.id, amount, client);
    return amount;
  }

  private async reverseCredits(
    purchase: StorePurchaseRecord,
    product: StoreProductDefinition,
    transactionKey: string | null,
    client: DatabaseClient,
  ): Promise<number> {
    if (transactionKey === null) {
      return 0;
    }

    const outstanding = Math.max(0, purchase.grantedCredits - purchase.reversedCredits);
    if (outstanding === 0) {
      return 0;
    }
    const current = normalizeExpiredMonthlyCredits(
      (await this.dependencies.creditRepository.getBalanceForUpdate(purchase.userId, client)) ?? emptyBalance(purchase.userId),
      this.clock(),
    );
    const eventKey = createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      `${purchase.store}:credit-reversal`,
      transactionKey,
    );

    const amount = product.kind === 'credit_pack'
      ? Math.min(outstanding, current.purchasedCredits)
      : canReverseSubscriptionAllowance(purchase, current)
        ? Math.min(outstanding, current.monthlyCredits)
        : 0;
    if (amount === 0) {
      return 0;
    }

    const next: CreditBalance = product.kind === 'credit_pack'
      ? { ...current, purchasedCredits: current.purchasedCredits - amount }
      : { ...current, monthlyCredits: current.monthlyCredits - amount };
    const saved = await this.dependencies.creditRepository.updateBalance(next, client);
    await this.dependencies.creditRepository.insertLedger(
      createCreditLedgerEntry({
        userId: purchase.userId,
        type: 'purchase_reversal',
        amount: -amount,
        monthlyDelta: product.kind === 'subscription' ? -amount : 0,
        purchasedDelta: product.kind === 'credit_pack' ? -amount : 0,
        balance: saved,
        description: 'Mobile store purchase reversal',
        mobileStoreEventKey: eventKey,
      }),
      client,
    );
    await this.dependencies.storePurchaseRepository.addReversedCredits(purchase.id, amount, client);
    return -amount;
  }

  private async applyGoogleVoidedPurchase(input: {
    purchaseToken: string;
    orderId: string | null;
    eventId: string;
    occurredAt: Date;
  }): Promise<void> {
    const externalPurchaseKey = createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      'google:external-purchase',
      input.purchaseToken,
    );
    const eventKey = createStoreIdentifierKey(this.dependencies.identifierSecret, 'google:event', input.eventId);
    const transactionKey = input.orderId === null
      ? null
      : createStoreIdentifierKey(this.dependencies.identifierSecret, 'google:transaction', input.orderId);

    await this.dependencies.storePurchaseRepository.transaction(async (client) => {
      const existing = await this.dependencies.storePurchaseRepository.findPurchaseForUpdate(
        'google',
        externalPurchaseKey,
        client,
      );
      if (existing === null) {
        await this.recordUnknownStoreEvent({
          store: 'google',
          eventKey,
          state: 'refunded',
          occurredAt: input.occurredAt,
          providerEventType: 'google.voided_purchase',
          client,
        });
        return;
      }

      const transition = transitionStorePurchaseState({
        currentState: existing.state,
        currentObservedAt: existing.lastObservedAt,
        incomingState: 'refunded',
        incomingObservedAt: input.occurredAt,
      });
      const purchase = transition.ignoredAsStale
        ? existing
        : await this.dependencies.storePurchaseRepository.updatePurchase(
            existing.id,
            {
              productId: existing.productId,
              kind: existing.kind,
              planCode: existing.planCode,
              creditPackageCode: existing.creditPackageCode,
              state: transition.state,
              transactionKey,
              expiresAt: existing.expiresAt,
              autoRenewEnabled: existing.autoRenewEnabled,
              lastObservedAt: transition.observedAt,
            },
            client,
          );
      const product = this.dependencies.productCatalog.resolve('google', purchase.productId);
      if (product === null) {
        return;
      }
      const eventRecorded = await this.dependencies.storePurchaseRepository.recordEventIfNew(
        {
          purchaseId: purchase.id,
          store: 'google',
          eventKey,
          transactionKey,
          operation: 'reverse',
          providerEventType: 'google.voided_purchase',
          state: purchase.state,
          occurredAt: input.occurredAt,
        },
        client,
      );
      if (eventRecorded) {
        await this.reverseCredits(purchase, product, purchase.transactionKey, client);
      }
      if (purchase.kind === 'subscription' && !transition.ignoredAsStale) {
        const effectivePlan = await this.dependencies.storePurchaseRepository.resolvePersonalPlan(purchase.userId, client);
        await this.dependencies.storePurchaseRepository.updatePersonalPlan(purchase.userId, effectivePlan ?? 'free', client);
      }
    });
  }

  private async recordUnknownGoogleEvent(input: {
    eventId: string;
    state: StorePurchaseState;
    occurredAt: Date;
    providerEventType: string;
  }): Promise<void> {
    const eventKey = createStoreIdentifierKey(this.dependencies.identifierSecret, 'google:event', input.eventId);
    await this.dependencies.storePurchaseRepository.transaction((client) =>
      this.recordUnknownStoreEvent({
        store: 'google',
        eventKey,
        state: input.state,
        occurredAt: input.occurredAt,
        providerEventType: input.providerEventType,
        client,
      }),
    );
  }

  private async recordUnknownStoreEvent(input: {
    store: StorePurchaseStore;
    eventKey: string;
    state: StorePurchaseState;
    occurredAt: Date;
    providerEventType: string;
    client: DatabaseClient;
  }): Promise<void> {
    await this.dependencies.storePurchaseRepository.recordEventIfNew(
      {
        purchaseId: null,
        store: input.store,
        eventKey: input.eventKey,
        transactionKey: null,
        operation: 'observe',
        providerEventType: input.providerEventType,
        state: input.state,
        occurredAt: input.occurredAt,
      },
      input.client,
    );
  }

  private assertAccountBinding(verified: VerifiedStorePurchase, userId: string): void {
    const expected = verified.store === 'apple'
      ? userId
      : createGooglePlayObfuscatedAccountId(this.dependencies.identifierSecret, userId);
    if (verified.accountBinding === null || verified.accountBinding !== expected) {
      throw new ForbiddenError('Store purchase account binding does not match');
    }
  }
}

function operationForPurchase(
  purchase: StorePurchaseRecord,
  transactionKey: string | null,
): 'observe' | 'grant' | 'reverse' {
  if (purchase.state === 'active' && transactionKey !== null) {
    return 'grant';
  }
  if ((purchase.state === 'refunded' || purchase.state === 'revoked') && transactionKey !== null) {
    return 'reverse';
  }
  return 'observe';
}

function isCompatibleProduct(
  existing: StorePurchaseRecord,
  product: StoreProductDefinition,
  productId: string,
): boolean {
  const isSameProduct = (
    existing.productId === productId &&
    existing.kind === product.kind &&
    existing.planCode === (product.kind === 'subscription' ? product.planCode : null) &&
    existing.creditPackageCode === (product.kind === 'credit_pack' ? product.creditPackageCode : null)
  );
  if (isSameProduct) {
    return true;
  }

  return existing.kind === 'subscription' && product.kind === 'subscription';
}

function emptyBalance(userId: string): CreditBalance {
  return {
    userId,
    monthlyCredits: 0,
    purchasedCredits: 0,
    monthlyExpiresAt: null,
  };
}

function createCreditLedgerEntry(input: {
  userId: string;
  type: CreditLedgerEntry['type'];
  amount: number;
  monthlyDelta: number;
  purchasedDelta: number;
  balance: CreditBalance;
  description: string;
  mobileStoreEventKey: string;
}): CreditLedgerEntry {
  return {
    userId: input.userId,
    type: input.type,
    amount: input.amount,
    monthlyDelta: input.monthlyDelta,
    purchasedDelta: input.purchasedDelta,
    monthlyAfter: input.balance.monthlyCredits,
    purchasedAfter: input.balance.purchasedCredits,
    description: input.description,
    mobileStoreEventKey: input.mobileStoreEventKey,
  };
}

function canReverseSubscriptionAllowance(purchase: StorePurchaseRecord, balance: CreditBalance): boolean {
  return (
    purchase.expiresAt !== null &&
    balance.monthlyExpiresAt !== null &&
    purchase.expiresAt.getTime() === balance.monthlyExpiresAt.getTime()
  );
}

function toResult(
  purchase: StorePurchaseRecord,
  creditsChanged: number,
  isDuplicate: boolean,
): MobileStorePurchaseResult {
  return {
    store: purchase.store,
    state: purchase.state,
    productKind: purchase.kind,
    planCode: purchase.planCode,
    creditPackageCode: purchase.creditPackageCode,
    creditsChanged,
    isDuplicate,
  };
}

function unavailableWebhookResult(
  store: StorePurchaseStore,
  product: StoreProductDefinition,
): MobileStorePurchaseResult {
  return {
    store,
    state: 'pending',
    productKind: product.kind,
    planCode: product.kind === 'subscription' ? product.planCode : null,
    creditPackageCode: product.kind === 'credit_pack' ? product.creditPackageCode : null,
    creditsChanged: 0,
    isDuplicate: true,
  };
}

const googleRtdnSchema = z
  .object({
    version: z.string().trim().min(1).max(32).optional(),
    packageName: z.string().min(1),
    eventTimeMillis: z.string().optional(),
    subscriptionNotification: z
      .object({
        version: z.string().trim().min(1).max(32).optional(),
        notificationType: z.number().int(),
        purchaseToken: z.string().min(1),
      })
      .strict()
      .optional(),
    oneTimeProductNotification: z
      .object({
        version: z.string().trim().min(1).max(32).optional(),
        notificationType: z.number().int(),
        purchaseToken: z.string().min(1),
        sku: z.string().trim().min(1).max(512).optional(),
      })
      .strict()
      .optional(),
    voidedPurchaseNotification: z
      .object({
        purchaseToken: z.string().min(1),
        orderId: z.string().min(1).optional(),
        productType: z.number().int().optional(),
        refundType: z.number().int().optional(),
      })
      .strict()
      .optional(),
    testNotification: z
      .object({
        version: z.string().trim().min(1).max(32).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type ParsedGoogleRtdn =
  | {
      kind: 'subscription' | 'one_time';
      packageName: string;
      purchaseToken: string;
      overrideState: StorePurchaseState | null;
      providerEventType: string;
      eventTime: Date | null;
    }
  | {
      kind: 'voided';
      packageName: string;
      purchaseToken: string;
      orderId: string | null;
      eventTime: Date | null;
    }
  | {
      kind: 'test';
      packageName: string;
      eventTime: Date | null;
    };

function parseGoogleRtdn(encodedData: string): ParsedGoogleRtdn {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8')) as unknown;
  } catch {
    throw new ValidationError('Store notification could not be verified');
  }
  const parsed = googleRtdnSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ValidationError('Store notification could not be verified');
  }

  const eventTime = parseGoogleEventTime(parsed.data.eventTimeMillis);
  if (parsed.data.subscriptionNotification !== undefined) {
    return {
      kind: 'subscription',
      packageName: parsed.data.packageName,
      purchaseToken: parsed.data.subscriptionNotification.purchaseToken,
      overrideState: googleSubscriptionState(parsed.data.subscriptionNotification.notificationType),
      providerEventType: `google.subscription.${parsed.data.subscriptionNotification.notificationType}`,
      eventTime,
    };
  }
  if (parsed.data.oneTimeProductNotification !== undefined) {
    return {
      kind: 'one_time',
      packageName: parsed.data.packageName,
      purchaseToken: parsed.data.oneTimeProductNotification.purchaseToken,
      overrideState: parsed.data.oneTimeProductNotification.notificationType === 2 ? 'cancelled' : null,
      providerEventType: `google.one_time.${parsed.data.oneTimeProductNotification.notificationType}`,
      eventTime,
    };
  }
  if (parsed.data.voidedPurchaseNotification !== undefined) {
    return {
      kind: 'voided',
      packageName: parsed.data.packageName,
      purchaseToken: parsed.data.voidedPurchaseNotification.purchaseToken,
      orderId: parsed.data.voidedPurchaseNotification.orderId ?? null,
      eventTime,
    };
  }
  if (parsed.data.testNotification !== undefined) {
    return { kind: 'test', packageName: parsed.data.packageName, eventTime };
  }

  throw new ValidationError('Store notification could not be verified');
}

function parseGoogleEventTime(value: string | undefined): Date | null {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return null;
  }
  const milliseconds = Number(value);
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function googleSubscriptionState(notificationType: number): StorePurchaseState | null {
  switch (notificationType) {
    case 3:
    case 18:
      return 'cancelled';
    case 5:
    case 10:
      return 'pending';
    case 20:
      return 'cancelled';
    case 12:
      return 'revoked';
    case 13:
      return 'expired';
    default:
      return null;
  }
}
