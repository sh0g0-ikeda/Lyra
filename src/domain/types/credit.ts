import type { CreditLedgerType } from '../constants/credits.js';

export interface CreditBalance {
  userId: string;
  monthlyCredits: number;
  purchasedCredits: number;
  monthlyExpiresAt: Date | null;
}

export interface CreditBalanceSnapshot {
  monthlyCredits: number;
  purchasedCredits: number;
  totalCredits: number;
  monthlyExpiresAt: Date | null;
}

export interface CreditLedgerEntry {
  userId: string;
  type: CreditLedgerType;
  amount: number;
  monthlyAfter: number;
  purchasedAfter: number;
  description: string;
  stripeEventId?: string;
  jobId?: string;
}
