import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEpisodeExportJobRepository } from '../../src/repositories/EpisodeExportJobRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('story deletion safety', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `story_delete_${process.pid}_${Date.now()}`;
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

  it('削除が先にlockした場合はepisode削除後のpage job作成を拒否する', async () => {
    const ids = createFixtureIds();
    const deletionDatabase = new PausingTransactionDatabase(pool, 'DELETE FROM episodes');
    const generationDatabase = new PoolTransactionDatabase(pool);
    const storyRepository = new PostgresStoryRepository(deletionDatabase, deletionDatabase);
    const generationRepository = new PostgresGenerationJobRepository(generationDatabase);

    try {
      await insertFixture(pool, ids);
      const deletionPromise = storyRepository.deleteEpisode(ids.episodeId, ids.userId);
      await deletionDatabase.waitUntilPaused();
      const generationPromise = generationRepository.create(createPageJobInput(ids));

      try {
        await expectPromiseToRemainPending(generationPromise);
      } finally {
        deletionDatabase.release();
      }

      await expect(deletionPromise).resolves.toBe(true);
      await expect(generationPromise).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(countRows(pool, 'episodes', ids.episodeId)).resolves.toBe(0);
      await expect(countRows(pool, 'generation_jobs', ids.jobId)).resolves.toBe(0);
    } finally {
      deletionDatabase.release();
      await removeFixture(pool, ids);
    }
  }, 30_000);

  it('job受付が先にlockした場合はactive jobを残してepisode削除を拒否する', async () => {
    const ids = createFixtureIds();
    const generationDatabase = new PausingTransactionDatabase(pool, 'INSERT INTO generation_jobs');
    const deletionDatabase = new PoolTransactionDatabase(pool);
    const generationRepository = new PostgresGenerationJobRepository(generationDatabase);
    const storyRepository = new PostgresStoryRepository(deletionDatabase, deletionDatabase);

    try {
      await insertFixture(pool, ids);
      const generationPromise = generationRepository.create(createPageJobInput(ids));
      await generationDatabase.waitUntilPaused();
      const deletionPromise = storyRepository.deleteEpisode(ids.episodeId, ids.userId);

      try {
        await expectPromiseToRemainPending(deletionPromise);
      } finally {
        generationDatabase.release();
      }

      await expect(generationPromise).resolves.toMatchObject({ id: ids.jobId, status: 'queued' });
      await expect(deletionPromise).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(countRows(pool, 'episodes', ids.episodeId)).resolves.toBe(1);
      await expect(countRows(pool, 'generation_jobs', ids.jobId)).resolves.toBe(1);
    } finally {
      generationDatabase.release();
      await removeFixture(pool, ids);
    }
  }, 30_000);

  it('削除が先にlockした場合はfailed page jobのretryを拒否する', async () => {
    const ids = createFixtureIds();
    const deletionDatabase = new PausingTransactionDatabase(pool, 'DELETE FROM episodes');
    const retryDatabase = new PoolTransactionDatabase(pool);
    const storyRepository = new PostgresStoryRepository(deletionDatabase, deletionDatabase);
    const generationRepository = new PostgresGenerationJobRepository(retryDatabase);

    try {
      await insertFixture(pool, ids);
      await generationRepository.create(createPageJobInput(ids));
      await pool.query(
        `UPDATE generation_jobs
         SET status = 'failed',
             error_message = 'retryable test failure',
             completed_at = NOW()
         WHERE id = $1::uuid`,
        [ids.jobId],
      );

      const deletionPromise = storyRepository.deleteEpisode(ids.episodeId, ids.userId);
      await deletionDatabase.waitUntilPaused();
      const retryPromise = generationRepository.prepareRetry(ids.jobId, 3);

      try {
        await expectPromiseToRemainPending(retryPromise);
      } finally {
        deletionDatabase.release();
      }

      await expect(deletionPromise).resolves.toBe(true);
      await expect(retryPromise).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(countRows(pool, 'episodes', ids.episodeId)).resolves.toBe(0);
      await expect(readGenerationJobStatus(pool, ids.jobId)).resolves.toBe('failed');
    } finally {
      deletionDatabase.release();
      await removeFixture(pool, ids);
    }
  }, 30_000);

  it('exportのpage lockと話削除が競合してもdeadlockせずexportを保護する', async () => {
    const ids = createFixtureIds();
    const exportDatabase = new PausingAfterQueryTransactionDatabase(
      pool,
      'SELECT pages.id AS page_id',
    );
    const deletionDatabase = new PoolTransactionDatabase(pool);
    const exportRepository = new PostgresEpisodeExportJobRepository(
      exportDatabase,
      exportDatabase,
    );
    const storyRepository = new PostgresStoryRepository(deletionDatabase, deletionDatabase);

    try {
      await insertFixture(pool, ids);
      await saveGeneratedPageImage(pool, ids);
      const exportPromise = exportRepository.createOrGet({
        userId: ids.userId,
        organizationId: null,
        episodeId: ids.episodeId,
        format: 'pdf',
        filename: 'story.pdf',
        pageIds: [ids.pageId],
        requestFingerprint: 'a'.repeat(64),
        idempotencyKey: `story-delete-${ids.jobId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await exportDatabase.waitUntilPaused();
      const deletionPromise = storyRepository.deleteEpisode(ids.episodeId, ids.userId);

      try {
        await expectPromiseToRemainPending(deletionPromise);
      } finally {
        exportDatabase.release();
      }

      await expect(exportPromise).resolves.toMatchObject({ created: true });
      await expect(deletionPromise).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(countRows(pool, 'episodes', ids.episodeId)).resolves.toBe(1);
      await expect(countEpisodeExportRows(pool, ids.episodeId)).resolves.toBe(1);
    } finally {
      exportDatabase.release();
      await removeFixture(pool, ids);
    }
  }, 30_000);

  it('保存済みpage画像がある章はS3 orphanを避けるため削除しない', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresStoryRepository(database, database);

    try {
      await insertFixture(pool, ids);
      await saveGeneratedPageImage(pool, ids);

      await expect(repository.deleteChapter(ids.chapterId, ids.userId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(countRows(pool, 'chapters', ids.chapterId)).resolves.toBe(1);
      await expect(countRows(pool, 'pages', ids.pageId)).resolves.toBe(1);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('queued episode exportがある話はartifact workflowを壊さず削除しない', async () => {
    const ids = createFixtureIds();
    const exportJobId = randomUUID();
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresStoryRepository(database, database);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `INSERT INTO episode_export_jobs (
           id, user_id, episode_id, format, filename, page_ids,
           page_snapshot, request_fingerprint, idempotency_key, expires_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, 'pdf', 'story.pdf', ARRAY[$4::uuid],
           jsonb_build_array(jsonb_build_object(
             'page_id', $4::text,
             'page_number', 1,
             's3_key', $5::text,
             'mime_type', 'image/png'
           )),
           $6::text, $7::text, NOW() + INTERVAL '1 hour'
         )`,
        [
          exportJobId,
          ids.userId,
          ids.episodeId,
          ids.pageId,
          `saved/${ids.userId}/pages/${ids.pageId}/source.png`,
          'a'.repeat(64),
          `story-delete-${exportJobId}`,
        ],
      );

      await expect(repository.deleteEpisode(ids.episodeId, ids.userId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(countRows(pool, 'episodes', ids.episodeId)).resolves.toBe(1);
      const exportCount = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM episode_export_jobs WHERE id = $1::uuid',
        [exportJobId],
      );
      expect(exportCount.rows[0]?.count).toBe('1');
    } finally {
      await removeFixture(pool, ids);
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

function createPageJobInput(ids: FixtureIds) {
  return {
    id: ids.jobId,
    userId: ids.userId,
    jobType: 'page_generate' as const,
    generationMode: 'standard' as const,
    creditCost: 0,
    capacityLimits: { perUser: 3, global: 5 },
    params: {
      page_id: ids.pageId,
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'designing',
      previous_generation_mode: null,
    },
  };
}

async function insertFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `story-delete-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title)
     VALUES ($1::uuid, $2::uuid, 'Story deletion test')`,
    [ids.workId, ids.userId],
  );
  await pool.query(
    `INSERT INTO chapters (id, work_id, "order")
     VALUES ($1::uuid, $2::uuid, 1)`,
    [ids.chapterId, ids.workId],
  );
  await pool.query(
    `INSERT INTO episodes (id, chapter_id, "order")
     VALUES ($1::uuid, $2::uuid, 1)`,
    [ids.episodeId, ids.chapterId],
  );
  await pool.query(
    `INSERT INTO pages (id, episode_id, page_number, status)
     VALUES ($1::uuid, $2::uuid, 1, 'designing')`,
    [ids.pageId, ids.episodeId],
  );
}

async function removeFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query('DELETE FROM generation_jobs WHERE id = $1::uuid', [ids.jobId]);
  await pool.query('DELETE FROM works WHERE id = $1::uuid', [ids.workId]);
  await pool.query('DELETE FROM users WHERE id = $1::uuid', [ids.userId]);
}

async function countRows(pool: Pool, table: 'chapters' | 'episodes' | 'pages' | 'generation_jobs', id: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE id = $1::uuid`,
    [id],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function readGenerationJobStatus(pool: Pool, jobId: string): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM generation_jobs WHERE id = $1::uuid',
    [jobId],
  );
  return result.rows[0]?.status ?? null;
}

async function countEpisodeExportRows(pool: Pool, episodeId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM episode_export_jobs WHERE episode_id = $1::uuid',
    [episodeId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function saveGeneratedPageImage(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `UPDATE pages
     SET generated_image = jsonb_build_object(
       's3_key', $2::text,
       'cdn_url', 'https://images.example.invalid/page.png',
       'generation_mode', 'standard',
       'generated_at', '2026-07-31T00:00:00.000Z'
     ),
     status = 'generated',
     generation_mode = 'standard'
     WHERE id = $1::uuid`,
    [ids.pageId, `saved/${ids.userId}/pages/${ids.pageId}/${ids.jobId}.png`],
  );
}

async function expectPromiseToRemainPending(promise: Promise<unknown>): Promise<void> {
  const state = await Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
  ]);
  expect(state).toBe('pending');
}

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the PostgreSQL story deletion test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^story_delete_[0-9]+_[0-9]+$/u.test(schemaName)) {
    throw new Error('Unsafe PostgreSQL test schema name');
  }
}

