import { ConfigurationError, ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  CreditGrantBucket,
  PaidGenerationRecoveryStatus,
  StripePaymentAdjustmentProviderType,
  StripePaymentAdjustmentStatus,
  StripePaymentRecovery,
} from '../../domain/types/billing.js';
import type { DatabaseClient } from '../../lib/db.js';
import type {
  BillingRecoveryRepository,
  StripePaymentRecoverySource,
} from '../../repositories/BillingRepository.js';
import type { CreditRepository } from '../../repositories/CreditRepository.js';
import type { OrganizationRepository } from '../../repositories/OrganizationRepository.js';

export interface RegisterStripeCreditPurchaseInput {
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string;
  currency: string | null;
  grantedCredits: number;
}

export interface StripePaymentAdjustmentObservation {
  stripeEventId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  providerType: StripePaymentAdjustmentProviderType;
  providerObjectId: string;
  status: StripePaymentAdjustmentStatus;
  amountJpy: number;
  observedRefundedAmountJpy: number;
  currency: string;
}

export interface BillingCreditAdjustmentServicePort {
  registerCreditPurchase(input: RegisterStripeCreditPurchaseInput, client: DatabaseClient): Promise<void>;
  applyObservation(
    input: StripePaymentAdjustmentObservation,
    client: DatabaseClient,
  ): Promise<PaidGenerationRecoveryStatus>;
  settleScopeForPaymentIntent(stripePaymentIntentId: string, client: DatabaseClient): Promise<number>;
  isPaymentLinked(stripePaymentIntentId: string, client: DatabaseClient): Promise<boolean>;
  linkExistingPayment(
    input: {
      externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string };
      stripePaymentIntentId: string;
      currency: string;
      expectedAmountJpy: number;
      expectedKind: 'credit_purchase' | 'subscription';
      fallbackGrant?: { creditBucket: CreditGrantBucket; grantedCredits: number; grantExpiresAt: Date | null };
    },
    client: DatabaseClient,
  ): Promise<'linked' | 'no_credit_grant' | 'review_required' | 'not_found'>;
  recordUnresolvedObservation(
    input: StripePaymentAdjustmentObservation & {
      externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string };
    },
    client: DatabaseClient,
  ): Promise<void>;
}

