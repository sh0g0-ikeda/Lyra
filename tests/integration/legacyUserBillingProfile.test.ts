import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresBillingRepository } from '../../src/repositories/BillingRepository.js';
import { PostgresUserRepository } from '../../src/repositories/UserRepository.js';
import { TransactionalUserProvisioningService } from '../../src/services/auth/TransactionalUserProvisioningService.js';
import { rejectionOf } from './asyncPostgresAssertions.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const legacyMigrations = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

/**
 * The old request status is the sole deletion authority in this profile. These
 * tests use the exact archived migration lineage so a canonical-only column can
 * never make the compatibility path appear to pass.
 */
describePostgres('legacy 2debe user and billing status compatibility', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `legacy_user_billing_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 8,
    });
    database = testDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: legacyMigrations,
    }));
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('blocked requestでは通常loginとbilling更新を維持する', async () => {
    const subject = randomUUID();
    const userId = await insertLegacyUser(pool, subject);
    await insertLegacyRequest(pool, userId, subject, 'blocked');
    await pool.query(
      'UPDATE account_deletion_requests SET completed_at = NOW(), data_anonymized_at = NOW() WHERE user_id = $1',
      [userId],
    );
    const users = new PostgresUserRepository(database, 'legacy_2debe_v1');
    const billing = new PostgresBillingRepository(database, database, 'legacy_2debe_v1');

    expect((await users.findBySupabaseId(subject))?.id).toBe(userId);
    expect((await billing.findBillingUserProfile(userId))?.accountDeleted).toBeUndefined();
    expect(await billing.setStripeCustomerId(userId, `cus_${subject.replaceAll('-', '')}`)).not.toBeNull();
    expect(await billing.updateUserPlanCode(userId, 'standard', database)).toBe(true);
    expect((await pool.query(
      'SELECT plan_code, stripe_customer_id FROM users WHERE id = $1',
      [userId],
    )).rows[0]).toMatchObject({ plan_code: 'standard' });
  });

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    '%s requestではloginとbilling更新を拒否して旧rowを変えない',
    async (status) => {
      const subject = randomUUID();
      const userId = await insertLegacyUser(pool, subject);
      await insertLegacyRequest(pool, userId, subject, status);
      const users = new PostgresUserRepository(database, 'legacy_2debe_v1');
      const billing = new PostgresBillingRepository(database, database, 'legacy_2debe_v1');

      expect(await users.findBySupabaseId(subject)).toBeNull();
      expect((await billing.findBillingUserProfile(userId))?.accountDeleted).toBe(true);
      expect(await billing.setStripeCustomerId(userId, `cus_${subject.replaceAll('-', '')}`)).toBeNull();
      expect(await billing.updateUserPlanCode(userId, 'premium', database)).toBe(false);
      expect((await pool.query(
        'SELECT plan_code, stripe_customer_id FROM users WHERE id = $1',
        [userId],
      )).rows[0]).toEqual({ plan_code: 'free', stripe_customer_id: null });
    },
  );

  it('secret未設定でも旧completed identityを再作成せずusersとcredit件数を増やさない', async () => {
    const subject = randomUUID();
    const userId = await insertLegacyUser(pool, `deleted:${randomUUID()}`, `deleted-${randomUUID()}@invalid.local`);
    await insertLegacyRequest(pool, userId, subject, 'completed');
    const before = await countProvisioningRows(pool);
    const service = new TransactionalUserProvisioningService(database, undefined, 'legacy_2debe_v1');

    expect(await rejectionOf(service.provisionFromSupabaseClaims({
      sub: subject,
      email: `${subject}@example.invalid`,
    }))).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    expect(await countProvisioningRows(pool)).toEqual(before);
  });

  it('requestが無い新規identityは旧profileでも通常作成してsignup creditを一度だけ付与する', async () => {
    const subject = randomUUID();
    const service = new TransactionalUserProvisioningService(database, undefined, 'legacy_2debe_v1');
    const provisioned = await service.provisionFromSupabaseClaims({
      sub: subject,
      email: `${subject}@example.invalid`,
    });

    expect(provisioned.isNewUser).toBe(true);
    expect((await pool.query(
      'SELECT purchased_credits FROM credit_balances WHERE user_id = $1',
      [provisioned.user.id],
    )).rows).toEqual([{ purchased_credits: 30 }]);
    expect((await pool.query(
      "SELECT count(*)::int AS count FROM credit_ledger WHERE user_id = $1 AND type = 'signup_bonus'",
      [provisioned.user.id],
    )).rows).toEqual([{ count: 1 }]);
  });
});

async function insertLegacyUser(
  pool: Pool,
  subject: string,
  email = `${subject}@example.invalid`,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO users (supabase_id, email) VALUES ($1, $2) RETURNING id',
    [subject, email],
  );
  return result.rows[0].id;
}

async function insertLegacyRequest(
  pool: Pool,
  userId: string,
  identityId: string,
  status: 'blocked' | 'processing' | 'pending_external_action' | 'completed',
): Promise<void> {
  await pool.query(
    'INSERT INTO account_deletion_requests (user_id, identity_id, status) VALUES ($1, $2, $3)',
    [userId, identityId, status],
  );
}

async function countProvisioningRows(pool: Pool): Promise<{
  users: number;
  balances: number;
  ledger: number;
}> {
  const result = await pool.query<{ users: number; balances: number; ledger: number }>(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM credit_balances) AS balances,
       (SELECT count(*)::int FROM credit_ledger) AS ledger`,
  );
  return result.rows[0];
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> => pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(
            text: string,
            values?: readonly unknown[],
          ): Promise<QueryResult<Row>> => client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
