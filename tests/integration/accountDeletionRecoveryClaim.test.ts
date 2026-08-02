import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('account deletion recovery claim', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `account_delete_recovery_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schemaName);
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    pool = createPool(schemaName);
    const applied = await withPostgresTestMigrationLock(adminPool, () => runPendingMigrations(
      new PoolTransactionDatabase(pool),
      { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 },
    ));
    expect(applied.at(-1)).toBe('039_connect_generation_terminal_push_outbox.sql');
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.end();
    }
    if (adminPool !== undefined && schemaName !== undefined) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await adminPool.end();
    }
  });

  it('recoverable requestを曖昧な列参照なしでprocessing claimへ更新する', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const processingToken = '22222222-2222-4222-8222-222222222222';
    await pool.query(
      `INSERT INTO users (id, supabase_id, email)
       VALUES ($1::uuid, 'recovery-subject', 'recovery@example.invalid')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO account_deletion_requests (
         user_id,
         identity_id,
         identity_key,
         status,
         next_retry_at,
         last_failure_code
       ) VALUES (
         $1::uuid,
         'recovery-subject',
         repeat('a', 43),
         'pending_external_action',
         NOW() - INTERVAL '1 minute',
         'provider_timeout'
       )`,
      [userId],
    );

    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresAccountDeletionRepository(database, database);

    await expect(repository.claimNextRecoverable(processingToken)).resolves.toMatchObject({
      userId,
      status: 'processing',
      processingToken,
    });
    const persisted = await pool.query<{
      status: string;
      processing_token: string | null;
      last_failure_code: string | null;
    }>(
      `SELECT status, processing_token::text, last_failure_code
       FROM account_deletion_requests
       WHERE user_id = $1::uuid`,
      [userId],
    );
    expect(persisted.rows[0]).toEqual({
      status: 'processing',
      processing_token: processingToken,
      last_failure_code: null,
    });
  });
});

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the account deletion recovery test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^account_delete_recovery_[0-9]+_[0-9]+$/u.test(schemaName)) {
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