export class BillingCreditAdjustmentService implements BillingCreditAdjustmentServicePort {
  public constructor(
    private readonly billingRepository: BillingRecoveryRepository,
    private readonly creditRepository: CreditRepository,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  public async registerCreditPurchase(
    input: RegisterStripeCreditPurchaseInput,
    client: DatabaseClient,
  ): Promise<void> {
    if (input.currency?.toLowerCase() !== 'jpy') {
      throw new ValidationError('Stripe credit purchase currency must be JPY');
    }
    assertPositiveSafeInteger(input.grantedCredits, 'Granted credits');
    await this.billingRepository.createStripePaymentRecoveryForCheckout(
      {
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: requireNonBlank(input.stripePaymentIntentId, 'Stripe payment intent'),
        currency: 'jpy',
        grantedCredits: input.grantedCredits,
        grantExpiresAt: null,
      },
      client,
    );
  }

  public async applyObservation(
    input: StripePaymentAdjustmentObservation,
    client: DatabaseClient,
  ): Promise<PaidGenerationRecoveryStatus> {
    validateObservation(input);
    const candidate = await this.billingRepository.findStripePaymentRecovery(
      input.stripePaymentIntentId,
      client,
    );
    if (candidate === null) {
      throw new NotFoundError('Stripe payment is not linked to a local credit purchase yet');
    }
    await this.lockRecoveryScope(candidate, client);
    let recovery = await this.requireRecovery(input.stripePaymentIntentId, client);
    if (recovery.currency !== input.currency.toLowerCase()) {
      throw new ConflictError('Stripe payment currency does not match the recorded purchase');
    }
    if (!(await this.billingRepository.bindStripeChargeToRecovery(recovery.id, input.stripeChargeId, client))) {
      throw new ConflictError('Stripe charge does not match the recorded purchase');
    }
    const adjustmentAccepted = await this.billingRepository.upsertStripePaymentAdjustmentObject(
      {
        recoveryId: recovery.id,
        providerType: input.providerType,
        providerObjectId: input.providerObjectId,
        amountJpy: input.amountJpy,
        status: input.status,
        stripeEventId: input.stripeEventId,
      },
      client,
    );
    if (!adjustmentAccepted) {
      throw new ConflictError('Stripe adjustment object is linked to another payment');
    }

    recovery = await this.requireRecovery(input.stripePaymentIntentId, client);
    const observedRefundedAmountJpy = Math.max(
      recovery.observedRefundedAmountJpy,
      input.observedRefundedAmountJpy,
    );
    const lossAmountJpy = Math.min(
      recovery.amountJpy,
      observedRefundedAmountJpy + recovery.lostDisputeAmountJpy,
    );
    const targetReversalCredits = calculateProportionalCreditRecovery(
      recovery.grantedCredits,
      lossAmountJpy,
      recovery.amountJpy,
    );
    const monotonicTarget = Math.max(recovery.targetReversalCredits, targetReversalCredits);
    await this.billingRepository.updateStripePaymentRecoveryTotals(
      recovery.id,
      {
        observedRefundedAmountJpy,
        targetReversalCredits: monotonicTarget,
        reversedCredits: recovery.reversedCredits,
        unrecoveredCredits: monotonicTarget - recovery.reversedCredits,
      },
      client,
    );
    await this.settleRecoveryScope(recovery, client);
    await this.billingRepository.resolveUnresolvedStripePaymentAdjustments(recovery.paymentRecordId, client);
    recovery = await this.requireRecovery(input.stripePaymentIntentId, client);
    return toRecoveryStatus(recovery);
  }

  public async settleScopeForPaymentIntent(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<number> {
    const candidate = await this.billingRepository.findStripePaymentRecovery(stripePaymentIntentId, client);
    if (candidate === null) {
      throw new NotFoundError('Stripe payment is not linked to a local credit purchase yet');
    }
    // The grant path already owns the balance row before calling this method.
    // Re-locking the user here would invert the adjustment order (user -> balance)
    // and could deadlock account deletion, which owns the user before deleting
    // the balance. No new provider observation is persisted by this method.
    await this.lockRecoveryScope(candidate, client, false);
    const recovery = await this.requireRecovery(stripePaymentIntentId, client);
    return this.settleRecoveryScope(recovery, client);
  }

  public async isPaymentLinked(stripePaymentIntentId: string, client: DatabaseClient): Promise<boolean> {
    return (await this.billingRepository.findStripePaymentRecovery(
      requireNonBlank(stripePaymentIntentId, 'Stripe payment intent'),
      client,
    )) !== null;
  }

  public async linkExistingPayment(
    input: {
      externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string };
      stripePaymentIntentId: string;
      currency: string;
      expectedAmountJpy: number;
      expectedKind: 'credit_purchase' | 'subscription';
      fallbackGrant?: { creditBucket: CreditGrantBucket; grantedCredits: number; grantExpiresAt: Date | null };
    },
    client: DatabaseClient,
  ): Promise<'linked' | 'no_credit_grant' | 'review_required' | 'not_found'> {
    const paymentIntentId = requireNonBlank(input.stripePaymentIntentId, 'Stripe payment intent');
    if (input.currency.toLowerCase() !== 'jpy') {
      throw new ValidationError('Stripe payment currency must be JPY');
    }
    if ((await this.billingRepository.findStripePaymentRecovery(paymentIntentId, client)) !== null) {
      return 'linked';
    }
    const source = await this.findLockedPaymentRecoverySource(input.externalId, client);
    if (source === null) return 'not_found';
    if (source.kind !== input.expectedKind) {
      throw new ConflictError('Stripe payment kind does not match the local payment record');
    }
    assertPositiveSafeInteger(input.expectedAmountJpy, 'Stripe payment amount');
    if (source.amountJpy !== input.expectedAmountJpy) {
      throw new ConflictError('Stripe payment amount does not match the local payment record');
    }
    const grantedCredits = source.grantedCredits ?? input.fallbackGrant?.grantedCredits ?? null;
    const creditBucket = source.creditBucket ?? input.fallbackGrant?.creditBucket ?? null;
    const grantExpiresAt = source.grantExpiresAt ?? input.fallbackGrant?.grantExpiresAt ?? null;
    if (grantedCredits === 0) return 'no_credit_grant';
    if (grantedCredits === null || creditBucket === null || (creditBucket === 'monthly' && grantExpiresAt === null)) {
      return 'review_required';
    }
    assertPositiveSafeInteger(grantedCredits, 'Granted credits');
    const linked = await this.billingRepository.createStripePaymentRecoveryForPaymentRecord(
      {
        paymentRecordId: source.paymentRecordId,
        stripePaymentIntentId: paymentIntentId,
        currency: 'jpy',
        creditBucket,
        grantedCredits,
        grantExpiresAt,
      },
      client,
    );
    if (!linked) throw new ConflictError('Stripe payment is linked to another local payment');
    return 'linked';
  }

  public async recordUnresolvedObservation(
    input: StripePaymentAdjustmentObservation & {
      externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string };
    },
    client: DatabaseClient,
  ): Promise<void> {
    validateObservation(input);
    const source = await this.findLockedPaymentRecoverySource(input.externalId, client);
    if (source === null) throw new NotFoundError('Stripe payment does not match a local payment record');
    const accepted = await this.billingRepository.upsertUnresolvedStripePaymentAdjustment(
      {
        paymentRecordId: source.paymentRecordId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        stripeChargeId: input.stripeChargeId,
        providerType: input.providerType,
        providerObjectId: input.providerObjectId,
        status: input.status,
        amountJpy: input.amountJpy,
        observedRefundedAmountJpy: input.observedRefundedAmountJpy,
        stripeEventId: input.stripeEventId,
      },
      client,
    );
    if (!accepted) throw new ConflictError('Stripe adjustment object is linked to another payment');
  }

