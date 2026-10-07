import type { QueryResultRow } from 'pg';
import type { CreditLedgerType } from '../domain/constants/credits.js';
import type { CreditBalance, CreditLedgerEntry } from '../domain/types/credit.js';
import type { PaidGenerationRecoveryStatus } from '../domain/types/billing.js';
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
  settleOutstandingStripeRecoveries?(userId: string, client: DatabaseClient): Promise<number>;
  getPaidGenerationRecoveryStatus?(
    userId: string,
    client?: DatabaseClient,
  ): Promise<PaidGenerationRecoveryStatus>;
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
    if (entry.stripePaymentRecoveryId === undefined) {
      await client.query(
        `
        INSERT INTO credit_ledger (
          user_id, type, amount, monthly_delta, purchased_delta, monthly_after,
          purchased_after, description, stripe_event_id, mobile_store_event_key, job_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [entry.userId, entry.type, entry.amount, entry.monthlyDelta ?? null,
          entry.purchasedDelta ?? null, entry.monthlyAfter, entry.purchasedAfter,
          entry.description, entry.stripeEventId ?? null, entry.mobileStoreEventKey ?? null,
          entry.jobId ?? null],
      );
      return;
    }
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
        mobile_store_event_key,
        job_id,
        stripe_payment_recovery_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        entry.mobileStoreEventKey ?? null,
        entry.jobId ?? null,
        entry.stripePaymentRecoveryId,
      ],
    );
  }

  public async settleOutstandingStripeRecoveries(userId: string, client: DatabaseClient): Promise<number> {
    const lockedBalance = await this.getBalanceForUpdate(userId, client);
    if (lockedBalance === null || (lockedBalance.monthlyCredits <= 0 && lockedBalance.purchasedCredits <= 0)) {
      return 0;
    }
    const recoveries = await client.query<{
      id: string;
      unrecovered_credits: number;
      credit_bucket: 'monthly' | 'purchased';
      grant_expires_at: Date | null;
    }>(
      `
      SELECT recovery.id, recovery.unrecovered_credits, recovery.credit_bucket, recovery.grant_expires_at
      FROM stripe_payment_recoveries recovery
      INNER JOIN payment_records payment ON payment.id = recovery.payment_record_id
      WHERE payment.user_id = $1
        AND payment.organization_id IS NULL
        AND recovery.unrecovered_credits > 0
      ORDER BY recovery.created_at, recovery.id
      FOR UPDATE OF recovery
      `,
      [userId],
    );
    let balance = lockedBalance;
    let totalReversed = 0;
    for (const recovery of recoveries.rows) {
      const monthlyPeriodMatches = recovery.credit_bucket === 'monthly'
        && recovery.grant_expires_at !== null
        && recovery.grant_expires_at.getTime() > Date.now()
        && balance.monthlyExpiresAt?.getTime() === recovery.grant_expires_at.getTime();
      const recoveryDue = Number(recovery.unrecovered_credits);
      const monthlyAmount = monthlyPeriodMatches ? Math.min(balance.monthlyCredits, recoveryDue) : 0;
      // A later purchased-credit grant pays any remaining debt, including a
      // stale subscription period, without taking credits from a newer month.
      const purchasedAmount = Math.min(balance.purchasedCredits, recoveryDue - monthlyAmount);
      const amount = monthlyAmount + purchasedAmount;
      if (amount <= 0) continue;
      balance = await this.updateBalance(
        {
          ...balance,
          monthlyCredits: balance.monthlyCredits - monthlyAmount,
          purchasedCredits: balance.purchasedCredits - purchasedAmount,
        },
        client,
      );
      await client.query(
        `
        UPDATE stripe_payment_recoveries
        SET reversed_credits = reversed_credits + $2,
            unrecovered_credits = unrecovered_credits - $2,
            updated_at = NOW()
        WHERE id = $1
        `,
        [recovery.id, amount],
      );
      await this.insertLedger(
        {
          userId,
          type: 'purchase_reversal',
          amount: -amount,
          monthlyDelta: -monthlyAmount,
          purchasedDelta: -purchasedAmount,
          monthlyAfter: balance.monthlyCredits,
          purchasedAfter: balance.purchasedCredits,
          description: 'Stripe payment credit recovery',
          stripePaymentRecoveryId: recovery.id,
        },
        client,
      );
      totalReversed += amount;
    }
    return totalReversed;
  }

  public async getPaidGenerationRecoveryStatus(
    userId: string,
    client: DatabaseClient = this.client,
  ): Promise<PaidGenerationRecoveryStatus> {
    const result = await client.query<{ recovery_credits_due: string; paid_generation_blocked: boolean }>(
      `
      SELECT
        COALESCE((
          SELECT SUM(recovery.unrecovered_credits)
          FROM stripe_payment_recoveries recovery
          INNER JOIN payment_records payment ON payment.id = recovery.payment_record_id
          WHERE payment.user_id = $1 AND payment.organization_id IS NULL
        ), 0)::text AS recovery_credits_due,
        (
          EXISTS (
            SELECT 1
            FROM stripe_payment_recoveries recovery
            INNER JOIN payment_records payment ON payment.id = recovery.payment_record_id
            WHERE payment.user_id = $1
              AND payment.organization_id IS NULL
              AND (
                recovery.unrecovered_credits > 0
                OR EXISTS (
                  SELECT 1 FROM stripe_payment_adjustment_objects adjustment
                  WHERE adjustment.recovery_id = recovery.id
                    AND adjustment.status IN ('pending', 'open')
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM stripe_unresolved_payment_adjustments unresolved
            INNER JOIN payment_records payment ON payment.id = unresolved.payment_record_id
            WHERE payment.user_id = $1
              AND payment.organization_id IS NULL
              AND unresolved.resolved_at IS NULL
              AND unresolved.status NOT IN ('failed', 'won')
          )
        ) AS paid_generation_blocked
      `,
      [userId],
    );
    return {
      paidGenerationBlocked: result.rows[0]?.paid_generation_blocked ?? false,
      recoveryCreditsDue: Number(result.rows[0]?.recovery_credits_due ?? '0'),
    };
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
