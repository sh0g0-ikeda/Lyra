import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined
  ? describe
  : describe.skip;

describePostgres('account deletion credit recovery guard', () => {
  let admin: Pool;
  let pool: Pool;
  let database: PoolTransactionDatabase;
  let schema: string;

  beforeAll(async () => {
    admin = createPool();
    schema = `account_delete_credit_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(schema);
    database = new PoolTransactionDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined && schema !== undefined) {
      assertSafeSchemaName(schema);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('personalのpending/open・不足債務・未解決調整だけを削除blockerにする', async () => {
    const repository = new PostgresAccountDeletionRepository(database, database);
    const pending = await insertFixture({ adjustmentStatus: 'pending' });
    const open = await insertFixture({ adjustmentStatus: 'open', providerType: 'dispute' });
    const debt = await insertFixture({ unrecoveredCredits: 25 });
    const unresolved = await insertFixture({ unresolvedStatus: 'succeeded' });
    const resolved = await insertFixture({ adjustmentStatus: 'failed', unresolvedStatus: 'won' });

    for (const fixture of [pending, open, debt, unresolved]) {
      await expect(repository.getFlight(fixture.userId)).resolves.toMatchObject({
        personalCreditRecoveryRequired: true,
      });
      const claim = await repository.claimRequest(claimInput(fixture.userId));
      expect(claim).toMatchObject({
        kind: 'blocked',
        flight: { personalCreditRecoveryRequired: true },
      });
      const user = await pool.query<{ account_deletion_started_at: Date | null }>(
        'SELECT account_deletion_started_at FROM users WHERE id = $1',
        [fixture.userId],
      );
      expect(user.rows[0]?.account_deletion_started_at).toBeNull();
    }

    await expect(repository.getFlight(resolved.userId)).resolves.toMatchObject({
      personalCreditRecoveryRequired: false,
    });
  });

  it('organizationの回収状態はpersonal account deletionを妨げない', async () => {
    const organizationId = randomUUID();
    const creatorId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, supabase_id, email)
       VALUES ($1::uuid, $2, $3)`,
      [creatorId, `organization-creator-${creatorId}`, `${creatorId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, created_by_user_id)
       VALUES ($1::uuid, 'Credit recovery organization', $2::uuid)`,
      [organizationId, creatorId],
    );
    const fixture = await insertFixture({
      organizationId,
      adjustmentStatus: 'open',
      providerType: 'dispute',
    });
    const repository = new PostgresAccountDeletionRepository(database, database);

    await expect(repository.getFlight(fixture.userId)).resolves.toMatchObject({
      personalCreditRecoveryRequired: false,
    });
  });

  it('claim後finalize前のholdを検出し、解除後だけ匿名化を再開する', async () => {
    const fixture = await insertFixture({ adjustmentStatus: 'failed' });
    const repository = new PostgresAccountDeletionRepository(database, database);
    const claim = await repository.claimRequest(claimInput(fixture.userId));
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('Expected claimed deletion request');

    await pool.query(
      `UPDATE stripe_payment_adjustment_objects
       SET status = 'pending', updated_at = NOW()
       WHERE recovery_id = $1::uuid`,
      [fixture.recoveryId],
    );
    const blocked = await repository.finalizePersonalData(
      fixture.userId,
      claim.request.processingToken,
    );
    expect(blocked).toMatchObject({
      kind: 'blocked',
      flight: { personalCreditRecoveryRequired: true },
    });
    await expectPersonalDataState(fixture.userId, false);

    await pool.query(
      `UPDATE stripe_payment_adjustment_objects
       SET status = 'failed', updated_at = NOW()
       WHERE recovery_id = $1::uuid`,
      [fixture.recoveryId],
    );
    await expect(repository.finalizePersonalData(
      fixture.userId,
      claim.request.processingToken,
    )).resolves.toEqual({ kind: 'completed' });
    await expectPersonalDataState(fixture.userId, true);
  });

  it('返金transactionがuser lockを先取した場合は並行claimがcommit後のholdを観測する', async () => {
    const fixture = await insertFixture({});
    const repository = new PostgresAccountDeletionRepository(database, database);
    const adjustmentClient = await pool.connect();
    await adjustmentClient.query('BEGIN');
    try {
      await adjustmentClient.query(
        'SELECT id FROM users WHERE id = $1::uuid FOR UPDATE',
        [fixture.userId],
      );
      await adjustmentClient.query(
        `INSERT INTO stripe_payment_adjustment_objects (
           recovery_id, provider_type, provider_object_id, amount_jpy, status,
           last_stripe_event_id
         ) VALUES ($1::uuid, 'refund', $2, 0, 'pending', $3)`,
        [fixture.recoveryId, `refund-${randomUUID()}`, `event-${randomUUID()}`],
      );

      let claimSettled = false;
      const claimPromise = repository.claimRequest(claimInput(fixture.userId))
        .then((value) => {
          claimSettled = true;
          return value;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(claimSettled).toBe(false);
      await adjustmentClient.query('COMMIT');

      await expect(claimPromise).resolves.toMatchObject({
        kind: 'blocked',
        flight: { personalCreditRecoveryRequired: true },
      });
    } catch (error) {
      await adjustmentClient.query('ROLLBACK');
      throw error;
    } finally {
      adjustmentClient.release();
    }
  });

  async function insertFixture(input: {
    organizationId?: string;
    adjustmentStatus?: 'pending' | 'failed' | 'open' | 'won';
    providerType?: 'refund' | 'dispute';
    unrecoveredCredits?: number;
    unresolvedStatus?: 'succeeded' | 'won';
  }): Promise<{ userId: string; recoveryId: string }> {
    const userId = randomUUID();
    const paymentId = randomUUID();
    const recoveryId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, supabase_id, email)
       VALUES ($1::uuid, $2, $3)`,
      [userId, `credit-delete-${userId}`, `${userId}@example.invalid`],
    );
    await pool.query(
      `INSERT INTO credit_balances (user_id, purchased_credits)
       VALUES ($1::uuid, 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO payment_records (
         id, user_id, organization_id, stripe_checkout_session_id, kind,
         amount_jpy, status, granted_credits, credit_bucket
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'credit_purchase',
                 2000, 'paid', 200, 'purchased')`,
      [paymentId, userId, input.organizationId ?? null, `checkout-${paymentId}`],
    );
    const due = input.unrecoveredCredits ?? 0;
    await pool.query(
      `INSERT INTO stripe_payment_recoveries (
         id, payment_record_id, stripe_payment_intent_id, currency,
         credit_bucket, granted_credits, target_reversal_credits,
         reversed_credits, unrecovered_credits
       ) VALUES ($1::uuid, $2::uuid, $3, 'jpy', 'purchased', 200, $4, 0, $4)`,
      [recoveryId, paymentId, `intent-${paymentId}`, due],
    );
    if (input.adjustmentStatus !== undefined) {
      const providerType = input.providerType ?? 'refund';
      await pool.query(
        `INSERT INTO stripe_payment_adjustment_objects (
           recovery_id, provider_type, provider_object_id, amount_jpy, status,
           last_stripe_event_id
         ) VALUES ($1::uuid, $2, $3, 0, $4, $5)`,
        [
          recoveryId,
          providerType,
          `${providerType}-${randomUUID()}`,
          input.adjustmentStatus,
          `event-${randomUUID()}`,
        ],
      );
    }
    if (input.unresolvedStatus !== undefined) {
      await pool.query(
        `INSERT INTO stripe_unresolved_payment_adjustments (
           payment_record_id, stripe_payment_intent_id, stripe_charge_id,
           provider_type, provider_object_id, status, amount_jpy,
           observed_refunded_amount_jpy, last_stripe_event_id
         ) VALUES ($1::uuid, $2, $3, 'refund', $4, $5, 0, 0, $6)`,
        [
          paymentId,
          `unresolved-intent-${paymentId}`,
          `charge-${paymentId}`,
          `unresolved-${randomUUID()}`,
          input.unresolvedStatus,
          `event-${randomUUID()}`,
        ],
      );
    }
    return { userId, recoveryId };
  }

  async function expectPersonalDataState(userId: string, deleted: boolean): Promise<void> {
    const result = await pool.query<{
      account_deleted_at: Date | null;
      balance_count: number;
    }>(
      `SELECT users.account_deleted_at,
              (SELECT COUNT(*)::int FROM credit_balances WHERE user_id = users.id) AS balance_count
       FROM users
       WHERE users.id = $1::uuid`,
      [userId],
    );
    expect(result.rows[0]?.account_deleted_at === null).toBe(!deleted);
    expect(result.rows[0]?.balance_count).toBe(deleted ? 0 : 1);
  }
});

function claimInput(userId: string) {
  return {
    userId,
    identityId: `identity-${userId}`,
    identityKey: 'a'.repeat(43),
    processingToken: randomUUID(),
    acknowledgePersonalSubscriptions: true,
    acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: true,
  };
}

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for account deletion credit recovery tests');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 6,
    ...(schemaName === undefined ? {} : {
      options: `-c search_path=${schemaName},public`,
    }),
  });
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^account_delete_credit_[0-9]+_[0-9]+$/u.test(schemaName)) {
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
      const result = await work(toDatabaseClient(client));
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

function toDatabaseClient(client: PoolClient): DatabaseClient {
  return {
    query: async <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => client.query<T>(
      text,
      values === undefined ? undefined : [...values],
    ),
  };
}
