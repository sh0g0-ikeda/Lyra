import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  StripeRecoveryBackfillCandidate,
  StripeRecoveryBackfillRepository,
  StripeRecoveryIdentity,
} from '../../repositories/StripeRecoveryBackfillRepository.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const MAX_STRIPE_RECOVERY_BACKFILL_CREDITS = 1_000_000;

export interface StripeRecoveryBackfillInput {
  unresolvedAdjustmentId: string;
  grantedCredits: number;
  grantExpiresAt: Date;
  apply: boolean;
}

export interface StripeRecoveryBackfillResult {
  unresolvedAdjustmentId: string;
  dryRun: boolean;
  action: 'would_create' | 'created' | 'already_configured';
  grantedCredits: number;
  grantExpiresAt: Date;
}

export class StripeRecoveryBackfillService {
  public constructor(private readonly repository: StripeRecoveryBackfillRepository) {}

  public async backfill(input: StripeRecoveryBackfillInput): Promise<StripeRecoveryBackfillResult> {
    validateInput(input);
    return this.repository.transaction(!input.apply, async client => {
      const candidate = await this.repository.findCandidate(
        input.unresolvedAdjustmentId,
        client,
        input.apply,
      );
      if (candidate === null) {
        throw new NotFoundError('Unresolved Stripe payment adjustment was not found');
      }
      validateCandidate(candidate, input);
      const recoveries = await this.repository.findConflictingRecoveries(
        candidate.paymentRecordId,
        candidate.stripePaymentIntentId,
        candidate.stripeChargeId,
        client,
        input.apply,
      );
      const existing = validateRecoveryIdentities(recoveries, candidate, input);
      const metadataConfigured = hasMatchingMetadata(candidate, input);

      if (existing !== null) {
        if (!metadataConfigured) {
          throw new ConflictError('Stripe recovery exists without matching payment metadata');
        }
        return result(input, 'already_configured');
      }
      if (!input.apply) {
        return result(input, 'would_create');
      }
      if (!(await this.repository.updatePaymentGrantMetadata(
        candidate.paymentRecordId,
        input.grantedCredits,
        input.grantExpiresAt,
        client,
      ))) {
        throw new ConflictError('Stripe payment grant metadata changed during backfill');
      }
      const created = await this.repository.insertPaymentRecovery(
        {
          paymentRecordId: candidate.paymentRecordId,
          stripePaymentIntentId: candidate.stripePaymentIntentId,
          stripeChargeId: candidate.stripeChargeId,
          creditBucket: 'monthly',
          grantedCredits: input.grantedCredits,
          grantExpiresAt: input.grantExpiresAt,
        },
        client,
      );
      if (!created) {
        const afterConflict = await this.repository.findConflictingRecoveries(
          candidate.paymentRecordId,
          candidate.stripePaymentIntentId,
          candidate.stripeChargeId,
          client,
          true,
        );
        if (validateRecoveryIdentities(afterConflict, candidate, input) === null) {
          throw new ConflictError('Stripe payment recovery conflict was not resolved');
        }
        return result(input, 'already_configured');
      }
      return result(input, 'created');
    });
  }
}

function validateInput(input: StripeRecoveryBackfillInput): void {
  if (!UUID_PATTERN.test(input.unresolvedAdjustmentId)) {
    throw new ValidationError('Unresolved adjustment ID must be a UUID');
  }
  if (
    !Number.isSafeInteger(input.grantedCredits)
    || input.grantedCredits <= 0
    || input.grantedCredits > MAX_STRIPE_RECOVERY_BACKFILL_CREDITS
  ) {
    throw new ValidationError(`Granted credits must be between 1 and ${MAX_STRIPE_RECOVERY_BACKFILL_CREDITS}`);
  }
  if (!(input.grantExpiresAt instanceof Date) || !Number.isFinite(input.grantExpiresAt.getTime())) {
    throw new ValidationError('Grant expiry must be a valid timestamp');
  }
}

