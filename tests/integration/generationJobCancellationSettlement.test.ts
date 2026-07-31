import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('generation job cancellation settlement', () => {
  it('queued page jobを取消すると同じtransactionでpageを戻し未返金creditだけを返す', async () => {
    const pool = createPool();
    const database = new PoolTransactionDatabase(pool);
    const ids = createFixtureIds();

    try {
      await insertPersonalPageJobFixture(pool, ids, true);
      const repository = new PostgresGenerationJobRepository(database);

      const cancelled = await repository.requestCancellation(ids.jobId, ids.userId);

      expect(cancelled).toMatchObject({ id: ids.jobId, status: 'cancelled' });
      const state = await pool.query<{
        job_status: string;
        page_status: string;
        monthly_credits: number;
        purchased_credits: number;
        consumed: string;
        refunded: string;
      }>(
        `SELECT generation_jobs.status AS job_status,
                pages.status AS page_status,
                credit_balances.monthly_credits,
                credit_balances.purchased_credits,
                COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'consume'), 0)::text AS consumed,
                COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'refund'), 0)::text AS refunded
         FROM generation_jobs
         INNER JOIN pages ON pages.id = $2::uuid
         INNER JOIN credit_balances ON credit_balances.user_id = generation_jobs.user_id
         LEFT JOIN credit_ledger ON credit_ledger.job_id = generation_jobs.id
         WHERE generation_jobs.id = $1::uuid
         GROUP BY generation_jobs.status,
                  pages.status,
                  credit_balances.monthly_credits,
                  credit_balances.purchased_credits`,
        [ids.jobId, ids.pageId],
      );
      expect(state.rows[0]).toEqual({
        job_status: 'cancelled',
        page_status: 'designing',
        monthly_credits: 5,
        purchased_credits: 8,
        consumed: '-3',
        refunded: '3',
      });
    } finally {
      await removeFixture(pool, ids);
      await pool.end();
    }
  });

  it('取消が先に確定したjobへの遅延consumeをDB guardが拒否する', async () => {
    const pool = createPool();
    const ids = createFixtureIds();
    const cancellationClient = await pool.connect();
    const consumeClient = await pool.connect();

    try {
      await insertPersonalPageJobFixture(pool, ids, false);
      await cancellationClient.query('BEGIN');
      await cancellationClient.query(
        'SELECT user_id FROM credit_balances WHERE user_id = $1::uuid FOR UPDATE',
        [ids.userId],
      );
      await cancellationClient.query(
        `UPDATE generation_jobs
         SET cancel_requested_at = NOW(),
             cancel_requested_by = $2::uuid,
             status = 'cancelled',
             cancelled_at = NOW(),
             completed_at = NOW()
         WHERE id = $1::uuid`,
        [ids.jobId, ids.userId],
      );

      await consumeClient.query('BEGIN');
      const balanceLock = consumeClient.query(
        'SELECT user_id FROM credit_balances WHERE user_id = $1::uuid FOR UPDATE',
        [ids.userId],
      );
      await cancellationClient.query('COMMIT');
      await balanceLock;

      const consume = consumeClient.query(
        `INSERT INTO credit_ledger (
           user_id, type, amount, monthly_delta, purchased_delta,
           monthly_after, purchased_after, description, job_id
         ) VALUES ($1::uuid, 'consume', -3, -1, -2, 4, 6, 'late consume', $2::uuid)`,
        [ids.userId, ids.jobId],
      );
      await expect(consume).rejects.toMatchObject({
        code: 'P0001',
        constraint: 'generation_job_credit_consume_active',
      });
      await consumeClient.query('ROLLBACK');

      const ledgerCount = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM credit_ledger WHERE job_id = $1::uuid',
        [ids.jobId],
      );
      expect(ledgerCount.rows[0]?.count).toBe('0');
    } finally {
      await rollbackIfOpen(cancellationClient);
      await rollbackIfOpen(consumeClient);
      cancellationClient.release();
      consumeClient.release();
      await removeFixture(pool, ids);
      await pool.end();
    }
  });

  it('processing jobでは取消要求とcommit開始のうち先にlockした側だけが成功する', async () => {
    const pool = createPool();
    const ids = createFixtureIds();
    const cancellationClient = await pool.connect();
    const commitClient = await pool.connect();

    try {
      await insertPersonalPageJobFixture(pool, ids, false, 'processing');
      await cancellationClient.query('BEGIN');
      const cancellation = await cancellationClient.query(
        `UPDATE generation_jobs
         SET cancel_requested_at = NOW(), cancel_requested_by = $2::uuid
         WHERE id = $1::uuid
           AND status = 'processing'
           AND commit_started_at IS NULL
         RETURNING id`,
        [ids.jobId, ids.userId],
      );
      expect(cancellation.rowCount).toBe(1);

      await commitClient.query('BEGIN');
      const beginCommit = commitClient.query(
        `UPDATE generation_jobs
         SET commit_started_at = NOW()
         WHERE id = $1::uuid
           AND status = 'processing'
           AND cancel_requested_at IS NULL
           AND commit_started_at IS NULL
         RETURNING id`,
        [ids.jobId],
      );
      await cancellationClient.query('COMMIT');
      expect((await beginCommit).rowCount).toBe(0);
      await commitClient.query('COMMIT');

      const state = await pool.query<{
        cancellation_requested: boolean;
        commit_started: boolean;
      }>(
        `SELECT cancel_requested_at IS NOT NULL AS cancellation_requested,
                commit_started_at IS NOT NULL AS commit_started
         FROM generation_jobs
         WHERE id = $1::uuid`,
        [ids.jobId],
      );
      expect(state.rows[0]).toEqual({ cancellation_requested: true, commit_started: false });

      await pool.query(
        `UPDATE generation_jobs
         SET cancel_requested_at = NULL,
             cancel_requested_by = NULL,
             commit_started_at = NULL
         WHERE id = $1::uuid`,
        [ids.jobId],
      );

      await commitClient.query('BEGIN');
      const committed = await commitClient.query(
        `UPDATE generation_jobs
         SET commit_started_at = NOW()
         WHERE id = $1::uuid
           AND status = 'processing'
           AND cancel_requested_at IS NULL
           AND commit_started_at IS NULL
         RETURNING id`,
        [ids.jobId],
      );
      expect(committed.rowCount).toBe(1);

      await cancellationClient.query('BEGIN');
      const lateCancellation = cancellationClient.query(
        `UPDATE generation_jobs
         SET cancel_requested_at = NOW(), cancel_requested_by = $2::uuid
         WHERE id = $1::uuid
           AND status = 'processing'
           AND commit_started_at IS NULL
         RETURNING id`,
        [ids.jobId, ids.userId],
      );
      await commitClient.query('COMMIT');
      expect((await lateCancellation).rowCount).toBe(0);
      await cancellationClient.query('COMMIT');

      const committedState = await pool.query<{
        cancellation_requested: boolean;
        commit_started: boolean;
      }>(
        `SELECT cancel_requested_at IS NOT NULL AS cancellation_requested,
                commit_started_at IS NOT NULL AS commit_started
         FROM generation_jobs
         WHERE id = $1::uuid`,
        [ids.jobId],
      );
      expect(committedState.rows[0]).toEqual({
        cancellation_requested: false,
        commit_started: true,
      });
    } finally {
      await rollbackIfOpen(cancellationClient);
      await rollbackIfOpen(commitClient);
      cancellationClient.release();
      commitClient.release();
      await removeFixture(pool, ids);
      await pool.end();
    }
  });
});

