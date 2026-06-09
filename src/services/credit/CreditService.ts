import { SIGNUP_BONUS_CREDITS } from '../../domain/constants/credits.js';
import { InsufficientCreditsError, ValidationError } from '../../domain/errors/index.js';
import type { CreditBalance, CreditBalanceSnapshot } from '../../domain/types/credit.js';
import type {
  CreditLedgerBucketDeltaSummary,
  CreditRepository,
} from '../../repositories/CreditRepository.js';
import type { DatabaseClient } from '../../lib/db.js';

export interface ConsumeCreditsParams {
  userId: string;
  cost: number;
  description: string;
  jobId?: string;
}

export interface RefundCreditsParams {
  userId: string;
  amount: number;
  description: string;
  jobId?: string;
}

export interface CreditServicePort {
  getBalance(userId: string): Promise<CreditBalanceSnapshot>;
  grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot>;
  consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot>;
  refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot>;
}

interface CreditRefundDeltas {
  amount: number;
  monthlyDelta: number;
  purchasedDelta: number;
}

export class CreditService implements CreditServicePort {
  public constructor(private readonly creditRepository: CreditRepository) {}

  public async getBalance(userId: string): Promise<CreditBalanceSnapshot> {
    const balance = await this.creditRepository.getBalance(userId);
    return toSnapshot(balance ?? emptyBalance(userId));
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.creditRepository.transaction(async (client) => {
      const currentBalance =
        (await this.creditRepository.getBalanceForUpdate(userId, client)) ?? emptyBalance(userId);

      if (await this.creditRepository.hasLedgerEntry(userId, 'signup_bonus', client)) {
        return toSnapshot(currentBalance);
      }

      const nextBalance: CreditBalance = {
        ...currentBalance,
        purchasedCredits: currentBalance.purchasedCredits + SIGNUP_BONUS_CREDITS,
      };

      const savedBalance =
        currentBalance.monthlyCredits === 0 &&
        currentBalance.purchasedCredits === 0 &&
        (await this.creditRepository.getBalance(userId, client)) === null
          ? await this.creditRepository.createBalance(nextBalance, client)
          : await this.creditRepository.updateBalance(nextBalance, client);

      await this.creditRepository.insertLedger(
        {
          userId,
          type: 'signup_bonus',
          amount: SIGNUP_BONUS_CREDITS,
          monthlyDelta: 0,
          purchasedDelta: SIGNUP_BONUS_CREDITS,
          monthlyAfter: savedBalance.monthlyCredits,
          purchasedAfter: savedBalance.purchasedCredits,
          description: 'Initial free plan signup bonus',
        },
        client,
      );

      return toSnapshot(savedBalance);
    });
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    if (params.cost <= 0) {
      throw new ValidationError('Credit cost must be greater than zero');
    }

    return this.creditRepository.transaction(async (client) => {
      const currentBalance =
        (await this.creditRepository.getBalanceForUpdate(params.userId, client)) ?? emptyBalance(params.userId);

      const totalCredits = currentBalance.monthlyCredits + currentBalance.purchasedCredits;
      if (totalCredits < params.cost) {
        throw new InsufficientCreditsError();
      }

      const monthlyDeduct = Math.min(currentBalance.monthlyCredits, params.cost);
      const purchasedDeduct = params.cost - monthlyDeduct;
      const nextBalance: CreditBalance = {
        ...currentBalance,
        monthlyCredits: currentBalance.monthlyCredits - monthlyDeduct,
        purchasedCredits: currentBalance.purchasedCredits - purchasedDeduct,
      };

      const savedBalance =
        currentBalance.monthlyCredits === 0 &&
        currentBalance.purchasedCredits === 0 &&
        (await this.creditRepository.getBalance(params.userId, client)) === null
          ? await this.creditRepository.createBalance(nextBalance, client)
          : await this.creditRepository.updateBalance(nextBalance, client);

      await this.creditRepository.insertLedger(
        {
          userId: params.userId,
          type: 'consume',
          amount: -params.cost,
          monthlyDelta: -monthlyDeduct,
          purchasedDelta: -purchasedDeduct,
          monthlyAfter: savedBalance.monthlyCredits,
          purchasedAfter: savedBalance.purchasedCredits,
          description: params.description,
          jobId: params.jobId,
        },
        client,
      );

      return toSnapshot(savedBalance);
    });
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    if (params.amount <= 0) {
      throw new ValidationError('Credit refund amount must be greater than zero');
    }

    return this.creditRepository.transaction(async (client) => {
      const currentBalance =
        (await this.creditRepository.getBalanceForUpdate(params.userId, client)) ?? emptyBalance(params.userId);

      let refundAmount = params.amount;
      let refundMonthlyDelta = 0;
      let refundPurchasedDelta = params.amount;
      if (params.jobId !== undefined) {
        const refundDeltas = await this.calculateJobScopedRefundDeltas(
          params.userId,
          params.jobId,
          params.amount,
          client,
        );
        if (refundDeltas === null) {
          return toSnapshot(currentBalance);
        }
        refundAmount = refundDeltas.amount;
        refundMonthlyDelta = refundDeltas.monthlyDelta;
        refundPurchasedDelta = refundDeltas.purchasedDelta;
      }

      const nextBalance: CreditBalance = {
        ...currentBalance,
        monthlyCredits: currentBalance.monthlyCredits + refundMonthlyDelta,
        purchasedCredits: currentBalance.purchasedCredits + refundPurchasedDelta,
      };

      const savedBalance =
        currentBalance.monthlyCredits === 0 &&
        currentBalance.purchasedCredits === 0 &&
        (await this.creditRepository.getBalance(params.userId, client)) === null
          ? await this.creditRepository.createBalance(nextBalance, client)
          : await this.creditRepository.updateBalance(nextBalance, client);

      await this.creditRepository.insertLedger(
        {
          userId: params.userId,
          type: 'refund',
          amount: refundAmount,
          monthlyDelta: refundMonthlyDelta,
          purchasedDelta: refundPurchasedDelta,
          monthlyAfter: savedBalance.monthlyCredits,
          purchasedAfter: savedBalance.purchasedCredits,
          description: params.description,
          jobId: params.jobId,
        },
        client,
      );

      return toSnapshot(savedBalance);
    });
  }

