import type { CreditBalance } from '../../domain/types/credit.js';

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function isMonthlyCreditExpired(balance: CreditBalance, now: Date): boolean {
  return balance.monthlyExpiresAt !== null && balance.monthlyExpiresAt.getTime() <= now.getTime();
}

export function normalizeExpiredMonthlyCredits(balance: CreditBalance, now: Date): CreditBalance {
  if (!isMonthlyCreditExpired(balance, now)) {
    return balance;
  }

  return {
    ...balance,
    monthlyCredits: 0,
    monthlyExpiresAt: null,
  };
}
