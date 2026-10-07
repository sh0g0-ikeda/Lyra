import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type {
  BillingRecoveryRepository,
  StripePaymentRecoverySource,
} from '../../../../src/repositories/BillingRepository.js';
import type { CreditRepository } from '../../../../src/repositories/CreditRepository.js';
import type { OrganizationRepository } from '../../../../src/repositories/OrganizationRepository.js';
import type {
  StripePaymentAdjustmentObjectInput,
  StripePaymentRecovery,
} from '../../../../src/domain/types/billing.js';
import {
  BillingCreditAdjustmentService,
  calculateProportionalCreditRecovery,
} from '../../../../src/services/credit/BillingCreditAdjustmentService.js';

const client = {} as DatabaseClient;

describe('BillingCreditAdjustmentService', () => {
  it('部分返金を切上げ比例でcreditへ変換し全額を上限にする', () => {
    expect(calculateProportionalCreditRecovery(200, 1, 2_000)).toBe(1);
    expect(calculateProportionalCreditRecovery(200, 1_001, 2_000)).toBe(101);
    expect(calculateProportionalCreditRecovery(200, 4_000, 2_000)).toBe(200);
  });

  it('残高不足の成功返金は残額だけ回収して不足分を保留する', async () => {
    const fixture = createFixture({ purchasedCredits: 50 });
    const result = await fixture.service.applyObservation(
      observation({
        providerType: 'refund',
        providerObjectId: 're_partial',
        status: 'succeeded',
        amountJpy: 1_000,
        observedRefundedAmountJpy: 1_000,
      }),
      client,
    );

    expect(fixture.purchasedCredits()).toBe(0);
    expect(fixture.recovery()).toMatchObject({
      targetReversalCredits: 100,
      reversedCredits: 50,
      unrecoveredCredits: 50,
    });
    expect(result).toEqual({ paidGenerationBlocked: true, recoveryCreditsDue: 50 });
  });

  it('personal返金mutationはuserからbalanceとrecoveryの順にlockする', async () => {
    const fixture = createFixture({ purchasedCredits: 200 });

    await fixture.service.applyObservation(observation(), client);

    expect(fixture.lockOrder().slice(0, 3)).toEqual(['user', 'balance', 'recovery']);
  });

  it('購入grant後の債務settleはbalance保持中にuser lockへ逆行しない', async () => {
    const fixture = createFixture({ purchasedCredits: 200 });

    await fixture.service.settleScopeForPaymentIntent('pi_1', client);

    expect(fixture.lockOrder()[0]).toBe('balance');
    expect(fixture.lockOrder()).not.toContain('user');
  });

  it('pending返金はcreditを永久回収せず有料生成だけ保留する', async () => {
    const fixture = createFixture({ purchasedCredits: 200 });
    const result = await fixture.service.applyObservation(
      observation({
        providerType: 'refund',
        providerObjectId: 're_pending',
        status: 'pending',
        amountJpy: 2_000,
        observedRefundedAmountJpy: 0,
      }),
      client,
    );

    expect(fixture.purchasedCredits()).toBe(200);
    expect(fixture.recovery()).toMatchObject({ targetReversalCredits: 0, reversedCredits: 0 });
    expect(result).toEqual({ paidGenerationBlocked: true, recoveryCreditsDue: 0 });
  });

  it('open disputeは保留、wonは解除し、遅延createdで再開しない', async () => {
    const fixture = createFixture({ purchasedCredits: 200 });
    const open = observation({
      providerType: 'dispute',
      providerObjectId: 'dp_1',
      status: 'open',
      amountJpy: 2_000,
    });
    expect((await fixture.service.applyObservation(open, client)).paidGenerationBlocked).toBe(true);
    expect(fixture.purchasedCredits()).toBe(200);

    const won = await fixture.service.applyObservation(
      { ...open, stripeEventId: 'evt_won', status: 'won' },
      client,
    );
    expect(won).toEqual({ paidGenerationBlocked: false, recoveryCreditsDue: 0 });

    const lateOpen = await fixture.service.applyObservation(
      { ...open, stripeEventId: 'evt_late_open' },
      client,
    );
    expect(lateOpen.paidGenerationBlocked).toBe(false);
    expect(fixture.purchasedCredits()).toBe(200);
  });

  it('lost disputeは法人の共有購入creditだけを回収する', async () => {
    const fixture = createFixture({ organizationId: 'org-1', purchasedCredits: 200 });
    const result = await fixture.service.applyObservation(
      observation({
        providerType: 'dispute',
        providerObjectId: 'dp_lost',
        status: 'lost',
        amountJpy: 2_000,
      }),
      client,
    );

    expect(fixture.purchasedCredits()).toBe(0);
    expect(fixture.personalSettlementCount()).toBe(0);
    expect(fixture.organizationSettlementCount()).toBe(1);
    expect(result).toEqual({ paidGenerationBlocked: false, recoveryCreditsDue: 0 });
  });

  it('同じ累積返金を別eventで受けてもtargetと回収を二重計上しない', async () => {
    const fixture = createFixture({ purchasedCredits: 200 });
    const first = observation({
      providerType: 'refund',
      providerObjectId: 're_1',
      status: 'succeeded',
      amountJpy: 1_000,
      observedRefundedAmountJpy: 1_000,
    });
    await fixture.service.applyObservation(first, client);
    await fixture.service.applyObservation(
      {
        ...first,
        stripeEventId: 'evt_charge_refunded',
        providerObjectId: 'charge:ch_1:refund-total',
      },
      client,
    );

    expect(fixture.purchasedCredits()).toBe(100);
    expect(fixture.recovery()).toMatchObject({
      targetReversalCredits: 100,
      reversedCredits: 100,
      unrecoveredCredits: 0,
    });
  });

  it('移行前credit purchaseは正規Checkoutのfallback grantでlocal paymentへ連結する', async () => {
    const fixture = createFixture({
      purchasedCredits: 0,
      existingRecovery: false,
      source: recoverySource({ kind: 'credit_purchase' }),
    });

    const outcome = await fixture.service.linkExistingPayment(
      {
        externalId: { type: 'checkout', id: 'cs_legacy' },
        stripePaymentIntentId: 'pi_legacy',
        currency: 'jpy',
        expectedAmountJpy: 2_000,
        expectedKind: 'credit_purchase',
        fallbackGrant: { creditBucket: 'purchased', grantedCredits: 200, grantExpiresAt: null },
      },
      client,
    );

    expect(outcome).toBe('linked');
    expect(fixture.createdRecoveryInput()).toMatchObject({
      paymentRecordId: 'payment-legacy',
      stripePaymentIntentId: 'pi_legacy',
      creditBucket: 'purchased',
      grantedCredits: 200,
    });
    expect(fixture.sourceReadModes()).toEqual(['read', 'lock']);
    expect(fixture.lockOrder()[0]).toBe('user');
  });

  it('周期metadataのない移行前subscriptionは自動回収せずreview_requiredにする', async () => {
    const fixture = createFixture({
      purchasedCredits: 0,
      existingRecovery: false,
      source: recoverySource({ kind: 'subscription' }),
    });

    const outcome = await fixture.service.linkExistingPayment(
      {
        externalId: { type: 'invoice', id: 'in_legacy' },
        stripePaymentIntentId: 'pi_legacy',
        currency: 'jpy',
        expectedAmountJpy: 2_000,
        expectedKind: 'subscription',
      },
      client,
    );

    expect(outcome).toBe('review_required');
    expect(fixture.createdRecoveryInput()).toBeNull();
  });
});

