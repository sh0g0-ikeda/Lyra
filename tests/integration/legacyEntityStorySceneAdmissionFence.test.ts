import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresEntityRepository } from '../../src/repositories/EntityRepository.js';
import { PostgresSceneRepository } from '../../src/repositories/SceneRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

// Design contract: the default canonical constructor never reads the legacy deletion table;
// only an explicit legacy_2debe_v1 repository profile enables these transactional fences.
describePostgres('legacy entity/story/scene account-deletion admission fence', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `legacy_graph_fence_${process.pid}_${Date.now()}`;

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
    '旧personal通常writerは退会状態%sで403となり保存dataを変えない',
    async (status) => {
      const entityFixture = await insertGraphFixture(pool);
      const storyFixture = await insertGraphFixture(pool);
      const sceneFixture = await insertGraphFixture(pool);
      await Promise.all([
        insertDeletionRequest(pool, entityFixture.userId, status),
        insertDeletionRequest(pool, storyFixture.userId, status),
        insertDeletionRequest(pool, sceneFixture.userId, status),
      ]);
      const entities = new PostgresEntityRepository(database, 'legacy_2debe_v1');
      const stories = new PostgresStoryRepository(database, database, 'legacy_2debe_v1');
      const scenes = new PostgresSceneRepository(database, 'legacy_2debe_v1');

      const outcomes = await Promise.all([
        settle(entities.delete(entityFixture.entityId, entityFixture.userId)),
        settle(stories.updateWork(
          storyFixture.workId,
          storyFixture.userId,
          { title: 'blocked', expectedUpdatedAt: storyFixture.workUpdatedAt.toISOString() },
        )),
        settle(scenes.updateScene(sceneFixture.sceneId, sceneFixture.userId, { location: 'blocked' })),
      ]);
      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('Expected legacy personal write to be rejected');
        expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      }
      expect(await graphCounts(pool, entityFixture)).toEqual({ works: 1, entities: 1, scenes: 1 });
      expect(await graphCounts(pool, storyFixture)).toEqual({ works: 1, entities: 1, scenes: 1 });
      expect((await pool.query<{ location: string | null }>('SELECT location FROM scenes WHERE id=$1', [sceneFixture.sceneId])).rows[0]?.location).toBeNull();
    },
  );

  it('旧personal通常writerはrequest無しとblockedを許可する', async () => {
    const absent = await insertGraphFixture(pool);
    const blocked = await insertGraphFixture(pool);
    await insertDeletionRequest(pool, blocked.userId, 'blocked');
    const entities = new PostgresEntityRepository(database, 'legacy_2debe_v1');
    const stories = new PostgresStoryRepository(database, database, 'legacy_2debe_v1');
    expect(await entities.delete(absent.entityId, absent.userId)).toBe(true);
    expect((await stories.updateWork(
      blocked.workId,
      blocked.userId,
      { title: 'blocked allowed', expectedUpdatedAt: blocked.workUpdatedAt.toISOString() },
    ))?.title).toBe('blocked allowed');
  });

  it('旧EntityStateはold38列だけで作成と更新を保存し新列をnullへ投影する', async () => {
    const fixture = await insertGraphFixture(pool);
    const scenes = new PostgresSceneRepository(database, 'legacy_2debe_v1');

    const created = await scenes.createEntityState(fixture.entityId, {
      sceneId: fixture.sceneId,
      costumeNote: '旧衣装',
      costumeRefId: null,
      conditionNote: '元気',
      hairNote: null,
      expressionDefault: 'smile',
      extraNote: null,
    }, fixture.userId);
    const updated = await scenes.updateEntityState(
      fixture.entityId,
      created.id,
      fixture.userId,
      { costumeNote: '更新衣装' },
    );
    const listed = await scenes.findEntityStatesByEntityIdAndUserId(fixture.entityId, fixture.userId);

    expect(updated?.costumeNote).toBe('更新衣装');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      name: null,
      description: null,
      referenceImage: null,
      baseReferenceId: null,
      costumeNote: '更新衣装',
    });
    expect(listed[0]?.updatedAt).toEqual(listed[0]?.createdAt);
  });

  it('旧personal create入口はactorを同一TXへ伝播し退会開始後に子graphを作らない', async () => {
    const fixture = await insertGraphFixture(pool);
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    const entities = new PostgresEntityRepository(database, 'legacy_2debe_v1');
    const stories = new PostgresStoryRepository(database, database, 'legacy_2debe_v1');
    const scenes = new PostgresSceneRepository(database, 'legacy_2debe_v1');
    const outcomes = await Promise.all([
      settle(entities.create({
        workId: fixture.workId,
        userId: fixture.userId,
        entityType: 'character',
        name: 'blocked create',
        freeDescription: null,
        promptSupplement: null,
        structuredFields: {},
        speechProfile: {},
      })),
      settle(stories.createChapter(fixture.workId, {
        order: 2,
        title: 'blocked chapter',
        purpose: null,
        startingState: null,
        endingState: null,
        emotionCurve: null,
        entitiesInvolved: [],
        keyBeats: [],
      }, fixture.userId)),
      settle(scenes.createScene(fixture.episodeId, {
        order: 2,
        location: null,
        time: null,
        atmosphere: null,
        involvedEntityIds: [],
      }, fixture.userId)),
      settle(scenes.createEntityState(fixture.entityId, {
        sceneId: fixture.sceneId,
        costumeNote: null,
        costumeRefId: null,
        conditionNote: null,
        hairNote: null,
        expressionDefault: 'neutral',
        extraNote: null,
      }, fixture.userId)),
    ]);
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected legacy create to be rejected');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    }
    const counts = await pool.query<{ entities: number; chapters: number; scenes: number; states: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM entities WHERE work_id=$1) AS entities,
         (SELECT COUNT(*)::int FROM chapters WHERE work_id=$1) AS chapters,
         (SELECT COUNT(*)::int FROM scenes WHERE episode_id=$2) AS scenes,
         (SELECT COUNT(*)::int FROM entity_states WHERE entity_id=$3) AS states`,
      [fixture.workId, fixture.episodeId, fixture.entityId],
    );
    expect(counts.rows[0]).toEqual({ entities: 1, chapters: 1, scenes: 1, states: 0 });
  });

  it('旧organization通常writerはactorのpersonal退会に影響されずfake organization scopeでは更新しない', async () => {
    const fixture = await insertOrganizationGraphFixture(pool);
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    const entities = new PostgresEntityRepository(database, 'legacy_2debe_v1');
    const stories = new PostgresStoryRepository(database, database, 'legacy_2debe_v1');
    const scenes = new PostgresSceneRepository(database, 'legacy_2debe_v1');
    const entity = await entities.update(
      fixture.entityId,
      fixture.userId,
      { name: 'Organization character', expectedUpdatedAt: fixture.entityUpdatedAt.toISOString() },
      fixture.organizationId,
    );
    expect(entity?.name).toBe('Organization character');
    expect((await scenes.updateScene(fixture.sceneId, fixture.userId, { location: 'Organization scene' }, fixture.organizationId))?.location).toBe('Organization scene');
    const fakeOrganizationId = randomUUID();
    expect(await stories.updateWork(
      fixture.workId,
      fixture.userId,
      { title: 'fake scope', expectedUpdatedAt: fixture.workUpdatedAt.toISOString() },
      fakeOrganizationId,
    )).toBeNull();
    const fakeCreate = await settle(stories.createWork(fixture.userId, {
      ...workInput(),
      organizationId: fakeOrganizationId,
    }));
    expect(fakeCreate.ok).toBe(false);
    if (fakeCreate.ok) throw new Error('Expected fake organization create to be rejected');
    expect(fakeCreate.error).toMatchObject({ code: 'NOT_FOUND' });
    expect((await pool.query('SELECT 1 FROM works WHERE id=$1', [fixture.workId])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM works WHERE organization_id=$1', [fakeOrganizationId])).rowCount).toBe(0);
  });

  it('legacy updateEpisodeはmax1 poolでもTX clientだけを使いself-blockせず更新する', async () => {
    const fixture = await insertGraphFixture(pool);
    const singleConnectionPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 1,
      connectionTimeoutMillis: 500,
    });
    try {
      const singleDatabase = testDatabase(singleConnectionPool);
      const repository = new PostgresStoryRepository(
        singleDatabase,
        singleDatabase,
        'legacy_2debe_v1',
      );

      const outcome = await settle(repository.updateEpisode(
        fixture.episodeId,
        fixture.userId,
        { title: 'single connection updated' },
      ));

      if (!outcome.ok) throw outcome.error;
      expect(outcome.ok).toBe(true);
      expect(outcome.value?.title).toBe('single connection updated');
    } finally {
      await singleConnectionPool.end();
    }
  });

  it('退会claim先行時はStory writerがuser lockを待ちcommit後403でworkを残さない', async () => {
    const userId = await insertUser(pool);
    await insertDeletionRequest(pool, userId, 'blocked');
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
        .claimRequest(claimInput(userId));
      await waitForSignal(requestLocked.promise, 'claim request lock');
      const writer = settle(new PostgresStoryRepository(writerDatabase, writerDatabase, 'legacy_2debe_v1')
        .createWork(userId, workInput()));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      claimGate.resolve();
      expect((await claim).kind).toBe('claimed');
      const outcome = await writer;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected writer to be rejected after claim');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect((await pool.query('SELECT 1 FROM works WHERE user_id=$1', [userId])).rowCount).toBe(0);
    } finally {
      claimGate.resolve();
      await claimDatabase.close();
      await writerDatabase.close();
    }
  });

  it('Story writer先行時はclaimがuser lockを待ちcommit後fresh inventoryでclaimする', async () => {
    const userId = await insertUser(pool);
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
      const writer = new PostgresStoryRepository(writerDatabase, writerDatabase, 'legacy_2debe_v1')
        .createWork(userId, workInput());
      await waitForSignal(requestLocked.promise, 'writer request lock');
      const claim = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase)
        .claimRequest(claimInput(userId));
      await waitForBlockedQuery(pool, claimDatabase.pid);
      writerGate.resolve();
      expect((await writer).userId).toBe(userId);
      const result = await claim;
      expect(result.kind).toBe('claimed');
      expect((await pool.query<{ status: string }>('SELECT status FROM account_deletion_requests WHERE user_id=$1', [userId])).rows[0]?.status).toBe('processing');
      expect((await pool.query('SELECT 1 FROM works WHERE user_id=$1', [userId])).rowCount).toBe(1);
    } finally {
      writerGate.resolve();
      await writerDatabase.close();
      await claimDatabase.close();
    }
  });
});

interface GraphFixture {
  userId: string;
  organizationId: string | null;
  workId: string;
  chapterId: string;
  episodeId: string;
  entityId: string;
  sceneId: string;
  workUpdatedAt: Date;
  entityUpdatedAt: Date;
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

async function insertGraphFixture(pool: Pool, existingUserId?: string, organizationId: string | null = null): Promise<GraphFixture> {
  const userId = existingUserId ?? await insertUser(pool);
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const entityId = randomUUID();
  const sceneId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Fence work')", [workId, userId, organizationId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
  await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name) VALUES($1,$2,$3,'character','Character')", [entityId, workId, userId]);
  await pool.query('INSERT INTO reference_sets(entity_id,status) VALUES($1,\'empty\')', [entityId]);
  await pool.query('INSERT INTO scenes(id,episode_id,"order") VALUES($1,$2,1)', [sceneId, episodeId]);
  const timestamps = await pool.query<{ work_updated_at: Date; entity_updated_at: Date }>(
    `SELECT works.updated_at AS work_updated_at, entities.updated_at AS entity_updated_at
     FROM works, entities WHERE works.id=$1 AND entities.id=$2`,
    [workId, entityId],
  );
  const workUpdatedAt = timestamps.rows[0]?.work_updated_at;
  const entityUpdatedAt = timestamps.rows[0]?.entity_updated_at;
  if (workUpdatedAt === undefined || entityUpdatedAt === undefined) throw new Error('Missing graph timestamps');
  return {
    userId,
    organizationId,
    workId,
    chapterId,
    episodeId,
    entityId,
    sceneId,
    workUpdatedAt,
    entityUpdatedAt,
  };
}

async function insertOrganizationGraphFixture(pool: Pool): Promise<GraphFixture & { organizationId: string }> {
  const userId = await insertUser(pool);
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Fence org',$2)", [organizationId, userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')", [organizationId, userId]);
  return { ...await insertGraphFixture(pool, userId, organizationId), organizationId };
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

function workInput() {
  return {
    title: 'Fence work', genre: null, worldSetting: null, theme: null,
    mainEntityIds: [], startingPoint: null, endingPoint: null, overallFlow: null,
  };
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

async function graphCounts(pool: Pool, fixture: GraphFixture): Promise<{ works: number; entities: number; scenes: number }> {
  const result = await pool.query<{ works: number; entities: number; scenes: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM works WHERE id=$1) AS works,
       (SELECT COUNT(*)::int FROM entities WHERE id=$2) AS entities,
       (SELECT COUNT(*)::int FROM scenes WHERE id=$3) AS scenes`,
    [fixture.workId, fixture.entityId, fixture.sceneId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Missing graph counts');
  return row;
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
