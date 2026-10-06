export class PostgresCreditRepository {
    client;
    transactionRunner;
    constructor(client, transactionRunner) {
        this.client = client;
        this.transactionRunner = transactionRunner;
    }
    async transaction(work) {
        return this.transactionRunner.transaction(work);
    }
    async getBalance(userId, client = this.client) {
        const result = await client.query(`
      SELECT user_id, monthly_credits, purchased_credits, monthly_expires_at
      FROM credit_balances
      WHERE user_id = $1
      `, [userId]);
        return result.rows[0] === undefined ? null : mapCreditBalanceRow(result.rows[0]);
    }
    async getBalanceForUpdate(userId, client) {
        // First-time grants/refunds need a concrete balance row to lock; otherwise
        // concurrent requests can both observe "no row" and race on INSERT.
        await client.query(`
      INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits)
      VALUES ($1, 0, 0)
      ON CONFLICT (user_id) DO NOTHING
      `, [userId]);
        const result = await client.query(`
      SELECT user_id, monthly_credits, purchased_credits, monthly_expires_at
      FROM credit_balances
      WHERE user_id = $1
      FOR UPDATE
      `, [userId]);
        return result.rows[0] === undefined ? null : mapCreditBalanceRow(result.rows[0]);
    }
    async createBalance(balance, client) {
        const result = await client.query(`
      INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits, monthly_expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING user_id, monthly_credits, purchased_credits, monthly_expires_at
      `, [balance.userId, balance.monthlyCredits, balance.purchasedCredits, balance.monthlyExpiresAt]);
        return mapCreditBalanceRow(result.rows[0]);
    }
    async updateBalance(balance, client) {
        const result = await client.query(`
      UPDATE credit_balances
      SET monthly_credits = $2,
          purchased_credits = $3,
          monthly_expires_at = $4,
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, monthly_credits, purchased_credits, monthly_expires_at
      `, [balance.userId, balance.monthlyCredits, balance.purchasedCredits, balance.monthlyExpiresAt]);
        return mapCreditBalanceRow(result.rows[0]);
    }
    async hasLedgerEntry(userId, type, client) {
        const result = await client.query(`
      SELECT 1
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
      LIMIT 1
      `, [userId, type]);
        return (result.rowCount ?? 0) > 0;
    }
    async countJobLedgerEntries(userId, type, jobId, client) {
        const result = await client.query(`
      SELECT COUNT(*)::text AS count
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
        AND job_id = $3
      `, [userId, type, jobId]);
        return Number(result.rows[0]?.count ?? '0');
    }
    async sumJobLedgerAmount(userId, type, jobId, client) {
        const result = await client.query(`
      SELECT COALESCE(SUM(amount), 0)::text AS amount
      FROM credit_ledger
      WHERE user_id = $1
        AND type = $2
        AND job_id = $3
      `, [userId, type, jobId]);
        return Number(result.rows[0]?.amount ?? '0');
    }
    async sumJobLedgerBucketDeltas(userId, type, jobId, client) {
        const result = await client.query(`
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
      `, [userId, type, jobId]);
        const row = result.rows[0];
        return {
            monthlyDelta: Number(row?.monthly_delta ?? '0'),
            purchasedDelta: Number(row?.purchased_delta ?? '0'),
            entryCount: Number(row?.entry_count ?? '0'),
            completeEntryCount: Number(row?.complete_entry_count ?? '0'),
        };
    }
    async insertLedger(entry, client) {
        await client.query(`
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
        job_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
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
        ]);
    }
}
function mapCreditBalanceRow(row) {
    return {
        userId: row.user_id,
        monthlyCredits: row.monthly_credits,
        purchasedCredits: row.purchased_credits,
        monthlyExpiresAt: row.monthly_expires_at,
    };
}