  private async calculateJobScopedRefundDeltas(
    userId: string,
    jobId: string,
    requestedAmount: number,
    client: DatabaseClient,
  ): Promise<CreditRefundDeltas | null> {
    const consumedDeltas = await this.creditRepository.sumJobLedgerBucketDeltas(
      userId,
      'consume',
      jobId,
      client,
    );
    const refundedDeltas = await this.creditRepository.sumJobLedgerBucketDeltas(
      userId,
      'refund',
      jobId,
      client,
    );

    if (
      consumedDeltas.entryCount > 0 &&
      hasCompleteBucketDeltas(consumedDeltas) &&
      hasCompleteBucketDeltas(refundedDeltas)
    ) {
      const remainingMonthly = Math.max(0, -consumedDeltas.monthlyDelta - refundedDeltas.monthlyDelta);
      const remainingPurchased = Math.max(0, -consumedDeltas.purchasedDelta - refundedDeltas.purchasedDelta);
      const refundableAmount = remainingMonthly + remainingPurchased;
      if (refundableAmount <= 0) {
        return null;
      }

      const amount = Math.min(requestedAmount, refundableAmount);
      const monthlyDelta = Math.min(remainingMonthly, amount);
      return {
        amount,
        monthlyDelta,
        purchasedDelta: amount - monthlyDelta,
      };
    }

    // Older ledger rows do not have bucket deltas. Keep the historical behavior
    // but still cap by total consumed amount to avoid over-crediting.
    const consumedAmount = Math.abs(
      await this.creditRepository.sumJobLedgerAmount(userId, 'consume', jobId, client),
    );
    const refundedAmount = await this.creditRepository.sumJobLedgerAmount(userId, 'refund', jobId, client);
    const refundableAmount = consumedAmount - refundedAmount;
    if (refundableAmount <= 0) {
      return null;
    }

    const amount = Math.min(requestedAmount, refundableAmount);
    return {
      amount,
      monthlyDelta: 0,
      purchasedDelta: amount,
    };
  }
}

function hasCompleteBucketDeltas(summary: CreditLedgerBucketDeltaSummary): boolean {
  return summary.entryCount === summary.completeEntryCount;
}

function emptyBalance(userId: string): CreditBalance {
  return {
    userId,
    monthlyCredits: 0,
    purchasedCredits: 0,
    monthlyExpiresAt: null,
  };
}

function toSnapshot(balance: CreditBalance): CreditBalanceSnapshot {
  return {
    monthlyCredits: balance.monthlyCredits,
    purchasedCredits: balance.purchasedCredits,
    totalCredits: balance.monthlyCredits + balance.purchasedCredits,
    monthlyExpiresAt: balance.monthlyExpiresAt,
  };
}
