import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../src/repositories/EpisodePlanPersistenceRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

// Design contract: the legacy outer transaction acquires users -> deletion request
// before any episode graph lock, then passes the same transaction client and profile
// to child Panel/Assignment repositories. Canonical transactions add no such query.
describePostgres('legacy episode plan account-deletion admission fence', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `legacy_episode_plan_fence_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 16,
    });
    const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(testDatabase(pool), {
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
    '退会状態%sはgraph queryとcallback mutation前に403拒否する',
    async (status) => {
      const fixture = await insertFixture(pool);
      await insertDeletionRequest(pool, fixture.userId, status);
      const database = new TrackingDatabase(pool);
      const repository = new PostgresEpisodePlanPersistenceRepository(database, 'legacy_2debe_v1');
      let callbackCalled = false;

      const outcome = await settle(repository.withLockedEpisodePlan(planInput(fixture), async (_context, resources) => {
        callbackCalled = true;
        return resources.panelRepository.updatePanel(
          fixture.panelId,
          fixture.userId,
          { situationText: 'blocked' },
        );
      }));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected episode plan persistence to be rejected');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(callbackCalled).toBe(false);
      expect(database.transactionQueries.some((sql) => sql.includes('FOR UPDATE OF works, chapters, episodes')))
        .toBe(false);
      expect(await readSituation(pool, fixture.panelId)).toBe('initial');
    },
  );

  it('request無しとblockedは同一TXの子Panel保存を許可する', async () => {
    const absent = await insertFixture(pool);
    const blocked = await insertFixture(pool);
    await insertDeletionRequest(pool, blocked.userId, 'blocked');

    for (const [fixture, text] of [[absent, 'absent allowed'], [blocked, 'blocked allowed']] as const) {
      const repository = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'legacy_2debe_v1');
      const updated = await repository.withLockedEpisodePlan(planInput(fixture), async (_context, resources) =>
        resources.panelRepository.updatePanel(fixture.panelId, fixture.userId, { situationText: text }));
      expect(updated?.situationText).toBe(text);
    }
  });

  it('正当organizationを許可しfake organizationとforeign personal scopeをcallback前に拒否する', async () => {
    const fixture = await insertOrganizationFixture(pool);
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    const repository = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'legacy_2debe_v1');

    const updated = await repository.withLockedEpisodePlan(planInput(fixture), async (_context, resources) =>
      resources.panelRepository.updatePanel(
        fixture.panelId,
        fixture.userId,
        { situationText: 'organization allowed' },
        fixture.organizationId,
      ));
    expect(updated?.situationText).toBe('organization allowed');

    let fakeCallback = false;
    const fake = await settle(repository.withLockedEpisodePlan({
      ...planInput(fixture),
      organizationId: randomUUID(),
    }, async () => { fakeCallback = true; }));
    expect(fake.ok).toBe(false);
    expect(fakeCallback).toBe(false);

    const foreignUserId = await insertUser(pool);
    let foreignCallback = false;
    const foreign = await settle(repository.withLockedEpisodePlan({
      ...planInput(fixture),
      userId: foreignUserId,
      organizationId: null,
    }, async () => { foreignCallback = true; }));
    expect(foreign.ok).toBe(false);
    expect(foreignCallback).toBe(false);
  });

  it('callback後続失敗は子Panel保存をouter transactionごとrollbackする', async () => {
    const fixture = await insertFixture(pool);
    const repository = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'legacy_2debe_v1');

    const outcome = await settle(repository.withLockedEpisodePlan(planInput(fixture), async (_context, resources) => {
      await resources.panelRepository.updatePanel(
        fixture.panelId,
        fixture.userId,
        { situationText: 'must rollback' },
      );
      throw new Error('Injected downstream failure');
    }));

    expect(outcome.ok).toBe(false);
    expect(await readSituation(pool, fixture.panelId)).toBe('initial');
  });

  it('max1 poolでもouter/childは同じclientの1 transactionだけを使う', async () => {
    const fixture = await insertFixture(pool);
    const singlePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 1,
      connectionTimeoutMillis: 500,
    });
    try {
      const database = new TrackingDatabase(singlePool);
      const repository = new PostgresEpisodePlanPersistenceRepository(database, 'legacy_2debe_v1');
      const updated = await repository.withLockedEpisodePlan(planInput(fixture), async (_context, resources) =>
        resources.panelRepository.updatePanel(
          fixture.panelId,
          fixture.userId,
          { situationText: 'single client' },
        ));
      expect(updated?.situationText).toBe('single client');
      expect(database.transactionCount).toBe(1);
      expect(database.baseQueriesDuringTransaction).toBe(0);
    } finally {
      await singlePool.end();
    }
  });

  it('claim先行時はepisode plan writerがuser lockを待ちcommit後403になる', async () => {
    const fixture = await insertFixture(pool);
    await insertDeletionRequest(pool, fixture.userId, 'blocked');
    const claimGate = deferred<void>();
    const requestLocked = deferred<void>();
    const claimDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('account_deletion_requests') && sql.includes('FOR UPDATE')) {
        requestLocked.resolve();
        await claimGate.promise;
      }
    });
    const writerDatabase = await PinnedDatabase.connect(pool);
    try {
      const claim = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase)
        .claimRequest(claimInput(fixture.userId));
      await waitForSignal(requestLocked.promise, 'claim request lock');
      const writer = settle(new PostgresEpisodePlanPersistenceRepository(
        writerDatabase,
        'legacy_2debe_v1',
      ).withLockedEpisodePlan(planInput(fixture), async (_context, resources) =>
        resources.panelRepository.updatePanel(
          fixture.panelId,
          fixture.userId,
          { situationText: 'blocked' },
        )));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      claimGate.resolve();
      expect((await claim).kind).toBe('claimed');
      const outcome = await writer;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected writer to be rejected after claim');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(await readSituation(pool, fixture.panelId)).toBe('initial');
    } finally {
      claimGate.resolve();
      await claimDatabase.close();
      await writerDatabase.close();
    }
  });

  it('episode plan writer先行時はclaimがuser lockを待ちcommit後freshにclaimする', async () => {
    const fixture = await insertFixture(pool);
    const writerGate = deferred<void>();
    const requestLocked = deferred<void>();
    const writerDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('account_deletion_requests') && sql.includes('FOR UPDATE')) {
        requestLocked.resolve();
        await writerGate.promise;
      }
    });
    const claimDatabase = await PinnedDatabase.connect(pool);
    try {
      const writer = new PostgresEpisodePlanPersistenceRepository(
        writerDatabase,
        'legacy_2debe_v1',
      ).withLockedEpisodePlan(planInput(fixture), async (_context, resources) =>
        resources.panelRepository.updatePanel(
          fixture.panelId,
          fixture.userId,
          { situationText: 'writer committed' },
        ));
      await waitForSignal(requestLocked.promise, 'writer request lock');
      const claim = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase)
        .claimRequest(claimInput(fixture.userId));
      await waitForBlockedQuery(pool, claimDatabase.pid);
      writerGate.resolve();
      expect((await writer)?.situationText).toBe('writer committed');
      expect((await claim).kind).toBe('claimed');
      expect(await readSituation(pool, fixture.panelId)).toBe('writer committed');
    } finally {
      writerGate.resolve();
      await writerDatabase.close();
      await claimDatabase.close();
    }
  });
});

interface Fixture {
  userId: string;
  organizationId: string | null;
  workId: string;
  episodeId: string;
  pageId: string;
  panelId: string;
}

class TrackingDatabase implements DatabaseClient, TransactionRunner {
  public baseQueriesDuringTransaction = 0;
  public transactionCount = 0;
  public transactionQueries: string[] = [];
  private inTransaction = false;

  public constructor(private readonly pool: Pool) {}

  public async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (this.inTransaction) this.baseQueriesDuringTransaction += 1;
    return this.pool.query<Row>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const client = await this.pool.connect();
    await client.query('BEGIN');
    this.inTransaction = true;
    try {
      const result = await work({
        query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
          this.transactionQueries.push(text);
          return client.query<Row>(text, values === undefined ? undefined : [...values]);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
      client.release();
    }
  }
}

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

async function insertFixture(
  pool: Pool,
  existingUserId?: string,
  organizationId: string | null = null,
): Promise<Fixture> {
  const userId = existingUserId ?? await insertUser(pool);
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  const panelId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Episode plan fence')", [workId, userId, organizationId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order",estimated_pages) VALUES($1,$2,1,1)', [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status) VALUES($1,$2,1,'editing')", [pageId, episodeId]);
  await pool.query("INSERT INTO panels(id,page_id,\"order\",situation_text) VALUES($1,$2,1,'initial')", [panelId, pageId]);
  await pool.query('INSERT INTO panel_frames(page_id,panel_id,vertices,reading_order) VALUES($1,$2,$3::jsonb,1)', [pageId, panelId, JSON.stringify(vertices())]);
  return { userId, organizationId, workId, episodeId, pageId, panelId };
}

async function insertOrganizationFixture(pool: Pool): Promise<Fixture & { organizationId: string }> {
  const userId = await insertUser(pool);
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Episode plan org',$2)", [organizationId, userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')", [organizationId, userId]);
  return { ...await insertFixture(pool, userId, organizationId), organizationId };
}

async function insertUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, `identity-${userId}`, `${userId}@example.invalid`]);
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

function planInput(fixture: Fixture) {
  return {
    episodeId: fixture.episodeId,
    userId: fixture.userId,
    organizationId: fixture.organizationId,
  };
}

async function readSituation(pool: Pool, panelId: string): Promise<string | null> {
  return (await pool.query<{ situation_text: string | null }>('SELECT situation_text FROM panels WHERE id=$1', [panelId])).rows[0]?.situation_text ?? null;
}

function vertices() {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

function claimInput(userId: string) {
  return {
    userId,
    identityId: `identity-${userId}`,
    processingToken: randomUUID(),
    acknowledgePersonalSubscriptions: true,
    acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: false,
  };
}

async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
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