interface FixtureIds {
  userId: string;
  workId: string;
  chapterId: string;
  episodeId: string;
  pageId: string;
  jobId: string;
}

function createFixtureIds(): FixtureIds {
  return {
    userId: randomUUID(),
    workId: randomUUID(),
    chapterId: randomUUID(),
    episodeId: randomUUID(),
    pageId: randomUUID(),
    jobId: randomUUID(),
  };
}

function createPool(): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the PostgreSQL cancellation test');
  }
  return new Pool({ connectionString: databaseUrl, max: 4 });
}

async function insertPersonalPageJobFixture(
  pool: Pool,
  ids: FixtureIds,
  includeConsume: boolean,
  jobStatus: 'queued' | 'processing' = 'queued',
): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `cancellation-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO credit_balances
      (user_id, monthly_credits, purchased_credits, monthly_expires_at)
     VALUES ($1::uuid, 4, 6, NOW() + INTERVAL '30 days')`,
    [ids.userId],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title) VALUES ($1::uuid, $2::uuid, 'Cancellation test')`,
    [ids.workId, ids.userId],
  );
  await pool.query(
    `INSERT INTO chapters (id, work_id, "order") VALUES ($1::uuid, $2::uuid, 1)`,
    [ids.chapterId, ids.workId],
  );
  await pool.query(
    `INSERT INTO episodes (id, chapter_id, "order") VALUES ($1::uuid, $2::uuid, 1)`,
    [ids.episodeId, ids.chapterId],
  );
  await pool.query(
    `INSERT INTO pages (id, episode_id, page_number, status, generation_mode)
     VALUES ($1::uuid, $2::uuid, 1, 'generating', 'standard')`,
    [ids.pageId, ids.episodeId],
  );
  await pool.query(
    `INSERT INTO generation_jobs (
       id, user_id, job_type, status, generation_mode, credit_cost, params, started_at
     ) VALUES (
       $1::uuid, $2::uuid, 'page_generate', $3, 'standard', 3,
       jsonb_build_object(
         'page_id', $4::text,
         'previous_page_status', 'designing',
         'previous_generation_mode', NULL
       ),
       CASE WHEN $3 = 'processing' THEN NOW() ELSE NULL END
     )`,
    [ids.jobId, ids.userId, jobStatus, ids.pageId],
  );
  if (includeConsume) {
    await pool.query(
      `INSERT INTO credit_ledger (
         user_id, type, amount, monthly_delta, purchased_delta,
         monthly_after, purchased_after, description, job_id
       ) VALUES ($1::uuid, 'consume', -3, -1, -2, 4, 6, 'Cancellation test', $2::uuid)`,
      [ids.userId, ids.jobId],
    );
  }
}

async function removeFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query('DELETE FROM credit_ledger WHERE job_id = $1::uuid', [ids.jobId]);
  await pool.query('DELETE FROM generation_jobs WHERE id = $1::uuid', [ids.jobId]);
  await pool.query('DELETE FROM works WHERE id = $1::uuid', [ids.workId]);
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
