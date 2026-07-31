import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEntityGenerationExecutionRepository } from '../../src/repositories/EntityGenerationExecutionRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('generation terminal push outbox settlement', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `generation_push_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schemaName);
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);

    pool = createPool(schemaName);
    const applied = await withPostgresTestMigrationLock(adminPool, () => runPendingMigrations(
      new PoolTransactionDatabase(pool),
      {
        migrationLockPollMs: 1,
        migrationLockMaxAttempts: 10,
      },
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

  it('failed確定とtoken snapshotを原子的に保存しretry後の再失敗を別eventにする', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository(database);

    try {
      await insertFixture(pool, ids);

      await expect(repository.markFailed(ids.jobId, 'first failure')).resolves.toBe(true);
      await expect(repository.markFailed(ids.jobId, 'duplicate failure')).resolves.toBe(false);

      let events = await readEvents(pool, ids.jobId);
      expect(events).toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'pending' },
      ]);

      await expect(repository.prepareRetry(ids.jobId, 3)).resolves.toBe(true);
      events = await readEvents(pool, ids.jobId);
      expect(events).toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'canceled' },
      ]);

      await expect(repository.markFailed(ids.jobId, 'second failure')).resolves.toBe(true);
      events = await readEvents(pool, ids.jobId);
      expect(events).toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'canceled' },
        { generation_retry_count: 1, terminal_status: 'failed', delivery_status: 'pending' },
      ]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('completed確定も同じtransactionでterminal eventとtoken snapshotを作る', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresEntityGenerationExecutionRepository(database);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `UPDATE generation_jobs
         SET job_type = 'entity_generate',
             status = 'processing',
             generation_mode = NULL,
             started_at = NOW(),
             commit_started_at = NOW()
         WHERE id = $1::uuid`,
        [ids.jobId],
      );

      const completed = await repository.completeEntityGeneration({
        jobId: ids.jobId,
        userId: ids.userId,
        structuredFields: { first_impression: 'calm' },
        candidates: [],
        compiledBrief: 'calm character',
        compiledPrompt: 'calm character reference',
        openaiRequestId: null,
        costUsd: null,
        compiledPromptUsed: false,
        promptCompilerProvider: 'none',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError: null,
        imageModel: 'gpt-image-2',
        imageParams: { quality: 'medium', size: '1024x1536' },
        createdAt: new Date().toISOString(),
      });

      expect(completed).toBe(true);
      await expect(readEvents(pool, ids.jobId)).resolves.toEqual([
        { generation_retry_count: 0, terminal_status: 'completed', delivery_status: 'pending' },
      ]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('failedからretry後にcompletedになると新しいretry eventだけを配送対象にする', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const jobRepository = new PostgresGenerationJobRepository(database);
    const entityRepository = new PostgresEntityGenerationExecutionRepository(database);

    try {
      await insertFixture(pool, ids);
      await expect(jobRepository.markFailed(ids.jobId, 'failure before success')).resolves.toBe(true);
      await expect(jobRepository.prepareRetry(ids.jobId, 3)).resolves.toBe(true);
      await pool.query(
        `UPDATE generation_jobs
         SET job_type = 'entity_generate',
             status = 'processing',
             generation_mode = NULL,
             started_at = NOW(),
             commit_started_at = NOW()
         WHERE id = $1::uuid`,
        [ids.jobId],
      );

      const completed = await entityRepository.completeEntityGeneration({
        jobId: ids.jobId,
        userId: ids.userId,
        structuredFields: { first_impression: 'calm' },
        candidates: [],
        compiledBrief: 'calm character',
        compiledPrompt: 'calm character reference',
        openaiRequestId: null,
        costUsd: null,
        compiledPromptUsed: false,
        promptCompilerProvider: 'none',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError: null,
        imageModel: 'gpt-image-2',
        imageParams: { quality: 'medium', size: '1024x1536' },
        createdAt: new Date().toISOString(),
      });

      expect(completed).toBe(true);
      await expect(readEvents(pool, ids.jobId)).resolves.toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'canceled' },
        { generation_retry_count: 1, terminal_status: 'completed', delivery_status: 'pending' },
      ]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('outbox書込みが失敗した場合はjob terminal更新もrollbackする', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository(database);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `ALTER TABLE mobile_push_notification_outbox
         ADD CONSTRAINT terminal_outbox_test_reject
         CHECK (FALSE) NOT VALID`,
      );

      let settlementError: unknown = null;
      try {
        await repository.markFailed(ids.jobId, 'must rollback');
      } catch (error) {
        settlementError = error;
      }
      expect(settlementError).toMatchObject({ code: '23514' });
      const state = await pool.query<{ status: string; event_count: string }>(
        `SELECT generation_jobs.status,
                COUNT(outbox.id)::text AS event_count
         FROM generation_jobs
         LEFT JOIN mobile_push_notification_outbox AS outbox
           ON outbox.generation_job_id = generation_jobs.id
         WHERE generation_jobs.id = $1::uuid
         GROUP BY generation_jobs.status`,
        [ids.jobId],
      );
      expect(state.rows[0]).toEqual({ status: 'queued', event_count: '0' });
    } finally {
      await pool.query(
        `ALTER TABLE mobile_push_notification_outbox
         DROP CONSTRAINT IF EXISTS terminal_outbox_test_reject`,
      );
      await removeFixture(pool, ids);
    }
  });

  it('retryはprocessing deliveryをcanceledにし古いleaseのsent確定を拒否する', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository(database);
    const deliveryClient = await pool.connect();
    const leaseToken = randomUUID();

    try {
      await insertFixture(pool, ids);
      await repository.markFailed(ids.jobId, 'failure before retry');
      await deliveryClient.query('BEGIN');
      const claimed = await deliveryClient.query<{ id: string }>(
        `UPDATE mobile_push_notification_deliveries AS deliveries
         SET status = 'processing',
             locked_at = NOW(),
             lease_token = $2::uuid,
             attempt_count = attempt_count + 1,
             updated_at = NOW()
         FROM mobile_push_notification_outbox AS outbox
         WHERE deliveries.outbox_id = outbox.id
           AND outbox.generation_job_id = $1::uuid
         RETURNING deliveries.id`,
        [ids.jobId, leaseToken],
      );
      expect(claimed.rowCount).toBe(1);

      const retryPromise = repository.prepareRetry(ids.jobId, 3);
      await deliveryClient.query('COMMIT');
      await expect(retryPromise).resolves.toBe(true);

      const staleSent = await pool.query(
        `UPDATE mobile_push_notification_deliveries
         SET status = 'sent',
             sent_at = NOW(),
             locked_at = NULL,
             lease_token = NULL,
             error_code = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid
           AND status = 'processing'
           AND lease_token = $2::uuid`,
        [claimed.rows[0]?.id, leaseToken],
      );
      expect(staleSent.rowCount).toBe(0);
      await expect(readEvents(pool, ids.jobId)).resolves.toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'canceled' },
      ]);
    } finally {
      await rollbackIfOpen(deliveryClient);
      deliveryClient.release();
      await removeFixture(pool, ids);
    }
  });

  it('cancel metadataがあるjobはfailedにもoutboxにも進めない', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository(database);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `UPDATE generation_jobs
         SET status = 'processing',
             started_at = NOW(),
             cancel_requested_at = NOW(),
             cancel_requested_by = $2::uuid
         WHERE id = $1::uuid`,
        [ids.jobId, ids.userId],
      );

      await expect(repository.markFailed(ids.jobId, 'late failure')).resolves.toBe(false);
      const state = await pool.query<{ status: string; event_count: string }>(
        `SELECT generation_jobs.status,
                COUNT(outbox.id)::text AS event_count
         FROM generation_jobs
         LEFT JOIN mobile_push_notification_outbox AS outbox
           ON outbox.generation_job_id = generation_jobs.id
         WHERE generation_jobs.id = $1::uuid
         GROUP BY generation_jobs.status`,
        [ids.jobId],
      );
      expect(state.rows[0]).toEqual({ status: 'processing', event_count: '0' });
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('account deletionと同じregistry-first順でlockしjob rowとのdeadlockを作らない', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository(database);
    const deletionClient = await pool.connect();

    try {
      await insertFixture(pool, ids);
      await deletionClient.query('BEGIN');
      await deletionClient.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['mobile-push-token-registry:v1'],
      );

      const terminalPromise = repository.markFailed(ids.jobId, 'failure during deletion');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await deletionClient.query("SET LOCAL lock_timeout = '500ms'");
      const scrubbed = await deletionClient.query(
        `UPDATE generation_jobs
         SET result = '{}'::jsonb
         WHERE id = $1::uuid
         RETURNING id`,
        [ids.jobId],
      );
      expect(scrubbed.rowCount).toBe(1);
      await deletionClient.query('COMMIT');

      await expect(terminalPromise).resolves.toBe(true);
      await expect(readEvents(pool, ids.jobId)).resolves.toEqual([
        { generation_retry_count: 0, terminal_status: 'failed', delivery_status: 'pending' },
      ]);
    } finally {
      await rollbackIfOpen(deletionClient);
      deletionClient.release();
      await removeFixture(pool, ids);
    }
  });
});

