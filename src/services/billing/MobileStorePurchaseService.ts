import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  SUBSCRIPTION_PLAN_DEFINITIONS,
  type ConsumerPaidPlanCode,
  type CreditPackageCode,
} from '../../domain/constants/billing.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
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
import type {
  PersonalSubscriptionSummary,
} from '../../domain/types/billing.js';
import type { CreditBalance, CreditLedgerEntry } from '../../domain/types/credit.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { CreditRepository } from '../../repositories/CreditRepository.js';
import type {
  StorePurchaseRecord,
  StorePurchaseRepository,
} from '../../repositories/StorePurchaseRepository.js';
import { BillingCreditGrantService } from '../credit/BillingCreditGrantService.js';
import {
  normalizeExpiredMonthlyCredits,
  systemClock,
  type Clock,
} from '../credit/CreditBalanceExpiration.js';

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

export interface GoogleProviderCompletionInput {
  purchaseToken: string;
  productId: string;
  completion: 'acknowledge' | 'consume';
}

export interface GooglePlayPurchaseVerifierPort {
  verifyPurchase(input: { purchaseToken: string }): Promise<VerifiedStorePurchase>;
  completePurchase(input: GoogleProviderCompletionInput): Promise<void>;
}

export interface MobileStorePurchaseServicePort {
  listProducts(store: StorePurchaseStore): readonly StoreProductDefinition[];
  getAccountBinding(userId: string): Promise<MobileStoreAccountBinding>;
  getPersonalSubscriptionSummary(
    userId: string,
  ): Promise<PersonalSubscriptionSummary | null>;
  verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<MobileStorePurchaseResult>;
  verifyGooglePurchase(input: {
    userId: string;
    purchaseToken: string;
  }): Promise<MobileStorePurchaseResult>;
  restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]>;
  handleAppleNotification(signedPayload: string): Promise<void>;
  handleGoogleRtdn(input: {
    messageId: string;
    data: string;
    publishTime: Date | null;
  }): Promise<void>;
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
  googlePackageName: string;
  clock?: Clock;
}

export class MobileStorePurchaseService implements MobileStorePurchaseServicePort {
  private readonly clock: Clock;
  private readonly billingCreditGrantService: BillingCreditGrantService;

  public constructor(private readonly dependencies: MobileStorePurchaseServiceDependencies) {
    this.clock = dependencies.clock ?? systemClock;
    this.billingCreditGrantService = new BillingCreditGrantService(
      dependencies.creditRepository,
      this.clock,
    );
  }

  public listProducts(store: StorePurchaseStore): readonly StoreProductDefinition[] {
    return this.dependencies.productCatalog
      .entries()
      .filter((product) => product.store === store);
  }

  public async getAccountBinding(userId: string): Promise<MobileStoreAccountBinding> {
    return this.dependencies.storePurchaseRepository.transaction(async (client) => {
      const user = await this.dependencies.storePurchaseRepository.findUserForUpdate(
        userId,
        client,
      );
      if (user === null) {
        throw new NotFoundError('Account was not found');
      }
      const hasStripeSubscription =
        await this.dependencies.storePurchaseRepository.hasActiveStripeConsumerSubscription(
          user.id,
          client,
        );

      return {
        appleAppAccountToken: user.id,
        googleObfuscatedAccountId: createGooglePlayObfuscatedAccountId(
          this.dependencies.identifierSecret,
          user.id,
        ),
        subscriptionPurchaseAllowed: !hasStripeSubscription,
      };
    });
  }

  public async getPersonalSubscriptionSummary(
    userId: string,
  ): Promise<PersonalSubscriptionSummary | null> {
    const record =
      await this.dependencies.storePurchaseRepository.findLatestStoreSubscriptionForUser(
        userId,
      );
    if (record === null) {
      return null;
    }

    return {
      planCode: record.planCode,
      status: record.state === 'cancelled' ? 'canceled' : 'active',
      currentPeriodEnd: record.expiresAt,
      cancelAtPeriodEnd:
        record.state === 'cancelled' || record.autoRenewEnabled === false,
    };
  }

