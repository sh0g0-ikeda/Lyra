import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresStripeRecoveryBackfillRepository } from '../../src/repositories/StripeRecoveryBackfillRepository.js';
import { StripeRecoveryBackfillService } from '../../src/services/billing/StripeRecoveryBackfillService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;

describePostgres('Stripe旧subscription回収backfill PostgreSQL境界', () => {
  let admin: Pool;
  let pool: Pool;
  let database: PoolTransactionDatabase;
  let service: StripeRecoveryBackfillService;
  let schema: string;

  beforeAll(async () => {
    admin = createPool();
    schema = `stripe_backfill_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(schema);
    database = new PoolTransactionDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    service = new StripeRecoveryBackfillService(new PostgresStripeRecoveryBackfillRepository(database));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined && schema !== undefined) {
      assertSafeSchemaName(schema);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('dry-runはread-onlyでmetadata・recovery・hold・ledger・processed markerを変更しない', async () => {
    const fixture = await insertFixture('dry_run');
    const result = await service.backfill({
      unresolvedAdjustmentId: fixture.unresolvedAdjustmentId,
      grantedCredits: 100,
      grantExpiresAt: fixture.expiresAt,
      apply: false,
    });

    expect(result.action).toBe('would_create');
    await expectState(fixture, { metadataConfigured: false, recoveryCount: 0 });
  });

  it('並行applyは同じpayment/PI/chargeへ一つだけrecoveryを作る', async () => {
    const fixture = await insertFixture('concurrent');
    const results = await Promise.all([
      service.backfill({
        unresolvedAdjustmentId: fixture.unresolvedAdjustmentId,
        grantedCredits: 175,
        grantExpiresAt: fixture.expiresAt,
        apply: true,
      }),
      service.backfill({
        unresolvedAdjustmentId: fixture.unresolvedAdjustmentId,
        grantedCredits: 175,
        grantExpiresAt: fixture.expiresAt,
        apply: true,
      }),
    ]);

    expect(results.map(item => item.action).sort()).toEqual(['already_configured', 'created']);
    await expectState(fixture, { metadataConfigured: true, grantedCredits: 175, recoveryCount: 1 });
  });

  it('同じpaymentに別PaymentIntent recoveryがある場合はtransaction全体をrollbackする', async () => {
    const fixture = await insertFixture('conflict');
    await pool.query(
      `INSERT INTO stripe_payment_recoveries (
         payment_record_id, stripe_payment_intent_id, stripe_charge_id,
         currency, credit_bucket, granted_credits, grant_expires_at
       ) VALUES ($1::uuid, 'pi_conflicting', 'ch_conflicting', 'jpy', 'monthly', 100, $2)`,
      [fixture.paymentRecordId, fixture.expiresAt],
    );

    await expect(service.backfill({
      unresolvedAdjustmentId: fixture.unresolvedAdjustmentId,
      grantedCredits: 100,
      grantExpiresAt: fixture.expiresAt,
      apply: true,
    })).rejects.toThrow('conflict');
    await expectState(fixture, { metadataConfigured: false, recoveryCount: 1 });
  });

  async function insertFixture(label: string): Promise<{
    unresolvedAdjustmentId: string;
    paymentRecordId: string;
    stripeEventId: string;
    expiresAt: Date;
  }> {
    const userId = randomUUID();
    const paymentRecordId = randomUUID();
    const unresolvedAdjustmentId = randomUUID();
    const stripeEventId = `evt_backfill_${label}`;
    const expiresAt = new Date('2026-11-01T00:00:00.000Z');
    await pool.query(
      'INSERT INTO users (id, supabase_id, email) VALUES ($1::uuid, $2, $3)',
      [userId, `backfill-${label}-${userId}`, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO payment_records (
         id, user_id, stripe_invoice_id, kind, amount_jpy, status
       ) VALUES ($1::uuid, $2::uuid, $3, 'subscription', 2000, 'paid')`,
      [paymentRecordId, userId, `in_backfill_${label}`],
    );
    await pool.query(
      `INSERT INTO stripe_unresolved_payment_adjustments (
         id, payment_record_id, stripe_payment_intent_id, stripe_charge_id,
         provider_type, provider_object_id, status, amount_jpy,
         observed_refunded_amount_jpy, last_stripe_event_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4, 'refund', $5, 'succeeded', 2000, 2000, $6)`,
      [
        unresolvedAdjustmentId,
        paymentRecordId,
        `pi_backfill_${label}`,
        `ch_backfill_${label}`,
        `re_backfill_${label}`,
        stripeEventId,
      ],
    );
    return { unresolvedAdjustmentId, paymentRecordId, stripeEventId, expiresAt };
  }

  async function expectState(
    fixture: {
      unresolvedAdjustmentId: string;
      paymentRecordId: string;
      stripeEventId: string;
      expiresAt: Date;
    },
    expected: { metadataConfigured: boolean; grantedCredits?: number; recoveryCount: number },
  ): Promise<void> {
    const state = await pool.query<{
      granted_credits: number | null;
      credit_bucket: string | null;
      grant_expires_at: Date | null;
      resolved_at: Date | null;
      recovery_count: string;
      ledger_count: string;
      processed_count: string;
    }>(
      `SELECT payment.granted_credits, payment.credit_bucket, payment.grant_expires_at,
              unresolved.resolved_at,
              (SELECT COUNT(*)::text FROM stripe_payment_recoveries recovery
                WHERE recovery.payment_record_id = payment.id) AS recovery_count,
              (SELECT COUNT(*)::text FROM credit_ledger ledger
                WHERE ledger.stripe_payment_recovery_id IN (
                  SELECT recovery.id FROM stripe_payment_recoveries recovery
                  WHERE recovery.payment_record_id = payment.id
                )) AS ledger_count,
              (SELECT COUNT(*)::text FROM processed_stripe_events processed
                WHERE processed.stripe_event_id = $3) AS processed_count
       FROM payment_records payment
       INNER JOIN stripe_unresolved_payment_adjustments unresolved
         ON unresolved.payment_record_id = payment.id
       WHERE payment.id = $1::uuid AND unresolved.id = $2::uuid`,
      [fixture.paymentRecordId, fixture.unresolvedAdjustmentId, fixture.stripeEventId],
    );
    const row = state.rows[0];
    expect(row).toBeDefined();
    expect(row?.resolved_at).toBeNull();
    expect(row?.recovery_count).toBe(String(expected.recoveryCount));
    expect(row?.ledger_count).toBe('0');
    expect(row?.processed_count).toBe('0');
    if (expected.metadataConfigured) {
      expect(row?.granted_credits).toBe(expected.grantedCredits);
      expect(row?.credit_bucket).toBe('monthly');
      expect(row?.grant_expires_at?.toISOString()).toBe(fixture.expiresAt.toISOString());
    } else {
      expect(row?.granted_credits).toBeNull();
      expect(row?.credit_bucket).toBeNull();
      expect(row?.grant_expires_at).toBeNull();
    }
  }
});

function createPool(schema?: string): Pool {
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required for Stripe backfill integration tests');
  return new Pool({
    connectionString: databaseUrl,
    max: 6,
    ...(schema === undefined ? {} : { options: `-c search_path=${schema},public` }),
  });
}

function assertSafeSchemaName(schema: string): void {
  if (!/^stripe_backfill_[0-9]+_[0-9]+$/u.test(schema)) {
    throw new Error('Unsafe PostgreSQL test schema name');
  }
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
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<R>> => client.query<R>(text, values === undefined ? undefined : [...values]),
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