  private async requireRecovery(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<StripePaymentRecovery> {
    const recovery = await this.billingRepository.findStripePaymentRecoveryForUpdate(
      requireNonBlank(stripePaymentIntentId, 'Stripe payment intent'),
      client,
    );
    if (recovery === null) {
      throw new NotFoundError('Stripe payment is not linked to a local credit purchase yet');
    }
    if (recovery.paymentKind === 'credit_purchase' && recovery.creditBucket !== 'purchased') {
      throw new ConflictError('Stripe purchased-credit payment has the wrong credit bucket');
    }
    if (recovery.paymentKind === 'subscription' && recovery.creditBucket !== 'monthly') {
      throw new ConflictError('Stripe subscription payment has the wrong credit bucket');
    }
    return recovery;
  }

  private async settleRecoveryScope(recovery: StripePaymentRecovery, client: DatabaseClient): Promise<number> {
    if (recovery.organizationId !== null) {
      const settle = this.organizationRepository.settleOutstandingStripeRecoveries;
      if (settle === undefined) {
        throw new ConfigurationError('Organization Stripe credit recovery is not configured');
      }
      return settle.call(this.organizationRepository, recovery.organizationId, client);
    }
    if (recovery.userId === null) {
      throw new ConfigurationError('Stripe credit recovery has no personal or organization scope');
    }
    const settle = this.creditRepository.settleOutstandingStripeRecoveries;
    if (settle === undefined) {
      throw new ConfigurationError('Personal Stripe credit recovery is not configured');
    }
    return settle.call(this.creditRepository, recovery.userId, client);
  }

  private async lockRecoveryScope(
    recovery: StripePaymentRecovery,
    client: DatabaseClient,
    lockPersonalUser = true,
  ): Promise<void> {
    if (recovery.organizationId !== null) {
      await this.organizationRepository.getCreditBalanceForUpdate(recovery.organizationId, client);
      return;
    }
    if (recovery.userId === null) {
      throw new ConfigurationError('Stripe credit recovery has no personal or organization scope');
    }
    if (lockPersonalUser) {
      await this.lockPersonalRecoveryUser(recovery.userId, client);
    }
    await this.creditRepository.getBalanceForUpdate(recovery.userId, client);
  }

  private async findLockedPaymentRecoverySource(
    externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string },
    client: DatabaseClient,
  ): Promise<StripePaymentRecoverySource | null> {
    const preview = await this.billingRepository.findStripePaymentRecoverySource(
      externalId,
      client,
      false,
    );
    if (preview === null) return null;
    if (preview.organizationId === null) {
      if (preview.userId === null) {
        throw new ConfigurationError('Stripe payment has no personal or organization scope');
      }
      await this.lockPersonalRecoveryUser(preview.userId, client);
    }
    const locked = await this.billingRepository.findStripePaymentRecoverySource(
      externalId,
      client,
      true,
    );
    if (locked === null) return null;
    if (
      locked.paymentRecordId !== preview.paymentRecordId
      || locked.userId !== preview.userId
      || locked.organizationId !== preview.organizationId
    ) {
      throw new ConflictError('Stripe payment scope changed during recovery linking');
    }
    return locked;
  }

