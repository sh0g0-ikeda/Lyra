import { SIGNUP_BONUS_CREDITS } from '../../domain/constants/credits.js';
import { InsufficientCreditsError, ValidationError } from '../../domain/errors/index.js';
import type { CreditBalance, CreditBalanceSnapshot } from '../../domain/types/credit.js';
import type { CreditRepository } from '../../repositories/CreditRepository.js';

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

      const nextBalance: CreditBalance = {
        ...currentBalance,
        purchasedCredits: currentBalance.purchasedCredits + params.amount,
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
          amount: params.amount,
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
