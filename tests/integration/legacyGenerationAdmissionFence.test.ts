import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GenerationJobType } from '../../src/domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');
const PERSONAL_JOB_TYPES = [
  'page_generate',
  'entity_generate',
  'episode_story_autofill',
  'episode_page_skeleton',
] as const satisfies readonly GenerationJobType[];

describePostgres('legacy generation admission account-deletion fence', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `legacy_generation_fence_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 16,
    });
    database = testDatabase(pool);
    const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: LEGACY_MIGRATIONS,
    }));
    expect(applied).toHaveLength(38);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 120_000);

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    '旧personal createは退会状態%sでjobを作らず403拒否する',
    async (status) => {
      const userId = await insertUser(pool);
      await insertDeletionRequest(pool, userId, status);
      const repository = new PostgresGenerationJobRepository(database, 'legacy_2debe_v1');
      const outcome = await settle(repository.create(entityJobInput(userId)));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected create to be rejected');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(await countJobs(pool, userId)).toBe(0);
    },
  );

  it.each(PERSONAL_JOB_TYPES)(
    '旧personal createはrequest無しで旧物理job type %sを同一TX保存する',
    async (jobType) => {
      const fixture = await insertStoryFixture(pool);
      const repository = new PostgresGenerationJobRepository(database, 'legacy_2debe_v1');
      const created = await repository.create(jobInputForType(jobType, fixture));
      expect(created.jobType).toBe(jobType);
      expect(await countJobs(pool, fixture.userId)).toBe(1);
    },
  );

  it('旧personal createはblockedを許可し、存在しないuserを403拒否する', async () => {
    const userId = await insertUser(pool);
    await insertDeletionRequest(pool, userId, 'blocked');
    const repository = new PostgresGenerationJobRepository(database, 'legacy_2debe_v1');
    expect((await repository.create(entityJobInput(userId))).userId).toBe(userId);

    const missingUserId = randomUUID();
    const outcome = await settle(repository.create(entityJobInput(missingUserId)));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected missing user to be rejected');
    expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('旧organization createはactorのpersonal退会状態に影響されない', async () => {
    const userId = await insertUser(pool);
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Fence org',$2)", [organizationId, userId]);
    await pool.query(
      "INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')",
      [organizationId, userId],
    );
    await insertDeletionRequest(pool, userId, 'processing');
    const repository = new PostgresGenerationJobRepository(database, 'legacy_2debe_v1');
    const created = await repository.create({ ...entityJobInput(userId), organizationId });
    expect(created.organizationId).toBe(organizationId);
  });

  it('旧personal retryは実DB scopeでfenceしfake organization optionsでも迂回できない', async () => {
    const userId = await insertUser(pool);
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Fake retry org',$2)", [organizationId, userId]);
    await pool.query(
      "INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')",
      [organizationId, userId],
    );
    const jobId = await insertFailedJob(pool, userId);
    await insertDeletionRequest(pool, userId, 'processing');
    const repository = new PostgresGenerationJobRepository(database, 'legacy_2debe_v1');
    expect(await repository.prepareRetry(jobId, 3, {
      userId,
      organizationId,
      capacityLimits: { perUser: 3, global: 10 },
    })).toBe(false);
    const outcome = await settle(repository.prepareRetry(jobId, 3));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected personal retry to be rejected');
    expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(await jobStatus(pool, jobId)).toBe('failed');
  });

  it('退会claim先行時はgenerationがuser lockを待ちcommit後403でjobを残さない', async () => {
    const userId = await insertUser(pool);
    await insertDeletionRequest(pool, userId, 'blocked');
    const claimGate = deferred<void>();
    const claimLocked = deferred<void>();
    const claimDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('account_deletion_requests') && sql.includes('FOR UPDATE')) {
        claimLocked.resolve();
        await claimGate.promise;
      }
    });
    const writerDatabase = await PinnedDatabase.connect(pool);
    try {
      const claimRepository = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase);
      const claimPromise = claimRepository.claimRequest(claimInput(userId));
      await waitForSignal(claimLocked.promise, 'claim request lock');
      const writerRepository = new PostgresGenerationJobRepository(writerDatabase, 'legacy_2debe_v1');
      const writerPromise = settle(writerRepository.create(entityJobInput(userId)));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      claimGate.resolve();
      expect((await claimPromise).kind).toBe('claimed');
      const writer = await writerPromise;
      expect(writer.ok).toBe(false);
      if (writer.ok) throw new Error('Expected writer to be rejected after claim');
      expect(writer.error).toMatchObject({ code: 'FORBIDDEN' });
      expect(await countJobs(pool, userId)).toBe(0);
    } finally {
      claimGate.resolve();
      await claimDatabase.close();
      await writerDatabase.close();
    }
  });

  it('generation先行時はclaimがuser lockを待ちcommit後fresh job inventoryでblockedになる', async () => {
    const userId = await insertUser(pool);
    const writerGate = deferred<void>();
    const writerLocked = deferred<void>();
    const writerDatabase = await PinnedDatabase.connect(pool);
    const claimDatabase = await PinnedDatabase.connect(pool);
    try {
      const writerRepository = new PostgresGenerationJobRepository(writerDatabase, 'legacy_2debe_v1');
      const writerPromise = writerRepository.createWithAdmission(entityJobInput(userId), async () => {
        writerLocked.resolve();
        await writerGate.promise;
      });
      await writerLocked.promise;
      const claimRepository = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase);
      const claimPromise = claimRepository.claimRequest(claimInput(userId));
      await waitForBlockedQuery(pool, claimDatabase.pid);
      writerGate.resolve();
      expect((await writerPromise).status).toBe('queued');
      const claim = await claimPromise;
      expect(claim.kind).toBe('blocked');
      if (claim.kind !== 'blocked') throw new Error('Expected claim blocker');
      expect(claim.flight.activePersonalGenerationJobCount).toBe(1);
      expect((await pool.query('SELECT status FROM account_deletion_requests WHERE user_id=$1', [userId])).rows[0]).toBeUndefined();
    } finally {
      writerGate.resolve();
      await writerDatabase.close();
      await claimDatabase.close();
    }
  });

  it('匿名化先行時はgenerationがuser lockを待ち匿名化後403となり既存org・subscription・pushを守る', async () => {
    const userId = await insertUser(pool);
    const otherUserId = await insertUser(pool);
    const processingToken = randomUUID();
    await pool.query(
      `INSERT INTO account_deletion_requests(user_id,identity_id,status,processing_token,processing_started_at)
       VALUES($1,$2,'processing',$3,NOW())`,
      [userId, `identity-${userId}`, processingToken],
    );
    const personalWorkId = randomUUID();
    const organizationId = randomUUID();
    const organizationWorkId = randomUUID();
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Personal work')", [personalWorkId, userId]);
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Preserved org',$2)", [organizationId, otherUserId]);
    await pool.query(
      "INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')",
      [organizationId, userId],
    );
    await pool.query(
      "INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Organization work')",
      [organizationWorkId, userId, organizationId],
    );
    const subscriptionId = `sub-${randomUUID()}`;
    await pool.query(
      "INSERT INTO subscriptions(user_id,stripe_subscription_id,plan_code,status) VALUES($1,$2,'standard','canceled')",
      [userId, subscriptionId],
    );
    const pushTokenId = randomUUID();
    await pool.query(
      `INSERT INTO mobile_push_tokens(
        id,user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id
      ) VALUES($1,$2,$3,'android','ja',$4,$5,'test-v1')`,
      [
        pushTokenId,
        userId,
        randomUUID(),
        pushTokenId.replaceAll('-', '').repeat(2),
        `v1.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`,
      ],
    );

    const anonymizeGate = deferred<void>();
    const requestLocked = deferred<void>();
    const anonymizeDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('FROM account_deletion_requests') && sql.includes('FOR UPDATE')) {
        requestLocked.resolve();
        await anonymizeGate.promise;
      }
    });
    const writerDatabase = await PinnedDatabase.connect(pool);
    try {
      const accountRepository = new PostgresLegacyAccountDeletionRepository(anonymizeDatabase, anonymizeDatabase);
      const anonymizePromise = settle(accountRepository.anonymizePersonalData(userId, processingToken));
      await waitForSignal(requestLocked.promise, 'anonymization request lock');
      const writerRepository = new PostgresGenerationJobRepository(writerDatabase, 'legacy_2debe_v1');
      const writerPromise = settle(writerRepository.create(entityJobInput(userId)));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      anonymizeGate.resolve();

      const anonymized = await anonymizePromise;
      const writer = await writerPromise;
      expect(anonymized).toEqual({ ok: true, value: true });
      expect(writer.ok).toBe(false);
      if (writer.ok) throw new Error('Expected writer to be rejected after anonymization');
      expect(writer.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(await countJobs(pool, userId)).toBe(0);
      expect((await pool.query('SELECT 1 FROM works WHERE id=$1', [personalWorkId])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM works WHERE id=$1', [organizationWorkId])).rowCount).toBe(1);
      expect((await pool.query('SELECT 1 FROM subscriptions WHERE stripe_subscription_id=$1', [subscriptionId])).rowCount).toBe(1);
      expect((await pool.query('SELECT 1 FROM mobile_push_tokens WHERE id=$1', [pushTokenId])).rowCount).toBe(1);
    } finally {
      anonymizeGate.resolve();
      await anonymizeDatabase.close();
      await writerDatabase.close();
    }
  });
});

class PinnedDatabase implements DatabaseClient, TransactionRunner {
  private constructor(
    private readonly client: PoolClient,
    public readonly pid: number,
    private readonly onQuery?: (sql: string) => Promise<void>,
  ) {}

  public static async connect(pool: Pool, onQuery?: (sql: string) => Promise<void>): Promise<PinnedDatabase> {
    const client = await pool.connect();
    const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
    if (pid === undefined) throw new Error('Missing backend pid');
    return new PinnedDatabase(client, pid, onQuery);
  }

  public async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    return this.client.query<Row>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    const transactionClient: DatabaseClient = {
      query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        const result = await this.client.query<Row>(text, values === undefined ? undefined : [...values]);
        await this.onQuery?.(text);
        return result;
      },
    };
    try {
      const value = await work(transactionClient);
      await this.client.query('COMMIT');
      return value;
    } catch (error: unknown) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.client.release();
  }
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
      pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
            client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return value;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function insertUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [
    userId,
    `identity-${userId}`,
    `${userId}@example.invalid`,
  ]);
  return userId;
}

async function insertDeletionRequest(
  pool: Pool,
  userId: string,
  status: 'blocked' | 'processing' | 'pending_external_action' | 'completed',
): Promise<void> {
  await pool.query(
    `INSERT INTO account_deletion_requests(user_id,identity_id,status,completed_at)
     VALUES($1,$2,$3,CASE WHEN $3='completed' THEN NOW() ELSE NULL END)`,
    [userId, `identity-${userId}`, status],
  );
}

async function insertStoryFixture(pool: Pool): Promise<{
  userId: string; pageId: string; episodeId: string;
}> {
  const userId = await insertUser(pool);
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Fence work')", [workId, userId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status) VALUES($1,$2,1,'editing')", [pageId, episodeId]);
  return { userId, pageId, episodeId };
}

function jobInputForType(
  jobType: typeof PERSONAL_JOB_TYPES[number],
  fixture: { userId: string; pageId: string; episodeId: string },
) {
  if (jobType === 'page_generate') {
    return { ...entityJobInput(fixture.userId), jobType, generationMode: 'standard' as const, params: { page_id: fixture.pageId } };
  }
  if (jobType === 'entity_generate') return entityJobInput(fixture.userId);
  return { ...entityJobInput(fixture.userId), jobType, params: { episode_id: fixture.episodeId } };
}

function entityJobInput(userId: string) {
  return {
    id: randomUUID(),
    userId,
    jobType: 'entity_generate' as const,
    generationMode: null,
    creditCost: 0,
    params: { entity_id: randomUUID() },
  };
}

async function insertFailedJob(pool: Pool, userId: string): Promise<string> {
  const jobId = randomUUID();
  await pool.query(
    `INSERT INTO generation_jobs(id,user_id,job_type,status,generation_mode,credit_cost,params,error_message)
     VALUES($1,$2,'entity_generate','failed',NULL,0,$3::jsonb,'synthetic')`,
    [jobId, userId, JSON.stringify({ entity_id: randomUUID() })],
  );
  return jobId;
}

function claimInput(userId: string) {
  return {
    userId,
    identityId: `identity-${userId}`,
    processingToken: randomUUID(),
    acknowledgePersonalSubscriptions: true,
    acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: true,
  };
}

async function countJobs(pool: Pool, userId: string): Promise<number> {
  return (await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM generation_jobs WHERE user_id=$1', [userId])).rows[0]?.count ?? 0;
}

async function jobStatus(pool: Pool, jobId: string): Promise<string | undefined> {
  return (await pool.query<{ status: string }>('SELECT status FROM generation_jobs WHERE id=$1', [jobId])).rows[0]?.status;
}

async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>(
      'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
      [pid],
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not become blocked`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => { resolve = innerResolve; });
  return { promise, resolve };
}

async function waitForSignal(signal: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}