interface FixtureIds {
  userId: string;
  installationId: string;
  jobId: string;
}

interface EventRow extends QueryResultRow {
  generation_retry_count: number;
  terminal_status: string;
  delivery_status: string;
}

function createFixtureIds(): FixtureIds {
  return {
    userId: randomUUID(),
    installationId: randomUUID(),
    jobId: randomUUID(),
  };
}

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the PostgreSQL terminal push test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^generation_push_[0-9]+_[0-9]+$/u.test(schemaName)) {
    throw new Error('Unsafe PostgreSQL test schema name');
  }
}

async function insertFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `push-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO mobile_push_tokens (
       user_id, installation_id, platform, locale,
       token_hash, token_ciphertext, encryption_key_id
     ) VALUES ($1::uuid, $2::uuid, 'android', 'ja', $3, $4, 'test-key-v1')`,
    [
      ids.userId,
      ids.installationId,
      ids.userId.replaceAll('-', '').repeat(2),
      `v1.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`,
    ],
  );
  await pool.query(
    `INSERT INTO generation_jobs (
       id, user_id, job_type, status, generation_mode, credit_cost, params
     ) VALUES ($1::uuid, $2::uuid, 'page_generate', 'queued', 'standard', 0, '{}'::jsonb)`,
    [ids.jobId, ids.userId],
  );
}

async function readEvents(pool: Pool, jobId: string): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT outbox.generation_retry_count,
            outbox.terminal_status,
            deliveries.status AS delivery_status
     FROM mobile_push_notification_outbox AS outbox
     INNER JOIN mobile_push_notification_deliveries AS deliveries
       ON deliveries.outbox_id = outbox.id
     WHERE outbox.generation_job_id = $1::uuid
     ORDER BY outbox.generation_retry_count, outbox.created_at, deliveries.id`,
    [jobId],
  );
  return result.rows;
}

async function removeFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query('DELETE FROM generation_jobs WHERE id = $1::uuid', [ids.jobId]);
  await pool.query('DELETE FROM users WHERE id = $1::uuid', [ids.userId]);
}

async function rollbackIfOpen(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection may already be outside a transaction after COMMIT.
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
        ): Promise<QueryResult<R>> => client.query<R>(
          text,
          values === undefined ? undefined : [...values],
        ),
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