class PoolTransactionDatabase implements DatabaseClient, TransactionRunner {
  public constructor(protected readonly pool: Pool) {}

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

class PausingTransactionDatabase extends PoolTransactionDatabase {
  private readonly paused = deferred<void>();
  private readonly released = deferred<void>();
  private hasPaused = false;

  public constructor(pool: Pool, private readonly pauseSql: string) {
    super(pool);
  }

  public waitUntilPaused(): Promise<void> {
    return this.paused.promise;
  }

  public release(): void {
    this.released.resolve();
  }

  public override async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wrapped: DatabaseClient = {
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<R>> => {
          if (!this.hasPaused && text.includes(this.pauseSql)) {
            this.hasPaused = true;
            this.paused.resolve();
            await this.released.promise;
          }
          return client.query<R>(text, values === undefined ? undefined : [...values]);
        },
      };
      const result = await work(wrapped);
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

class PausingAfterQueryTransactionDatabase extends PoolTransactionDatabase {
  private readonly paused = deferred<void>();
  private readonly released = deferred<void>();
  private hasPaused = false;

  public constructor(pool: Pool, private readonly pauseSql: string) {
    super(pool);
  }

  public waitUntilPaused(): Promise<void> {
    return this.paused.promise;
  }

  public release(): void {
    this.released.resolve();
  }

  public override async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wrapped: DatabaseClient = {
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<R>> => {
          const result = await client.query<R>(
            text,
            values === undefined ? undefined : [...values],
          );
          if (!this.hasPaused && text.includes(this.pauseSql)) {
            this.hasPaused = true;
            this.paused.resolve();
            await this.released.promise;
          }
          return result;
        },
      };
      const result = await work(wrapped);
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise?.(value);
    },
  };
}