  public async verifyApplePurchase(input: {
    userId: string;
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<MobileStorePurchaseResult> {
    if (input.environment === 'sandbox' && !this.dependencies.allowAppleSandbox) {
      throw new ValidationError('Store purchase could not be verified');
    }
    const verified = await this.dependencies.appleVerifier.verifyTransaction({
      signedTransaction: input.signedTransaction,
      environment: input.environment,
    });
    if (verified.store !== 'apple' || verified.environment !== input.environment) {
      throw new ValidationError('Store purchase could not be verified');
    }

    return this.applyVerifiedPurchase(verified, input.userId);
  }

  public async verifyGooglePurchase(input: {
    userId: string;
    purchaseToken: string;
  }): Promise<MobileStorePurchaseResult> {
    const verified = await this.dependencies.googleVerifier.verifyPurchase({
      purchaseToken: input.purchaseToken,
    });
    this.assertAllowedGooglePurchase(verified);
    const result = await this.applyVerifiedPurchase(verified, input.userId);
    await this.completeGooglePurchase(input.purchaseToken, verified);
    return result;
  }

  public async restorePurchases(input: {
    userId: string;
    appleSignedTransactions: string[];
    googlePurchaseTokens: string[];
  }): Promise<MobileStorePurchaseResult[]> {
    const results: MobileStorePurchaseResult[] = [];

    for (const signedTransaction of input.appleSignedTransactions) {
      const verified = await this.verifyAppleRestoreTransaction(signedTransaction);
      results.push(await this.applyVerifiedPurchase(verified, input.userId));
    }

    for (const purchaseToken of input.googlePurchaseTokens) {
      const verified = await this.dependencies.googleVerifier.verifyPurchase({
        purchaseToken,
      });
      this.assertAllowedGooglePurchase(verified);
      results.push(await this.applyVerifiedPurchase(verified, input.userId));
      await this.completeGooglePurchase(purchaseToken, verified);
    }

    return results;
  }

  public async handleAppleNotification(signedPayload: string): Promise<void> {
    const verified =
      await this.dependencies.appleVerifier.verifyNotification(signedPayload);
    if (
      verified === null ||
      (verified.environment === 'sandbox' && !this.dependencies.allowAppleSandbox)
    ) {
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

    if (notification.kind === 'test' || notification.kind === 'refund_review') {
      await this.recordUnknownGoogleEvent({
        eventId: input.messageId,
        state: 'pending',
        occurredAt,
        providerEventType:
          notification.kind === 'test'
            ? 'google.test_notification'
            : 'google.pending_refund_review',
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
    if (
      notification.kind !== 'subscription' &&
      notification.kind !== 'one_time'
    ) {
      return;
    }

    const verified = await this.dependencies.googleVerifier.verifyPurchase({
      purchaseToken: notification.purchaseToken,
    });
    this.assertAllowedGooglePurchase(verified);
    await this.applyVerifiedPurchase(
      {
        ...verified,
        eventId: input.messageId,
        observedAt: occurredAt,
        providerEventType: notification.providerEventType,
      },
      null,
    );
    await this.completeGooglePurchase(notification.purchaseToken, verified);
  }

  private async verifyAppleRestoreTransaction(
    signedTransaction: string,
  ): Promise<VerifiedStorePurchase> {
    const environments: StorePurchaseEnvironment[] = ['production'];
    if (this.dependencies.allowAppleSandbox) {
      environments.push('sandbox');
    }

    let lastError: unknown = null;
    for (const environment of environments) {
      try {
        const verified = await this.dependencies.appleVerifier.verifyTransaction({
          signedTransaction,
          environment,
        });
        if (verified.store === 'apple' && verified.environment === environment) {
          return verified;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw new ValidationError('Store purchase could not be verified');
    }
    throw new ValidationError('Store purchase could not be verified');
  }

  private assertAllowedGooglePurchase(verified: VerifiedStorePurchase): void {
    if (
      verified.store !== 'google' ||
      (verified.isTestPurchase && !this.dependencies.allowGoogleTestPurchases)
    ) {
      throw new ValidationError('Store purchase could not be verified');
    }
  }

  private async completeGooglePurchase(
    purchaseToken: string,
    verified: VerifiedStorePurchase,
  ): Promise<void> {
    if (verified.providerCompletion === 'none' || verified.state !== 'active') {
      return;
    }
    await this.dependencies.googleVerifier.completePurchase({
      purchaseToken,
      productId: verified.productId,
      completion: verified.providerCompletion,
    });
  }

  private async applyVerifiedPurchase(
    verified: VerifiedStorePurchase,
    requestedUserId: string | null,
  ): Promise<MobileStorePurchaseResult> {
    const product = this.dependencies.productCatalog.resolve(
      verified.store,
      verified.productId,
    );
    if (product === null) {
      throw new ValidationError('Store purchase could not be verified');
    }

    const externalPurchaseKey = this.key(
      `${verified.store}:external-purchase`,
      verified.externalPurchaseId,
    );
    const linkedPurchaseKey =
      verified.linkedExternalPurchaseId === null
        ? null
        : this.key(
            `${verified.store}:external-purchase`,
            verified.linkedExternalPurchaseId,
          );
    const transactionKey =
      verified.transactionId === null
        ? null
        : this.key(`${verified.store}:transaction`, verified.transactionId);
    const eventKey = this.key(
      `${verified.store}:event`,
      verified.eventId ??
        `${verified.transactionId ?? verified.externalPurchaseId}:${verified.state}:${verified.observedAt.toISOString()}`,
    );

    const result = await this.dependencies.storePurchaseRepository.transaction(
      async (client) => {
        await this.lockPurchaseKeys(
          verified.store,
          [externalPurchaseKey, linkedPurchaseKey],
          client,
        );
        const requestedUser =
          requestedUserId === null
            ? null
            : await this.dependencies.storePurchaseRepository.findUserForUpdate(
                requestedUserId,
                client,
              );
        if (requestedUserId !== null && requestedUser === null) {
          throw new NotFoundError('Account was not found');
        }

        const existing =
          await this.dependencies.storePurchaseRepository.findPurchaseForUpdate(
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
        if (
          existing !== null &&
          requestedUserId !== null &&
          existing.userId !== requestedUserId
        ) {
          throw new ForbiddenError('Store purchase belongs to another account');
        }
        const user =
          requestedUser ??
          (await this.dependencies.storePurchaseRepository.findUserForUpdate(
            userId,
            client,
          ));
        if (user === null) {
          throw new NotFoundError('Account was not found');
        }
        this.assertAccountBinding(verified, user.id);

        if (
          product.kind === 'subscription' &&
          (await this.dependencies.storePurchaseRepository.hasActiveStripeConsumerSubscription(
            user.id,
            client,
          ))
        ) {
          throw new ConflictError(
            'Account already has an active Stripe subscription',
          );
        }
        if (
          existing !== null &&
          !isSameProduct(existing, product, verified.productId)
        ) {
          throw new ValidationError('Store purchase could not be verified');
        }

        if (linkedPurchaseKey !== null && linkedPurchaseKey !== externalPurchaseKey) {
          await this.expireLinkedPurchase({
            store: verified.store,
            linkedPurchaseKey,
            userId: user.id,
            observedAt: verified.observedAt,
            eventSeed: verified.externalPurchaseId,
            client,
          });
        }

        if (
          existing !== null &&
          isHistoricalSubscriptionTerminal(existing, transactionKey, verified.state)
        ) {
          return this.applyHistoricalSubscriptionTerminal({
            existing,
            product,
            verified,
            transactionKey,
            eventKey,
            client,
          });
        }

        const transition =
          existing === null
            ? {
                state: verified.state,
                observedAt: verified.observedAt,
                ignoredAsStale: false,
              }
            : transitionStorePurchaseState({
                currentState: existing.state,
                currentObservedAt: existing.lastObservedAt,
                incomingState: verified.state,
                incomingObservedAt: verified.observedAt,
              });
        const purchase =
          existing === null
            ? await this.dependencies.storePurchaseRepository.createPurchase(
                {
                  userId: user.id,
                  store: verified.store,
                  environment: verified.environment,
                  externalPurchaseKey,
                  productId: verified.productId,
                  kind: product.kind,
                  planCode:
                    product.kind === 'subscription' ? product.planCode : null,
                  creditPackageCode:
                    product.kind === 'credit_pack'
                      ? product.creditPackageCode
                      : null,
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
                    state: transition.state,
                    transactionKey,
                    expiresAt: verified.expiresAt,
                    autoRenewEnabled: verified.autoRenewEnabled,
                    lastObservedAt: transition.observedAt,
                  },
                  client,
                );

        const effectiveTransactionKey = purchase.transactionKey;
        const operation = operationForPurchase(purchase, effectiveTransactionKey);
        const eventRecorded =
          await this.dependencies.storePurchaseRepository.recordEventIfNew(
            {
              purchaseId: purchase.id,
              store: verified.store,
              eventKey,
              transactionKey:
                operation === 'observe' ? null : effectiveTransactionKey,
              operation,
              providerEventType: verified.providerEventType,
              state: purchase.state,
              occurredAt: verified.observedAt,
            },
            client,
          );

        let creditsChanged = 0;
        if (eventRecorded && operation === 'grant') {
          creditsChanged = await this.grantCredits(
            purchase,
            product,
            effectiveTransactionKey,
            client,
          );
        } else if (eventRecorded && operation === 'reverse') {
          creditsChanged = await this.reverseCredits(
            purchase,
            product,
            effectiveTransactionKey,
            client,
          );
        }

        if (purchase.kind === 'subscription' && !transition.ignoredAsStale) {
          await this.refreshPersonalPlan(user.id, client);
        }

        return toResult(purchase, creditsChanged, !eventRecorded);
      },
    );

    return result ?? unavailableWebhookResult(verified.store, product);
  }

  private async expireLinkedPurchase(input: {
    store: StorePurchaseStore;
    linkedPurchaseKey: string;
    userId: string;
    observedAt: Date;
    eventSeed: string;
    client: DatabaseClient;
  }): Promise<void> {
    const linked =
      await this.dependencies.storePurchaseRepository.findPurchaseForUpdate(
        input.store,
        input.linkedPurchaseKey,
        input.client,
      );
    if (linked === null) {
      return;
    }
    if (linked.userId !== input.userId) {
      throw new ForbiddenError('Linked store purchase belongs to another account');
    }
    if (linked.kind !== 'subscription' || linked.state === 'expired') {
      return;
    }

    const updated = await this.dependencies.storePurchaseRepository.updatePurchase(
      linked.id,
      {
        state: 'expired',
        transactionKey: linked.transactionKey,
        expiresAt: input.observedAt,
        autoRenewEnabled: false,
        lastObservedAt: input.observedAt,
      },
      input.client,
    );
    await this.dependencies.storePurchaseRepository.recordEventIfNew(
      {
        purchaseId: updated.id,
        store: input.store,
        eventKey: this.key(
          `${input.store}:event`,
          `linked-replaced:${input.eventSeed}`,
        ),
        transactionKey: null,
        operation: 'observe',
        providerEventType: 'google.linked_purchase_replaced',
        state: 'expired',
        occurredAt: input.observedAt,
      },
      input.client,
    );
  }

  private async applyHistoricalSubscriptionTerminal(input: {
    existing: StorePurchaseRecord;
    product: StoreProductDefinition;
    verified: VerifiedStorePurchase;
    transactionKey: string | null;
    eventKey: string;
    client: DatabaseClient;
  }): Promise<MobileStorePurchaseResult> {
    const eventRecorded =
      await this.dependencies.storePurchaseRepository.recordEventIfNew(
        {
          purchaseId: input.existing.id,
          store: input.verified.store,
          eventKey: input.eventKey,
          transactionKey: input.transactionKey,
          operation: 'reverse',
          providerEventType: input.verified.providerEventType,
          state: input.verified.state,
          occurredAt: input.verified.observedAt,
        },
        input.client,
      );
    const creditsChanged = eventRecorded
      ? await this.reverseCredits(
          { ...input.existing, expiresAt: input.verified.expiresAt },
          input.product,
          input.transactionKey,
          input.client,
        )
      : 0;

    return {
      ...toResult(input.existing, creditsChanged, !eventRecorded),
      state: input.verified.state,
    };
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
    const ledgerEventKey = this.key(
      `${purchase.store}:credit-grant`,
      transactionKey,
    );

    if (product.kind === 'credit_pack') {
      const amount =
        CREDIT_PACKAGE_DEFINITIONS[product.creditPackageCode].purchasedCredits;
      await this.billingCreditGrantService.grantPurchasedCredits(
        {
          userId: purchase.userId,
          amount,
          description: 'Mobile store credit purchase',
          mobileStoreEventKey: ledgerEventKey,
        },
        client,
      );
      await this.dependencies.storePurchaseRepository.addGrantedCredits(
        purchase.id,
        amount,
        client,
      );
      return amount;
    }

    const amount = SUBSCRIPTION_PLAN_DEFINITIONS[product.planCode].monthlyCredits;
    await this.billingCreditGrantService.grantMonthlyCredits(
      {
        userId: purchase.userId,
        amount,
        expiresAt: purchase.expiresAt,
        description: 'Mobile store subscription allowance',
        mobileStoreEventKey: ledgerEventKey,
      },
      client,
    );
    await this.dependencies.storePurchaseRepository.addGrantedCredits(
      purchase.id,
      amount,
      client,
    );
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
    const outstanding = Math.max(
      0,
      purchase.grantedCredits - purchase.reversedCredits,
    );
    if (outstanding === 0) {
      return 0;
    }

    const current = normalizeExpiredMonthlyCredits(
      (await this.dependencies.creditRepository.getBalanceForUpdate(
        purchase.userId,
        client,
      )) ?? emptyBalance(purchase.userId),
      this.clock(),
    );
    const amount =
      product.kind === 'credit_pack'
        ? Math.min(outstanding, current.purchasedCredits)
        : canReverseSubscriptionAllowance(purchase, current)
          ? Math.min(outstanding, current.monthlyCredits)
          : 0;
    if (amount === 0) {
      return 0;
    }

    const next: CreditBalance =
      product.kind === 'credit_pack'
        ? { ...current, purchasedCredits: current.purchasedCredits - amount }
        : { ...current, monthlyCredits: current.monthlyCredits - amount };
    const saved = await this.dependencies.creditRepository.updateBalance(next, client);
    await this.dependencies.creditRepository.insertLedger(
      createCreditLedgerEntry({
        userId: purchase.userId,
        amount: -amount,
        monthlyDelta: product.kind === 'subscription' ? -amount : 0,
        purchasedDelta: product.kind === 'credit_pack' ? -amount : 0,
        balance: saved,
        mobileStoreEventKey: this.key(
          `${purchase.store}:credit-reversal`,
          transactionKey,
        ),
      }),
      client,
    );
    await this.dependencies.storePurchaseRepository.addReversedCredits(
      purchase.id,
      amount,
      client,
    );
    return -amount;
  }

  private async applyGoogleVoidedPurchase(input: {
    purchaseToken: string;
    orderId: string | null;
    eventId: string;
    occurredAt: Date;
  }): Promise<void> {
    const externalPurchaseKey = this.key(
      'google:external-purchase',
      input.purchaseToken,
    );
    const eventKey = this.key('google:event', input.eventId);
    const transactionKey =
      input.orderId === null
        ? null
        : this.key('google:transaction', input.orderId);

    await this.dependencies.storePurchaseRepository.transaction(async (client) => {
      await this.dependencies.storePurchaseRepository.lockPurchaseKey(
        'google',
        externalPurchaseKey,
        client,
      );
      const existing =
        await this.dependencies.storePurchaseRepository.findPurchaseForUpdate(
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

      const product = this.dependencies.productCatalog.resolve(
        'google',
        existing.productId,
      );
      if (product === null) {
        return;
      }
      if (
        existing.kind === 'subscription' &&
        transactionKey !== null &&
        existing.transactionKey !== null &&
        transactionKey !== existing.transactionKey
      ) {
        const eventRecorded =
          await this.dependencies.storePurchaseRepository.recordEventIfNew(
            {
              purchaseId: existing.id,
              store: 'google',
              eventKey,
              transactionKey,
              operation: 'reverse',
              providerEventType: 'google.voided_purchase',
              state: 'refunded',
              occurredAt: input.occurredAt,
            },
            client,
          );
        if (eventRecorded) {
          await this.reverseCredits(existing, product, transactionKey, client);
        }
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
              state: transition.state,
              transactionKey,
              expiresAt: existing.expiresAt,
              autoRenewEnabled: existing.autoRenewEnabled,
              lastObservedAt: transition.observedAt,
            },
            client,
          );
      const eventRecorded =
        await this.dependencies.storePurchaseRepository.recordEventIfNew(
          {
            purchaseId: purchase.id,
            store: 'google',
            eventKey,
            transactionKey: transactionKey ?? purchase.transactionKey,
            operation: 'reverse',
            providerEventType: 'google.voided_purchase',
            state: purchase.state,
            occurredAt: input.occurredAt,
          },
          client,
        );
      if (eventRecorded) {
        await this.reverseCredits(
          purchase,
          product,
          transactionKey ?? purchase.transactionKey,
          client,
        );
      }
      if (purchase.kind === 'subscription' && !transition.ignoredAsStale) {
        await this.refreshPersonalPlan(purchase.userId, client);
      }
    });
  }

  private async refreshPersonalPlan(
    userId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const effectivePlan =
      await this.dependencies.storePurchaseRepository.resolvePersonalPlan(
        userId,
        client,
      );
    await this.dependencies.storePurchaseRepository.updatePersonalPlan(
      userId,
      effectivePlan ?? 'free',
      client,
    );
  }

  private async recordUnknownGoogleEvent(input: {
    eventId: string;
    state: StorePurchaseState;
    occurredAt: Date;
    providerEventType: string;
  }): Promise<void> {
    const eventKey = this.key('google:event', input.eventId);
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

  private assertAccountBinding(
    verified: VerifiedStorePurchase,
    userId: string,
  ): void {
    const expected =
      verified.store === 'apple'
        ? userId
        : createGooglePlayObfuscatedAccountId(
            this.dependencies.identifierSecret,
            userId,
          );
    if (verified.accountBinding === null || verified.accountBinding !== expected) {
      throw new ForbiddenError('Store purchase account binding does not match');
    }
  }

  private async lockPurchaseKeys(
    store: StorePurchaseStore,
    keys: Array<string | null>,
    client: DatabaseClient,
  ): Promise<void> {
    const uniqueKeys = [...new Set(keys.filter((key): key is string => key !== null))].sort();
    for (const key of uniqueKeys) {
      await this.dependencies.storePurchaseRepository.lockPurchaseKey(
        store,
        key,
        client,
      );
    }
  }

  private key(namespace: string, value: string): string {
    return createStoreIdentifierKey(
      this.dependencies.identifierSecret,
      namespace,
      value,
    );
  }
}

function operationForPurchase(
  purchase: StorePurchaseRecord,
  transactionKey: string | null,
): 'observe' | 'grant' | 'reverse' {
  if (purchase.state === 'active' && transactionKey !== null) {
    return 'grant';
  }
  if (
    (purchase.state === 'refunded' || purchase.state === 'revoked') &&
    transactionKey !== null
  ) {
    return 'reverse';
  }
  return 'observe';
}

function isHistoricalSubscriptionTerminal(
  existing: StorePurchaseRecord,
  incomingTransactionKey: string | null,
  incomingState: StorePurchaseState,
): boolean {
  return (
    existing.kind === 'subscription' &&
    incomingTransactionKey !== null &&
    existing.transactionKey !== null &&
    incomingTransactionKey !== existing.transactionKey &&
    (incomingState === 'refunded' || incomingState === 'revoked')
  );
}

function isSameProduct(
  existing: StorePurchaseRecord,
  product: StoreProductDefinition,
  productId: string,
): boolean {
  return (
    existing.productId === productId &&
    existing.kind === product.kind &&
    existing.planCode ===
      (product.kind === 'subscription' ? product.planCode : null) &&
    existing.creditPackageCode ===
      (product.kind === 'credit_pack' ? product.creditPackageCode : null)
  );
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
  amount: number;
  monthlyDelta: number;
  purchasedDelta: number;
  balance: CreditBalance;
  mobileStoreEventKey: string;
}): CreditLedgerEntry {
  return {
    userId: input.userId,
    type: 'purchase_reversal',
    amount: input.amount,
    monthlyDelta: input.monthlyDelta,
    purchasedDelta: input.purchasedDelta,
    monthlyAfter: input.balance.monthlyCredits,
    purchasedAfter: input.balance.purchasedCredits,
    description: 'Mobile store purchase reversal',
    mobileStoreEventKey: input.mobileStoreEventKey,
  };
}

function canReverseSubscriptionAllowance(
  purchase: StorePurchaseRecord,
  balance: CreditBalance,
): boolean {
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
    creditPackageCode:
      product.kind === 'credit_pack' ? product.creditPackageCode : null,
    creditsChanged: 0,
    isDuplicate: true,
  };
}

const googleRtdnSchema = z
  .object({
    version: z.string().max(32).optional(),
    packageName: z.string().min(1).max(255),
    eventTimeMillis: z.string().max(32).optional(),
    subscriptionNotification: z
      .object({
        version: z.string().max(32).optional(),
        notificationType: z.number().int(),
        purchaseToken: z.string().min(1).max(8_192),
      })
      .strict()
      .optional(),
    oneTimeProductNotification: z
      .object({
        version: z.string().max(32).optional(),
        notificationType: z.number().int(),
        purchaseToken: z.string().min(1).max(8_192),
        sku: z.string().min(1).max(255).optional(),
      })
      .strict()
      .optional(),
    voidedPurchaseNotification: z
      .object({
        purchaseToken: z.string().min(1).max(8_192),
        orderId: z.string().min(1).max(255).optional(),
        productType: z.number().int().optional(),
        refundType: z.number().int().optional(),
      })
      .strict()
      .optional(),
    pendingRefundReviewNotification: z
      .object({})
      .passthrough()
      .optional(),
    testNotification: z.object({}).passthrough().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const count = [
      value.subscriptionNotification,
      value.oneTimeProductNotification,
      value.voidedPurchaseNotification,
      value.pendingRefundReviewNotification,
      value.testNotification,
    ].filter((entry) => entry !== undefined).length;
    if (count !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Exactly one Google notification payload is required',
      });
    }
  });

type ParsedGoogleRtdn =
  | {
      kind: 'subscription' | 'one_time';
      packageName: string;
      purchaseToken: string;
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
      kind: 'test' | 'refund_review';
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
      providerEventType: `google.subscription.${parsed.data.subscriptionNotification.notificationType}`,
      eventTime,
    };
  }
  if (parsed.data.oneTimeProductNotification !== undefined) {
    return {
      kind: 'one_time',
      packageName: parsed.data.packageName,
      purchaseToken: parsed.data.oneTimeProductNotification.purchaseToken,
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
  if (parsed.data.pendingRefundReviewNotification !== undefined) {
    return { kind: 'refund_review', packageName: parsed.data.packageName, eventTime };
  }
  return { kind: 'test', packageName: parsed.data.packageName, eventTime };
}

function parseGoogleEventTime(value: string | undefined): Date | null {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return null;
  }
  const result = new Date(Number(value));
  return Number.isNaN(result.getTime()) ? null : result;
}
