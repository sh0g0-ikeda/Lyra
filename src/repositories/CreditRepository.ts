import type { QueryResultRow } from 'pg';
import type { CreditBalance, CreditLedgerEntry } from '../domain/types/credit.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface CreditBalanceRow extends QueryResultRow {
  user_id: string;
  monthly_credits: number;
  purchased_credits: number;
  monthly_expires_at: Date | null;
}

export interface CreditRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  getBalance(userId: string, client?: DatabaseClient): Promise<CreditBalance | null>;
  getBalanceForUpdate(userId: string, client: DatabaseClient): Promise<CreditBalance | null>;
  createBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance>;
  updateBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance>;
  insertLedger(entry: CreditLedgerEntry, client: DatabaseClient): Promise<void>;
}

export class PostgresCreditRepository implements CreditRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.transactionRunner.transaction(work);
  }

  public async getBalance(userId: string, client: DatabaseClient = this.client): Promise<CreditBalance | null> {
    const result = await client.query<CreditBalanceRow>(
      `
      SELECT user_id, monthly_credits, purchased_credits, monthly_expires_at
      FROM credit_balances
      WHERE user_id = $1
      `,
      [userId],
    );

    return result.rows[0] === undefined ? null : mapCreditBalanceRow(result.rows[0]);
  }

  public async getBalanceForUpdate(userId: string, client: DatabaseClient): Promise<CreditBalance | null> {
    // First-time grants/refunds need a concrete balance row to lock; otherwise
    // concurrent requests can both observe "no row" and race on INSERT.
    await client.query(
      `
      INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits)
      VALUES ($1, 0, 0)
      ON CONFLICT (user_id) DO NOTHING
      `,
      [userId],
    );

    const result = await client.query<CreditBalanceRow>(
      `
      SELECT user_id, monthly_credits, purchased_credits, monthly_expires_at
      FROM credit_balances
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId],
    );

    return result.rows[0] === undefined ? null : mapCreditBalanceRow(result.rows[0]);
  }

  public async createBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance> {
    const result = await client.query<CreditBalanceRow>(
      `
      INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits, monthly_expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING user_id, monthly_credits, purchased_credits, monthly_expires_at
      `,
      [balance.userId, balance.monthlyCredits, balance.purchasedCredits, balance.monthlyExpiresAt],
    );

    return mapCreditBalanceRow(result.rows[0]);
  }

  public async updateBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance> {
    const result = await client.query<CreditBalanceRow>(
      `
      UPDATE credit_balances
      SET monthly_credits = $2,
          purchased_credits = $3,
          monthly_expires_at = $4,
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, monthly_credits, purchased_credits, monthly_expires_at
      `,
      [balance.userId, balance.monthlyCredits, balance.purchasedCredits, balance.monthlyExpiresAt],
    );

    return mapCreditBalanceRow(result.rows[0]);
  }

  public async insertLedger(entry: CreditLedgerEntry, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      INSERT INTO credit_ledger (
        user_id,
        type,
        amount,
        monthly_after,
        purchased_after,
        description,
        stripe_event_id,
        job_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        entry.userId,
        entry.type,
        entry.amount,
        entry.monthlyAfter,
        entry.purchasedAfter,
        entry.description,
        entry.stripeEventId ?? null,
        entry.jobId ?? null,
      ],
    );
  }
}

function mapCreditBalanceRow(row: CreditBalanceRow): CreditBalance {
  return {
    userId: row.user_id,
    monthlyCredits: row.monthly_credits,
    purchasedCredits: row.purchased_credits,
    monthlyExpiresAt: row.monthly_expires_at,
  };
}
