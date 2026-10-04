import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

// Design contract: explicit legacy personal Page settings writes acquire
// users -> account_deletion_requests before the existing scoped UPDATE, and
// the UPDATE plus result read remain on the same transaction client. Canonical
// and organization writes retain their existing query and transaction shape.
describePostgres('legacy normal Page write admission fence', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `legacy_page_write_fence_${process.pid}_${Date.now()}`;

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
    '退会状態%sはPage mutation前に403拒否する',
    async (status) => {
      const fixture = await insertFixture(pool);
      await insertDeletionRequest(pool, fixture.userId, status);
      const database = new TrackingDatabase(pool);

      const outcome = await settle(new PostgresPageRepository(
        database,
        'legacy_2debe_v1',
      ).updatePageSettings(fixture.pageId, fixture.userId, { dialogueMode: 'mixed' }));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected Page update to be rejected');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(database.transactionQueries.some((sql) => sql.includes('UPDATE pages'))).toBe(false);
      expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
    },
  );

  it('request無しとblockedはPage更新を許可する', async () => {
    const fixture = await insertFixture(pool);
    const repository = new PostgresPageRepository(testDatabase(pool), 'legacy_2debe_v1');

    expect((await repository.updatePageSettings(
      fixture.pageId,
      fixture.userId,
      { dialogueMode: 'mixed' },
    ))?.dialogueMode).toBe('mixed');
    await insertDeletionRequest(pool, fixture.userId, 'blocked');
    expect((await repository.updatePageSettings(
      fixture.pageId,
      fixture.userId,
      { dialogueMode: 'balloon_only' },
    ))?.dialogueMode).toBe('balloon_only');
  });

  it('存在しないuserはPage mutation前に403拒否する', async () => {
    const fixture = await insertFixture(pool);
    const outcome = await settle(new PostgresPageRepository(
      testDatabase(pool),
      'legacy_2debe_v1',
    ).updatePageSettings(fixture.pageId, randomUUID(), { dialogueMode: 'mixed' }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected missing user to be rejected');
    expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
  });

  it('正当organizationを許可しfake org・foreign personal・suspended memberを更新0にする', async () => {
    const organization = await insertOrganizationFixture(pool, 'active');
    const repository = new PostgresPageRepository(testDatabase(pool), 'legacy_2debe_v1');
    expect((await repository.updatePageSettings(
      organization.pageId,
      organization.userId,
      { dialogueMode: 'mixed' },
      organization.organizationId,
    ))?.dialogueMode).toBe('mixed');

    const personal = await insertFixture(pool);
    expect(await repository.updatePageSettings(
      personal.pageId,
      personal.userId,
      { dialogueMode: 'mixed' },
      randomUUID(),
    )).toBeNull();
    const foreignUserId = await insertUser(pool);
    expect(await repository.updatePageSettings(
      personal.pageId,
      foreignUserId,
      { dialogueMode: 'mixed' },
    )).toBeNull();

    const suspended = await insertOrganizationFixture(pool, 'suspended');
    expect(await repository.updatePageSettings(
      suspended.pageId,
      suspended.userId,
      { dialogueMode: 'mixed' },
      suspended.organizationId,
    )).toBeNull();
    expect(await readDialogueMode(pool, personal.pageId)).toBe('image_baked');
    expect(await readDialogueMode(pool, suspended.pageId)).toBe('image_baked');
  });

  it('更新後read失敗はPage UPDATEをrollbackする', async () => {
    const fixture = await insertFixture(pool);
    const database = new TrackingDatabase(pool, true);
    const outcome = await settle(new PostgresPageRepository(
      database,
      'legacy_2debe_v1',
    ).updatePageSettings(fixture.pageId, fixture.userId, { dialogueMode: 'mixed' }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected injected read failure');
    expect(outcome.error).toMatchObject({ message: 'Injected Page read failure' });
    expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
  });

  it('max1 poolはlegacyで同一client 1TX、canonicalで退会queryと追加TX 0を保つ', async () => {
    const legacyFixture = await insertFixture(pool);
    const canonicalFixture = await insertFixture(pool);
    const singlePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 1,
      connectionTimeoutMillis: 500,
    });
    try {
      const legacyDatabase = new TrackingDatabase(singlePool);
      const legacy = await new PostgresPageRepository(
        legacyDatabase,
        'legacy_2debe_v1',
      ).updatePageSettings(legacyFixture.pageId, legacyFixture.userId, { dialogueMode: 'mixed' });
      expect(legacy?.dialogueMode).toBe('mixed');
      expect(legacyDatabase.transactionCount).toBe(1);
      expect(legacyDatabase.baseQueriesDuringTransaction).toBe(0);

      const canonicalDatabase = new TrackingDatabase(singlePool);
      const canonical = await new PostgresPageRepository(canonicalDatabase).updatePageSettings(
        canonicalFixture.pageId,
        canonicalFixture.userId,
        { dialogueMode: 'mixed' },
      );
      expect(canonical?.dialogueMode).toBe('mixed');
      expect(canonicalDatabase.transactionCount).toBe(0);
      expect(canonicalDatabase.allQueries).toHaveLength(2);
      expect(canonicalDatabase.allQueries.join('\n')).not.toContain('account_deletion_requests');
    } finally {
      await singlePool.end();
    }
  });

  it('claim先行時はPage writerがuser lockを待ちcommit後403になる', async () => {
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
      const writer = settle(new PostgresPageRepository(
        writerDatabase,
        'legacy_2debe_v1',
      ).updatePageSettings(fixture.pageId, fixture.userId, { dialogueMode: 'mixed' }));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      claimGate.resolve();
      expect((await claim).kind).toBe('claimed');
      const outcome = await writer;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected writer rejection after claim');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
    } finally {
      claimGate.resolve();
      await claimDatabase.close();
      await writerDatabase.close();
    }
  });

  it('Page writer先行時はclaimがuser lockを待ちcommit後freshにclaimする', async () => {
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
      const writer = new PostgresPageRepository(
        writerDatabase,
        'legacy_2debe_v1',
      ).updatePageSettings(fixture.pageId, fixture.userId, { dialogueMode: 'mixed' });
      await waitForSignal(requestLocked.promise, 'writer request lock');
      const claim = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase)
        .claimRequest(claimInput(fixture.userId));
      await waitForBlockedQuery(pool, claimDatabase.pid);
      writerGate.resolve();
      expect((await writer)?.dialogueMode).toBe('mixed');
      expect((await claim).kind).toBe('claimed');
      expect(await readDialogueMode(pool, fixture.pageId)).toBe('mixed');
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
  pageId: string;
}

class TrackingDatabase implements DatabaseClient, TransactionRunner {
  public baseQueriesDuringTransaction = 0;
  public transactionCount = 0;
  public readonly transactionQueries: string[] = [];
  public readonly allQueries: string[] = [];
  private inTransaction = false;

  public constructor(
    private readonly pool: Pool,
    private readonly failPageRead = false,
  ) {}

  public async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.allQueries.push(text);
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
          this.allQueries.push(text);
          if (this.failPageRead && text.includes('SELECT pages.id') && text.includes('WHERE pages.id = $1')) {
            throw new Error('Injected Page read failure');
          }
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
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Page fence')", [workId, userId, organizationId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order",estimated_pages) VALUES($1,$2,1,1)', [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status) VALUES($1,$2,1,'editing')", [pageId, episodeId]);
  return { userId, organizationId, pageId };
}

async function insertOrganizationFixture(
  pool: Pool,
  status: 'active' | 'suspended',
): Promise<Fixture & { organizationId: string }> {
  const userId = await insertUser(pool);
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Page fence org',$2)", [organizationId, userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor',$3)", [organizationId, userId, status]);
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

async function readDialogueMode(pool: Pool, pageId: string): Promise<string | null> {
  return (await pool.query<{ dialogue_mode: string }>(
    'SELECT dialogue_mode FROM pages WHERE id=$1',
    [pageId],
  )).rows[0]?.dialogue_mode ?? null;
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