function validateCandidate(
  candidate: StripeRecoveryBackfillCandidate,
  input: StripeRecoveryBackfillInput,
): void {
  if (candidate.unresolvedAdjustmentId !== input.unresolvedAdjustmentId) {
    throw new ConflictError('Unresolved Stripe adjustment identity changed');
  }
  if (candidate.resolvedAt !== null) {
    throw new ConflictError('Unresolved Stripe adjustment is already resolved');
  }
  if (candidate.paymentKind !== 'subscription' || candidate.paymentStatus !== 'paid') {
    throw new ConflictError('Stripe recovery backfill requires a paid subscription payment');
  }
  if (candidate.organizationId === null && candidate.userId === null) {
    throw new ConflictError('Stripe subscription payment has no recovery scope');
  }
  if (
    candidate.stripeInvoiceId === null
    || candidate.stripeInvoiceId.trim().length === 0
    || candidate.stripePaymentIntentId.trim().length === 0
    || candidate.stripeChargeId.trim().length === 0
  ) {
    throw new ConflictError('Stripe subscription payment identifiers are incomplete');
  }
  if (
    !Number.isSafeInteger(candidate.paymentAmountJpy)
    || candidate.paymentAmountJpy <= 0
    || !Number.isSafeInteger(candidate.adjustmentAmountJpy)
    || candidate.adjustmentAmountJpy < 0
    || !Number.isSafeInteger(candidate.observedRefundedAmountJpy)
    || candidate.observedRefundedAmountJpy < 0
    || candidate.adjustmentAmountJpy > candidate.paymentAmountJpy
    || candidate.observedRefundedAmountJpy > candidate.paymentAmountJpy
  ) {
    throw new ConflictError('Stripe adjustment amounts do not match the paid subscription');
  }
  const activeRefund = candidate.providerType === 'refund'
    && (candidate.providerStatus === 'pending' || candidate.providerStatus === 'succeeded');
  const activeDispute = candidate.providerType === 'dispute'
    && (candidate.providerStatus === 'open' || candidate.providerStatus === 'lost');
  if (!activeRefund && !activeDispute) {
    throw new ConflictError('Stripe adjustment does not require a paid-generation hold');
  }
  const metadataAllNull = candidate.grantedCredits === null
    && candidate.creditBucket === null
    && candidate.grantExpiresAt === null;
  if (!metadataAllNull && !hasMatchingMetadata(candidate, input)) {
    throw new ConflictError('Stripe payment grant metadata conflicts with the operator-confirmed values');
  }
}

function validateRecoveryIdentities(
  recoveries: readonly StripeRecoveryIdentity[],
  candidate: StripeRecoveryBackfillCandidate,
  input: StripeRecoveryBackfillInput,
): StripeRecoveryIdentity | null {
  if (recoveries.length === 0) return null;
  if (recoveries.length !== 1) {
    throw new ConflictError('Stripe payment recovery conflict spans multiple records');
  }
  const recovery = recoveries[0];
  if (
    recovery === undefined
    || recovery.paymentRecordId !== candidate.paymentRecordId
    || recovery.stripePaymentIntentId !== candidate.stripePaymentIntentId
    || recovery.stripeChargeId !== candidate.stripeChargeId
    || recovery.currency !== 'jpy'
    || recovery.creditBucket !== 'monthly'
    || recovery.grantedCredits !== input.grantedCredits
    || !sameTimestamp(recovery.grantExpiresAt, input.grantExpiresAt)
  ) {
    throw new ConflictError('Stripe payment recovery identity conflict');
  }
  return recovery;
}

function hasMatchingMetadata(
  candidate: StripeRecoveryBackfillCandidate,
  input: StripeRecoveryBackfillInput,
): boolean {
  return candidate.grantedCredits === input.grantedCredits
    && candidate.creditBucket === 'monthly'
    && sameTimestamp(candidate.grantExpiresAt, input.grantExpiresAt);
}

function sameTimestamp(left: Date | null, right: Date): boolean {
  return left !== null && left.getTime() === right.getTime();
}

function result(
  input: StripeRecoveryBackfillInput,
  action: StripeRecoveryBackfillResult['action'],
): StripeRecoveryBackfillResult {
  return {
    unresolvedAdjustmentId: input.unresolvedAdjustmentId,
    dryRun: !input.apply,
    action,
    grantedCredits: input.grantedCredits,
    grantExpiresAt: input.grantExpiresAt,
  };
}
