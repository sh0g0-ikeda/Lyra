import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type {
  StripeRecoveryBackfillCandidate,
  StripeRecoveryBackfillRepository,
  StripeRecoveryIdentity,
} from '../../../../src/repositories/StripeRecoveryBackfillRepository.js';
import { StripeRecoveryBackfillService } from '../../../../src/services/billing/StripeRecoveryBackfillService.js';

const unresolvedId = randomUUID();
const paymentRecordId = randomUUID();
const userId = randomUUID();
const expiresAt = new Date('2026-11-01T00:00:00.000Z');
const client = { query: vi.fn() } as unknown as DatabaseClient;

function candidate(overrides: Partial<StripeRecoveryBackfillCandidate> = {}): StripeRecoveryBackfillCandidate {
  return {
    unresolvedAdjustmentId: unresolvedId,
    paymentRecordId,
    stripePaymentIntentId: 'pi_legacy_subscription',
    stripeChargeId: 'ch_legacy_subscription',
    providerType: 'refund',
    providerStatus: 'succeeded',
    adjustmentAmountJpy: 2_000,
    observedRefundedAmountJpy: 2_000,
    resolvedAt: null,
    userId,
    organizationId: null,
    paymentKind: 'subscription',
    paymentStatus: 'paid',
    paymentAmountJpy: 2_000,
    stripeInvoiceId: 'in_legacy_subscription',
    grantedCredits: null,
    creditBucket: null,
    grantExpiresAt: null,
    ...overrides,
  };
}

function recovery(overrides: Partial<StripeRecoveryIdentity> = {}): StripeRecoveryIdentity {
  return {
    paymentRecordId,
    stripePaymentIntentId: 'pi_legacy_subscription',
    stripeChargeId: 'ch_legacy_subscription',
    currency: 'jpy',
    creditBucket: 'monthly',
    grantedCredits: 100,
    grantExpiresAt: expiresAt,
    ...overrides,
  };
}

function repository(input: {
  candidate?: StripeRecoveryBackfillCandidate | null;
  recoveries?: StripeRecoveryIdentity[];
  insertCreated?: boolean;
} = {}): StripeRecoveryBackfillRepository & {
  transactionMock: ReturnType<typeof vi.fn>;
  updatePaymentGrantMetadata: ReturnType<typeof vi.fn>;
  insertPaymentRecovery: ReturnType<typeof vi.fn>;
} {
  const value = input.candidate === undefined ? candidate() : input.candidate;
  const recoveries = input.recoveries ?? [];
  const transactionMock = vi.fn();
  const transaction = async <T>(
    readOnly: boolean,
    work: (transactionClient: DatabaseClient) => Promise<T>,
  ): Promise<T> => {
    transactionMock(readOnly, work);
    return work(client);
  };
  return {
    transaction,
    transactionMock,
    findCandidate: vi.fn(async () => value),
    findConflictingRecoveries: vi.fn(async () => recoveries),
    updatePaymentGrantMetadata: vi.fn(async () => true),
    insertPaymentRecovery: vi.fn(async () => input.insertCreated ?? true),
  };
}

describe('Stripe旧subscription回収backfill', () => {
  it('dry-runでは検証だけ行いpayment metadataとrecoveryを変更しない', async () => {
    const repo = repository();
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: false,
    })).resolves.toMatchObject({ dryRun: true, action: 'would_create' });

    expect(repo.transactionMock).toHaveBeenCalledWith(true, expect.any(Function));
    expect(repo.updatePaymentGrantMetadata).not.toHaveBeenCalled();
    expect(repo.insertPaymentRecovery).not.toHaveBeenCalled();
  });

  it('applyでは検証済みmetadataと同じscopeのrecoveryだけを作る', async () => {
    const repo = repository();
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).resolves.toMatchObject({ dryRun: false, action: 'created' });

    expect(repo.transactionMock).toHaveBeenCalledWith(false, expect.any(Function));
    expect(repo.updatePaymentGrantMetadata).toHaveBeenCalledWith(
      paymentRecordId,
      100,
      expiresAt,
      client,
    );
    expect(repo.insertPaymentRecovery).toHaveBeenCalledWith(expect.objectContaining({
      paymentRecordId,
      stripePaymentIntentId: 'pi_legacy_subscription',
      stripeChargeId: 'ch_legacy_subscription',
      creditBucket: 'monthly',
    }), client);
  });

  it('同値metadataと同一recoveryへの再実行は変更せず成功する', async () => {
    const repo = repository({
      candidate: candidate({ grantedCredits: 100, creditBucket: 'monthly', grantExpiresAt: expiresAt }),
      recoveries: [recovery()],
    });
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).resolves.toMatchObject({ dryRun: false, action: 'already_configured' });

    expect(repo.updatePaymentGrantMetadata).not.toHaveBeenCalled();
    expect(repo.insertPaymentRecovery).not.toHaveBeenCalled();
  });

  it('既存metadataが異なる場合は上書きしない', async () => {
    const repo = repository({
      candidate: candidate({ grantedCredits: 175, creditBucket: 'monthly', grantExpiresAt: expiresAt }),
    });
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).rejects.toThrow('metadata');

    expect(repo.updatePaymentGrantMetadata).not.toHaveBeenCalled();
  });

  it('同じpaymentに別のPaymentIntent recoveryがある場合は拒否する', async () => {
    const repo = repository({ recoveries: [recovery({ stripePaymentIntentId: 'pi_other' })] });
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).rejects.toThrow('conflict');

    expect(repo.updatePaymentGrantMetadata).not.toHaveBeenCalled();
  });

  it.each([
    { unresolvedAdjustmentId: 'not-a-uuid', grantedCredits: 100, grantExpiresAt: expiresAt },
    { unresolvedAdjustmentId: unresolvedId, grantedCredits: 0, grantExpiresAt: expiresAt },
    { unresolvedAdjustmentId: unresolvedId, grantedCredits: 1_000_001, grantExpiresAt: expiresAt },
    { unresolvedAdjustmentId: unresolvedId, grantedCredits: 100, grantExpiresAt: new Date('invalid') },
  ])('invalid inputをDB参照前に拒否する: $unresolvedAdjustmentId/$grantedCredits', async input => {
    const repo = repository();
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({ ...input, apply: false })).rejects.toThrow();
    expect(repo.transactionMock).not.toHaveBeenCalled();
  });

  it.each([
    candidate({ resolvedAt: new Date() }),
    candidate({ paymentKind: 'credit_purchase' }),
    candidate({ paymentStatus: 'failed' }),
    candidate({ userId: null }),
    candidate({ providerStatus: 'failed' }),
    candidate({ adjustmentAmountJpy: 2_001 }),
  ])('false hold・誤scope・不整合paymentを変更前に拒否する', async invalidCandidate => {
    const repo = repository({ candidate: invalidCandidate });
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).rejects.toThrow();
    expect(repo.updatePaymentGrantMetadata).not.toHaveBeenCalled();
  });

  it('法人subscriptionはactor userとorganization scopeを保ったままbackfillする', async () => {
    const organizationId = randomUUID();
    const repo = repository({ candidate: candidate({ organizationId }) });
    const service = new StripeRecoveryBackfillService(repo);

    await expect(service.backfill({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 100,
      grantExpiresAt: expiresAt,
      apply: true,
    })).resolves.toMatchObject({ action: 'created' });
    expect(repo.insertPaymentRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRecordId }),
      client,
    );
  });
});