  private async lockPersonalRecoveryUser(
    userId: string,
    client: DatabaseClient,
  ): Promise<void> {
    if (!(await this.billingRepository.lockPersonalStripeRecoveryUser(userId, client))) {
      throw new NotFoundError('Billing user not found');
    }
  }
}

export function calculateProportionalCreditRecovery(
  grantedCredits: number,
  lossAmountJpy: number,
  paidAmountJpy: number,
): number {
  assertPositiveSafeInteger(grantedCredits, 'Granted credits');
  assertPositiveSafeInteger(paidAmountJpy, 'Paid amount');
  assertNonnegativeSafeInteger(lossAmountJpy, 'Loss amount');
  const cappedLoss = Math.min(lossAmountJpy, paidAmountJpy);
  if (cappedLoss === 0) return 0;
  const numerator = BigInt(grantedCredits) * BigInt(cappedLoss);
  const denominator = BigInt(paidAmountJpy);
  return Number((numerator + denominator - 1n) / denominator);
}

function validateObservation(input: StripePaymentAdjustmentObservation): void {
  requireNonBlank(input.stripeEventId, 'Stripe event');
  requireNonBlank(input.stripePaymentIntentId, 'Stripe payment intent');
  requireNonBlank(input.stripeChargeId, 'Stripe charge');
  requireNonBlank(input.providerObjectId, 'Stripe adjustment object');
  assertNonnegativeSafeInteger(input.amountJpy, 'Stripe adjustment amount');
  assertNonnegativeSafeInteger(input.observedRefundedAmountJpy, 'Stripe refunded amount');
  if (input.currency.toLowerCase() !== 'jpy') {
    throw new ValidationError('Stripe payment adjustment currency must be JPY');
  }
  if (input.providerType === 'refund' && !['pending', 'succeeded', 'failed'].includes(input.status)) {
    throw new ValidationError('Stripe refund status is invalid');
  }
  if (input.providerType === 'dispute' && !['open', 'won', 'lost'].includes(input.status)) {
    throw new ValidationError('Stripe dispute status is invalid');
  }
}

function requireNonBlank(value: string, label: string): string {
  if (value.trim().length === 0) throw new ValidationError(`${label} is missing`);
  return value;
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError(`${label} must be a positive integer`);
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${label} must be a nonnegative integer`);
}

function toRecoveryStatus(recovery: StripePaymentRecovery): PaidGenerationRecoveryStatus {
  return {
    paidGenerationBlocked:
      recovery.unrecoveredCredits > 0 || recovery.hasPendingRefund || recovery.hasOpenDispute,
    recoveryCreditsDue: recovery.unrecoveredCredits,
  };
}
