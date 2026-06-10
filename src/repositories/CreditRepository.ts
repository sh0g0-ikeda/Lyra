import type { QueryResultRow } from 'pg';
import type { CreditLedgerType } from '../domain/constants/credits.js';
import type { CreditBalance, CreditLedgerEntry } from '../domain/types/credit.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface CreditBalanceRow extends QueryResultRow {
  user_id: string;
  monthly_credits: number;
  purchased_credits: number;
  monthly_expires_at: Date | null;
}

export interface CreditLedgerBucketDeltaSummary {
  monthlyDelta: number;
  purchasedDelta: number;
  entryCount: number;
  completeEntryCount: number;
}

export interface CreditRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  getBalance(userId: string, client?: DatabaseClient): Promise<CreditBalance | null>;
  getBalanceForUpdate(userId: string, client: DatabaseClient): Promise<CreditBalance | null>;
  createBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance>;
  updateBalance(balance: CreditBalance, client: DatabaseClient): Promise<CreditBalance>;
  hasLedgerEntry(userId: string, type: CreditLedgerType, client: DatabaseClient): Promise<boolean>;
  countJobLedgerEntries(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<number>;
  sumJobLedgerAmount(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<number>;
  sumJobLedgerBucketDeltas(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<CreditLedgerBucketDeltaSummary>;
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

  public async hasLedgerEntry(
    userId: string,
    type: CreditLedgerType,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      SELECT 1
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
      LIMIT 1
      `,
      [userId, type],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async countJobLedgerEntries(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
        AND job_id = $3
      `,
      [userId, type, jobId],
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  public async sumJobLedgerAmount(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<number> {
    const result = await client.query<{ amount: string }>(
      `
      SELECT COALESCE(SUM(amount), 0)::text AS amount
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
        AND job_id = $3
      `,
      [userId, type, jobId],
    );

    return Number(result.rows[0]?.amount ?? '0');
  }

  public async sumJobLedgerBucketDeltas(
    userId: string,
    type: CreditLedgerType,
    jobId: string,
    client: DatabaseClient,
  ): Promise<CreditLedgerBucketDeltaSummary> {
    const result = await client.query<{
      monthly_delta: string;
      purchased_delta: string;
      entry_count: string;
      complete_entry_count: string;
    }>(
      `
      SELECT
        COALESCE(SUM(monthly_delta), 0)::text AS monthly_delta,
        COALESCE(SUM(purchased_delta), 0)::text AS purchased_delta,
        COUNT(*)::text AS entry_count,
        COUNT(*) FILTER (
          WHERE monthly_delta IS NOT NULL
            AND purchased_delta IS NOT NULL
        )::text AS complete_entry_count
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
        AND job_id = $3
      `,
      [userId, type, jobId],
    );
    const row = result.rows[0];

    return {
      monthlyDelta: Number(row?.monthly_delta ?? '0'),
      purchasedDelta: Number(row?.purchased_delta ?? '0'),
      entryCount: Number(row?.entry_count ?? '0'),
      completeEntryCount: Number(row?.complete_entry_count ?? '0'),
    };
  }

  public async insertLedger(entry: CreditLedgerEntry, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      INSERT INTO credit_ledger (
        user_id,
        type,
        amount,
        monthly_delta,
        purchased_delta,
        monthly_after,
        purchased_after,
        description,
        stripe_event_id,
        job_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        entry.userId,
        entry.type,
        entry.amount,
        entry.monthlyDelta ?? null,
        entry.purchasedDelta ?? null,
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
