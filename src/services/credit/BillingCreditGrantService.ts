import type { CreditBalance, CreditBalanceSnapshot, CreditLedgerEntry } from '../../domain/types/credit.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { CreditRepository } from '../../repositories/CreditRepository.js';
import {
  normalizeExpiredMonthlyCredits,
  systemClock,
  type Clock,
} from './CreditBalanceExpiration.js';
import { assertPositiveSafeCreditAmount } from './CreditAmountValidation.js';

export interface GrantMonthlyCreditsParams {
  userId: string;
  amount: number;
  description: string;
  expiresAt: Date | null;
  stripeEventId?: string;
}

export interface GrantPurchasedCreditsParams {
  userId: string;
  amount: number;
  description: string;
  stripeEventId?: string;
}

export interface BillingCreditGrantServicePort {
  grantMonthlyCredits(
    params: GrantMonthlyCreditsParams,
    client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot>;
  grantPurchasedCredits(
    params: GrantPurchasedCreditsParams,
    client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot>;
}

export class BillingCreditGrantService implements BillingCreditGrantServicePort {
  public constructor(
    private readonly creditRepository: CreditRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  public async grantMonthlyCredits(
    params: GrantMonthlyCreditsParams,
    client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot> {
    assertPositiveSafeCreditAmount(params.amount, 'Monthly credit grant amount');

    return this.withTransaction(client, async (transactionClient) => {
      const currentBalance = this.normalizeBalance(
        (await this.creditRepository.getBalanceForUpdate(params.userId, transactionClient)) ??
          emptyBalance(params.userId),
      );

      const nextBalance: CreditBalance = {
        ...currentBalance,
        monthlyCredits: params.amount,
        monthlyExpiresAt: params.expiresAt,
      };

      const savedBalance = await saveBalance(this.creditRepository, currentBalance, nextBalance, transactionClient);
      await this.creditRepository.insertLedger(
        createLedgerEntry({
          userId: params.userId,
          type: 'monthly_grant',
          amount: params.amount,
          monthlyDelta: nextBalance.monthlyCredits - currentBalance.monthlyCredits,
          purchasedDelta: 0,
          balance: savedBalance,
          description: params.description,
          stripeEventId: params.stripeEventId,
        }),
        transactionClient,
      );

      return toSnapshot(savedBalance);
    });
  }

  public async grantPurchasedCredits(
    params: GrantPurchasedCreditsParams,
    client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot> {
    assertPositiveSafeCreditAmount(params.amount, 'Purchased credit grant amount');

    return this.withTransaction(client, async (transactionClient) => {
      const currentBalance = this.normalizeBalance(
        (await this.creditRepository.getBalanceForUpdate(params.userId, transactionClient)) ??
          emptyBalance(params.userId),
      );

      const nextBalance: CreditBalance = {
        ...currentBalance,
        purchasedCredits: currentBalance.purchasedCredits + params.amount,
      };

      const savedBalance = await saveBalance(this.creditRepository, currentBalance, nextBalance, transactionClient);
      await this.creditRepository.insertLedger(
        createLedgerEntry({
          userId: params.userId,
          type: 'purchase',
          amount: params.amount,
          monthlyDelta: 0,
          purchasedDelta: params.amount,
          balance: savedBalance,
          description: params.description,
          stripeEventId: params.stripeEventId,
        }),
        transactionClient,
      );

      return toSnapshot(savedBalance);
    });
  }

  private async withTransaction<T>(
    client: DatabaseClient | undefined,
    work: (transactionClient: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    if (client !== undefined) {
      return work(client);
    }

    return this.creditRepository.transaction(work);
  }

  private normalizeBalance(balance: CreditBalance): CreditBalance {
    return normalizeExpiredMonthlyCredits(balance, this.clock());
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

async function saveBalance(
  creditRepository: CreditRepository,
  currentBalance: CreditBalance,
  nextBalance: CreditBalance,
  client: DatabaseClient,
): Promise<CreditBalance> {
  const existingBalance = await creditRepository.getBalance(currentBalance.userId, client);

  if (existingBalance === null) {
    return creditRepository.createBalance(nextBalance, client);
  }

  return creditRepository.updateBalance(nextBalance, client);
}

function createLedgerEntry(input: {
  userId: string;
  type: CreditLedgerEntry['type'];
  amount: number;
  monthlyDelta: number;
  purchasedDelta: number;
  balance: CreditBalance;
  description: string;
  stripeEventId?: string;
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
    stripeEventId: input.stripeEventId,
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
