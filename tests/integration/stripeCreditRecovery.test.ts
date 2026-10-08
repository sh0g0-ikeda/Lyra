import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { assertCreditRecoverySchema } from '../../src/lib/creditRecoverySchemaGuard.js';
import { PostgresCreditRepository } from '../../src/repositories/CreditRepository.js';
import { PostgresOrganizationRepository } from '../../src/repositories/OrganizationRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;

describePostgres('stripe credit recovery', () => {
  let admin: Pool;
  let pool: Pool;
  let database: PoolTransactionDatabase;
  let schema: string;

  beforeAll(async () => {
    admin = createPool();
    schema = `stripe_recovery_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(schema);
    database = new PoolTransactionDatabase(pool);
    const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    expect(applied).toContain('049_add_stripe_credit_recovery.sql');
    await assertCreditRecoverySchema(database);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined && schema !== undefined) {
      assertSafeSchemaName(schema);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('並行settleでも購入残高を二重回収しない', async () => {
    const fixture = await insertRecoveryFixture({ bucket: 'purchased', balance: 50, due: 100 });
    const repository = new PostgresCreditRepository(database, database);

    const settled = await Promise.all([
      repository.transaction((client) => repository.settleOutstandingStripeRecoveries(fixture.userId, client)),
      repository.transaction((client) => repository.settleOutstandingStripeRecoveries(fixture.userId, client)),
    ]);

    expect(settled.reduce((sum, value) => sum + value, 0)).toBe(50);
    await expectRecoveryState(fixture, { monthly: 0, purchased: 0, reversed: 50, due: 50, ledgerCount: 1 });
  });

  it('回収checkの定義が弱められた場合に実DBのreceiptがあっても起動を拒否する', async () => {
    const result = await pool.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='stripe_payment_recoveries'::regclass AND conname='stripe_payment_recoveries_credit_totals_check'`);
    const definition = result.rows[0]!.definition;
    await pool.query('ALTER TABLE stripe_payment_recoveries DROP CONSTRAINT stripe_payment_recoveries_credit_totals_check, ADD CONSTRAINT stripe_payment_recoveries_credit_totals_check CHECK (true)');
    try { await expect(assertCreditRecoverySchema(database)).rejects.toThrow('049'); }
    finally { await pool.query('ALTER TABLE stripe_payment_recoveries DROP CONSTRAINT stripe_payment_recoveries_credit_totals_check, ADD CONSTRAINT stripe_payment_recoveries_credit_totals_check ' + definition); }
    await expect(assertCreditRecoverySchema(database)).resolves.toBeUndefined();
  });

  it('同じ月次periodの返金は月次を先に使い不足を購入creditから回収する', async () => {
    const periodEnd = new Date('2099-02-01T00:00:00.000Z');
    const fixture = await insertRecoveryFixture({
      bucket: 'monthly', balance: 30, purchasedBalance: 15, due: 50,
      balanceExpiresAt: periodEnd, grantExpiresAt: periodEnd,
    });
    const repository = new PostgresCreditRepository(database, database);

    const settled = await repository.transaction(
      (client) => repository.settleOutstandingStripeRecoveries(fixture.userId, client),
    );

    expect(settled).toBe(45);
    await expectRecoveryState(fixture, { monthly: 0, purchased: 0, reversed: 45, due: 5, ledgerCount: 1 });
  });

  it('過去periodの月次債務は現在月を保護して購入creditだけから回収する', async () => {
    const fixture = await insertRecoveryFixture({
      bucket: 'monthly',
      balance: 80,
      purchasedBalance: 20,
      due: 50,
      balanceExpiresAt: new Date('2099-03-01T00:00:00.000Z'),
      grantExpiresAt: new Date('2099-02-01T00:00:00.000Z'),
    });
    const repository = new PostgresCreditRepository(database, database);

    const settled = await repository.transaction(
      (client) => repository.settleOutstandingStripeRecoveries(fixture.userId, client),
    );

    expect(settled).toBe(20);
    await expectRecoveryState(fixture, { monthly: 80, purchased: 0, reversed: 20, due: 30, ledgerCount: 1 });
  });

  it('周期metadata未確定の過去subscription調整は不足額0でも有料生成を保留する', async () => {
    const userId = randomUUID();
    const paymentRecordId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, supabase_id, email) VALUES ($1::uuid, $2, $3)`,
      [userId, `stripe-hold-${userId}`, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO payment_records (
         id, user_id, stripe_invoice_id, kind, amount_jpy, status
       ) VALUES ($1::uuid, $2::uuid, 'in_legacy_hold', 'subscription', 2000, 'paid')`,
      [paymentRecordId, userId],
    );
    await pool.query(
      `INSERT INTO stripe_unresolved_payment_adjustments (
         payment_record_id, stripe_payment_intent_id, stripe_charge_id, provider_type,
         provider_object_id, status, amount_jpy, observed_refunded_amount_jpy, last_stripe_event_id
       ) VALUES ($1::uuid, 'pi_legacy_hold', 'ch_legacy_hold', 'refund',
                 're_legacy_hold', 'succeeded', 2000, 2000, 'evt_legacy_hold')`,
      [paymentRecordId],
    );
    const repository = new PostgresCreditRepository(database, database);

    await expect(repository.getPaidGenerationRecoveryStatus(userId)).resolves.toEqual({
      paidGenerationBlocked: true,
      recoveryCreditsDue: 0,
    });
  });

  it('法人の過去月次債務は現在月を保護しorganizationの購入creditだけで回収する', async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const paymentRecordId = randomUUID();
    const recoveryId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, supabase_id, email) VALUES ($1::uuid, $2, $3)`,
      [userId, `stripe-org-${userId}`, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO credit_balances (user_id, purchased_credits) VALUES ($1::uuid, 25)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, created_by_user_id)
       VALUES ($1::uuid, 'Recovery Org', $2::uuid)`,
      [organizationId, userId],
    );
    await pool.query(
      `INSERT INTO organization_credit_balances (
         organization_id, monthly_credits, purchased_credits, monthly_expires_at
       ) VALUES ($1::uuid, 80, 40, '2099-03-01T00:00:00.000Z')`,
      [organizationId],
    );
    await pool.query(
      `INSERT INTO payment_records (
         id, user_id, organization_id, stripe_invoice_id, kind, amount_jpy, status,
         granted_credits, credit_bucket, grant_expires_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'subscription', 2000, 'paid',
                 100, 'monthly', '2099-02-01T00:00:00.000Z')`,
      [paymentRecordId, userId, organizationId, `in_${paymentRecordId}`],
    );
    await pool.query(
      `INSERT INTO stripe_payment_recoveries (
         id, payment_record_id, stripe_payment_intent_id, currency, credit_bucket,
         granted_credits, grant_expires_at, target_reversal_credits, unrecovered_credits
       ) VALUES ($1::uuid, $2::uuid, $3, 'jpy', 'monthly', 100,
                 '2099-02-01T00:00:00.000Z', 60, 60)`,
      [recoveryId, paymentRecordId, `pi_${paymentRecordId}`],
    );
    const repository = new PostgresOrganizationRepository(database, database);

    const settled = await repository.transaction(
      (client) => repository.settleOutstandingStripeRecoveries(organizationId, client),
    );

    expect(settled).toBe(40);
    const state = await pool.query<{
      personal_purchased: number; organization_monthly: number; organization_purchased: number;
      due: number; ledger_scope: string;
    }>(
      `SELECT personal.purchased_credits AS personal_purchased,
              organization.monthly_credits AS organization_monthly,
              organization.purchased_credits AS organization_purchased,
              recovery.unrecovered_credits AS due,
              ledger.organization_id::text AS ledger_scope
       FROM credit_balances personal
       INNER JOIN organization_credit_balances organization ON organization.organization_id = $2::uuid
       INNER JOIN stripe_payment_recoveries recovery ON recovery.id = $3::uuid
       INNER JOIN credit_ledger ledger ON ledger.stripe_payment_recovery_id = recovery.id
       WHERE personal.user_id = $1::uuid`,
      [userId, organizationId, recoveryId],
    );
    expect(state.rows[0]).toEqual({
      personal_purchased: 25,
      organization_monthly: 80,
      organization_purchased: 0,
      due: 20,
      ledger_scope: organizationId,
    });
  });

  async function insertRecoveryFixture(input: {
    bucket: 'monthly' | 'purchased';
    balance: number;
    purchasedBalance?: number;
    due: number;
    balanceExpiresAt?: Date;
    grantExpiresAt?: Date;
  }): Promise<{ userId: string; recoveryId: string }> {
    const userId = randomUUID();
    const paymentRecordId = randomUUID();
    const recoveryId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, supabase_id, email) VALUES ($1::uuid, $2, $3)`,
      [userId, `stripe-recovery-${userId}`, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits, monthly_expires_at)
       VALUES ($1::uuid, $2, $3, $4)`,
      [userId, input.bucket === 'monthly' ? input.balance : 0,
        input.bucket === 'purchased' ? input.balance : input.purchasedBalance ?? 0, input.balanceExpiresAt ?? null],
    );
    await pool.query(
      `INSERT INTO payment_records (
         id, user_id, stripe_checkout_session_id, stripe_invoice_id, kind, amount_jpy, status,
         granted_credits, credit_bucket, grant_expires_at
       ) VALUES ($1::uuid, $2::uuid, $3, NULL, $4, 2000, 'paid', 100, $5, $6)`,
      [paymentRecordId, userId, `cs_${paymentRecordId}`, input.bucket === 'monthly' ? 'subscription' : 'credit_purchase',
        input.bucket, input.grantExpiresAt ?? null],
    );
    await pool.query(
      `INSERT INTO stripe_payment_recoveries (
         id, payment_record_id, stripe_payment_intent_id, currency, credit_bucket,
         granted_credits, grant_expires_at, target_reversal_credits, unrecovered_credits
       ) VALUES ($1::uuid, $2::uuid, $3, 'jpy', $4, 100, $5, $6, $6)`,
      [recoveryId, paymentRecordId, `pi_${paymentRecordId}`, input.bucket, input.grantExpiresAt ?? null, input.due],
    );
    return { userId, recoveryId };
  }

  async function expectRecoveryState(
    fixture: { userId: string; recoveryId: string },
    expected: { monthly: number; purchased: number; reversed: number; due: number; ledgerCount: number },
  ): Promise<void> {
    const result = await pool.query<{
      monthly_credits: number; purchased_credits: number; reversed_credits: number;
      unrecovered_credits: number; ledger_count: string;
    }>(
      `SELECT balance.monthly_credits, balance.purchased_credits,
              recovery.reversed_credits, recovery.unrecovered_credits,
              COUNT(ledger.id)::text AS ledger_count
       FROM credit_balances balance
       INNER JOIN stripe_payment_recoveries recovery ON recovery.id = $2::uuid
       LEFT JOIN credit_ledger ledger ON ledger.stripe_payment_recovery_id = recovery.id
       WHERE balance.user_id = $1::uuid
       GROUP BY balance.monthly_credits, balance.purchased_credits,
                recovery.reversed_credits, recovery.unrecovered_credits`,
      [fixture.userId, fixture.recoveryId],
    );
    expect(result.rows[0]).toEqual({
      monthly_credits: expected.monthly,
      purchased_credits: expected.purchased,
      reversed_credits: expected.reversed,
      unrecovered_credits: expected.due,
      ledger_count: String(expected.ledgerCount),
    });
  }
});

function createPool(schema?: string): Pool {
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required for stripe recovery integration tests');
  return new Pool({
    connectionString: databaseUrl,
    max: 6,
    ...(schema === undefined ? {} : { options: `-c search_path=${schema},public` }),
  });
}

function assertSafeSchemaName(schema: string): void {
  if (!/^stripe_recovery_[0-9]+_[0-9]+$/u.test(schema)) throw new Error('Unsafe PostgreSQL test schema name');
}

class PoolTransactionDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
          client.query<R>(text, values === undefined ? undefined : [...values]),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