function createFixture(input: {
  organizationId?: string;
  purchasedCredits: number;
  existingRecovery?: boolean;
  source?: StripePaymentRecoverySource;
}): {
  service: BillingCreditAdjustmentService;
  recovery: () => StripePaymentRecovery;
  purchasedCredits: () => number;
  personalSettlementCount: () => number;
  organizationSettlementCount: () => number;
  createdRecoveryInput: () => Parameters<BillingRecoveryRepository['createStripePaymentRecoveryForPaymentRecord']>[0] | null;
  lockOrder: () => string[];
  sourceReadModes: () => string[];
} {
  let purchasedCredits = input.purchasedCredits;
  let personalSettlementCount = 0;
  let organizationSettlementCount = 0;
  let createdRecoveryInput: Parameters<BillingRecoveryRepository['createStripePaymentRecoveryForPaymentRecord']>[0] | null = null;
  const lockOrder: string[] = [];
  const sourceReadModes: string[] = [];
  let recovery: StripePaymentRecovery = {
    id: 'recovery-1',
    paymentRecordId: 'payment-1',
    userId: input.organizationId === undefined ? 'user-1' : 'actor-1',
    organizationId: input.organizationId ?? null,
    paymentKind: 'credit_purchase',
    amountJpy: 2_000,
    stripePaymentIntentId: 'pi_1',
    stripeChargeId: null,
    currency: 'jpy',
    creditBucket: 'purchased',
    grantedCredits: 200,
    grantExpiresAt: null,
    observedRefundedAmountJpy: 0,
    lostDisputeAmountJpy: 0,
    targetReversalCredits: 0,
    reversedCredits: 0,
    unrecoveredCredits: 0,
    hasPendingRefund: false,
    hasOpenDispute: false,
  };
  const adjustments = new Map<string, StripePaymentAdjustmentObjectInput>();
  const billingRepository: BillingRecoveryRepository = {
    async createStripePaymentRecoveryForCheckout(): Promise<void> {},
    async findStripePaymentRecoverySource(_externalId, _client, forUpdate = true): Promise<StripePaymentRecoverySource | null> {
      sourceReadModes.push(forUpdate ? 'lock' : 'read');
      return input.source ?? null;
    },
    async lockPersonalStripeRecoveryUser(): Promise<boolean> {
      lockOrder.push('user');
      return true;
    },
    async createStripePaymentRecoveryForPaymentRecord(value): Promise<boolean> {
      createdRecoveryInput = value;
      return true;
    },
    async upsertUnresolvedStripePaymentAdjustment(): Promise<boolean> { return true; },
    async resolveUnresolvedStripePaymentAdjustments(): Promise<void> {},
    async findStripePaymentRecovery(): Promise<StripePaymentRecovery | null> {
      if (input.existingRecovery === false) return null;
      const values = [...adjustments.values()];
      return {
        ...recovery,
        lostDisputeAmountJpy: values
          .filter((value) => value.providerType === 'dispute' && value.status === 'lost')
          .reduce((sum, value) => sum + value.amountJpy, 0),
        hasPendingRefund: values.some((value) => value.providerType === 'refund' && value.status === 'pending'),
        hasOpenDispute: values.some((value) => value.providerType === 'dispute' && value.status === 'open'),
      };
    },
    async findStripePaymentRecoveryForUpdate(): Promise<StripePaymentRecovery> {
      lockOrder.push('recovery');
      const values = [...adjustments.values()];
      return {
        ...recovery,
        lostDisputeAmountJpy: values
          .filter((value) => value.providerType === 'dispute' && value.status === 'lost')
          .reduce((sum, value) => sum + value.amountJpy, 0),
        hasPendingRefund: values.some((value) => value.providerType === 'refund' && value.status === 'pending'),
        hasOpenDispute: values.some((value) => value.providerType === 'dispute' && value.status === 'open'),
      };
    },
    async bindStripeChargeToRecovery(_recoveryId, stripeChargeId): Promise<boolean> {
      if (recovery.stripeChargeId !== null && recovery.stripeChargeId !== stripeChargeId) return false;
      recovery = { ...recovery, stripeChargeId };
      return true;
    },
    async upsertStripePaymentAdjustmentObject(value): Promise<boolean> {
      const key = `${value.providerType}:${value.providerObjectId}`;
      const previous = adjustments.get(key);
      const terminal = previous !== undefined && ['succeeded', 'failed', 'won', 'lost'].includes(previous.status);
      adjustments.set(key, terminal ? previous : value);
      return true;
    },
    async updateStripePaymentRecoveryTotals(_recoveryId, totals): Promise<void> {
      recovery = { ...recovery, ...totals };
    },
  };
  const settle = (): number => {
    const amount = Math.min(purchasedCredits, recovery.unrecoveredCredits);
    purchasedCredits -= amount;
    recovery = {
      ...recovery,
      reversedCredits: recovery.reversedCredits + amount,
      unrecoveredCredits: recovery.unrecoveredCredits - amount,
    };
    return amount;
  };
  const creditRepository = {
    getBalanceForUpdate: async (): Promise<null> => {
      lockOrder.push('balance');
      return null;
    },
    settleOutstandingStripeRecoveries: async (): Promise<number> => {
      personalSettlementCount += 1;
      return settle();
    },
  } as unknown as CreditRepository;
  const organizationRepository = {
    getCreditBalanceForUpdate: async (): Promise<null> => null,
    settleOutstandingStripeRecoveries: async (): Promise<number> => {
      organizationSettlementCount += 1;
      return settle();
    },
  } as unknown as OrganizationRepository;
  return {
    service: new BillingCreditAdjustmentService(billingRepository, creditRepository, organizationRepository),
    recovery: () => recovery,
    purchasedCredits: () => purchasedCredits,
    personalSettlementCount: () => personalSettlementCount,
    organizationSettlementCount: () => organizationSettlementCount,
    createdRecoveryInput: () => createdRecoveryInput,
    lockOrder: () => lockOrder,
    sourceReadModes: () => sourceReadModes,
  };
}

function recoverySource(overrides: Partial<StripePaymentRecoverySource>): StripePaymentRecoverySource {
  return {
    paymentRecordId: 'payment-legacy',
    userId: 'user-1',
    organizationId: null,
    kind: 'credit_purchase',
    amountJpy: 2_000,
    grantedCredits: null,
    creditBucket: null,
    grantExpiresAt: null,
    ...overrides,
  };
}

function observation(
  overrides: Partial<Parameters<BillingCreditAdjustmentService['applyObservation']>[0]> = {},
): Parameters<BillingCreditAdjustmentService['applyObservation']>[0] {
  return {
    stripeEventId: 'evt_1',
    stripePaymentIntentId: 'pi_1',
    stripeChargeId: 'ch_1',
    providerType: 'refund',
    providerObjectId: 're_1',
    status: 'succeeded',
    amountJpy: 0,
    observedRefundedAmountJpy: 0,
    currency: 'jpy',
    ...overrides,
  };
}
