import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresPageLayoutRepository } from '../../src/repositories/PageLayoutRepository.js';
import { PostgresPanelEntityAssignmentRepository } from '../../src/repositories/PanelEntityAssignmentRepository.js';
import { PostgresPanelFrameRepository } from '../../src/repositories/PanelFrameRepository.js';
import { PostgresPanelRepository } from '../../src/repositories/PanelRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

// Design contract: only explicit legacy_2debe_v1 writers add users -> deletion request
// admission inside their existing transaction, before page/panel/frame graph mutation.
// Canonical constructors keep their existing query and transaction shape.
describePostgres('legacy panel graph account-deletion admission fence', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `legacy_panel_fence_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 20,
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
    '退会状態%sではPanel/Frame/Layout/Assignmentの通常保存を403にしてmutationを0件にする',
    async (status) => {
      const panelFixture = await insertPanelFixture(pool);
      const frameFixture = await insertPanelFixture(pool);
      const layoutFixture = await insertPanelFixture(pool);
      const assignmentFixture = await insertPanelFixture(pool);
      await Promise.all([
        insertDeletionRequest(pool, panelFixture.userId, status),
        insertDeletionRequest(pool, frameFixture.userId, status),
        insertDeletionRequest(pool, layoutFixture.userId, status),
        insertDeletionRequest(pool, assignmentFixture.userId, status),
      ]);
      const panels = new PostgresPanelRepository(database, 'legacy_2debe_v1');
      const frames = new PostgresPanelFrameRepository(database, 'legacy_2debe_v1');
      const layouts = new PostgresPageLayoutRepository(database, 'legacy_2debe_v1');
      const assignments = new PostgresPanelEntityAssignmentRepository(database, 'legacy_2debe_v1');

      const outcomes = await Promise.all([
        settle(panels.updatePanel(panelFixture.panelId, panelFixture.userId, { situationText: 'blocked' })),
        settle(frames.replaceFramesByPageIdAndUserId(
          frameFixture.pageId,
          frameFixture.userId,
          [frameInput(frameFixture.panelId, 'dashed')],
        )),
        settle(layouts.applyTemplateAndSyncPanels(layoutFixture.userId, layoutFixture.pageId, {
          templateId: 'splash_1',
          targetPanelCount: 1,
          frameDefinitions: [frameInput(null, 'none')],
          allowPanelTruncation: true,
        })),
        settle(assignments.updatePanelEntityAssignments(
          assignmentFixture.panelId,
          assignmentFixture.userId,
          [],
        )),
      ]);

      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('Expected legacy panel graph write to be rejected');
        expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      }
      expect(await panelSnapshot(pool, panelFixture)).toEqual(panelFixture.initialSnapshot);
      expect(await panelSnapshot(pool, frameFixture)).toEqual(frameFixture.initialSnapshot);
      expect(await panelSnapshot(pool, layoutFixture)).toEqual(layoutFixture.initialSnapshot);
      expect(await panelSnapshot(pool, assignmentFixture)).toEqual(assignmentFixture.initialSnapshot);
    },
  );

  it('request無しとblockedではPanel/Frameの通常保存を許可する', async () => {
    const absent = await insertPanelFixture(pool);
    const blocked = await insertPanelFixture(pool);
    await insertDeletionRequest(pool, blocked.userId, 'blocked');
    const panels = new PostgresPanelRepository(database, 'legacy_2debe_v1');
    const frames = new PostgresPanelFrameRepository(database, 'legacy_2debe_v1');

    expect((await panels.updatePanel(absent.panelId, absent.userId, { situationText: 'allowed' }))?.situationText)
      .toBe('allowed');
    expect(await frames.replaceFramesByPageIdAndUserId(
      blocked.pageId,
      blocked.userId,
      [frameInput(blocked.panelId, 'dashed')],
    )).toHaveLength(1);
  });

  it('正当なorganization保存を許可しfake scopeとinactive memberとforeign resourceを拒否する', async () => {
    const valid = await insertOrganizationPanelFixture(pool, 'active');
    const inactive = await insertOrganizationPanelFixture(pool, 'suspended');
    await Promise.all([
      insertDeletionRequest(pool, valid.userId, 'processing'),
      insertDeletionRequest(pool, inactive.userId, 'processing'),
    ]);
    const panels = new PostgresPanelRepository(database, 'legacy_2debe_v1');
    const assignments = new PostgresPanelEntityAssignmentRepository(database, 'legacy_2debe_v1');

    expect((await panels.updatePanel(
      valid.panelId,
      valid.userId,
      { situationText: 'organization allowed' },
      valid.organizationId,
    ))?.situationText).toBe('organization allowed');
    expect(await assignments.updatePanelEntityAssignments(
      valid.panelId,
      valid.userId,
      [],
      randomUUID(),
    )).toBeNull();
    expect(await panels.updatePanel(
      inactive.panelId,
      inactive.userId,
      { situationText: 'inactive blocked' },
      inactive.organizationId,
    )).toBeNull();
    expect(await panels.updatePanel(
      valid.panelId,
      inactive.userId,
      { situationText: 'foreign blocked' },
      valid.organizationId,
    )).toBeNull();
  });

  it('Frame後続保存失敗ではdeleteと途中insertを同じTXでrollbackする', async () => {
    const fixture = await insertPanelFixture(pool);
    const frames = new PostgresPanelFrameRepository(database, 'legacy_2debe_v1');
    const before = await panelSnapshot(pool, fixture);

    const outcome = await settle(frames.replaceFramesByPageIdAndUserId(
      fixture.pageId,
      fixture.userId,
      [frameInput(fixture.panelId, 'dashed'), frameInput(randomUUID(), 'none', 2)],
    ));

    expect(outcome.ok).toBe(false);
    expect(await panelSnapshot(pool, fixture)).toEqual(before);
  });

  it('Layoutはmax1 poolでも同じTX clientだけで保存する', async () => {
    const fixture = await insertPanelFixture(pool);
    const singlePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 1,
      connectionTimeoutMillis: 500,
    });
    try {
      const singleDatabase = testDatabase(singlePool);
      const layout = new PostgresPageLayoutRepository(singleDatabase, 'legacy_2debe_v1');
      const result = await layout.applyTemplateAndSyncPanels(fixture.userId, fixture.pageId, {
        templateId: 'splash_1',
        targetPanelCount: 1,
        frameDefinitions: [frameInput(null, 'solid')],
        allowPanelTruncation: true,
      });
      expect(result.panelCount).toBe(1);
      expect(result.frames).toHaveLength(1);
    } finally {
      await singlePool.end();
    }
  });

  it('claim先行時はPanel writerがuser lockを待ちcommit後403で追加しない', async () => {
    const fixture = await insertPanelFixture(pool);
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
      const writer = settle(new PostgresPanelRepository(writerDatabase, 'legacy_2debe_v1').createPanel(
        fixture.pageId,
        fixture.userId,
        panelInput(2),
      ));
      await waitForBlockedQuery(pool, writerDatabase.pid);
      claimGate.resolve();
      expect((await claim).kind).toBe('claimed');
      const outcome = await writer;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('Expected panel writer to be rejected after claim');
      expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect((await pool.query('SELECT 1 FROM panels WHERE page_id=$1', [fixture.pageId])).rowCount).toBe(1);
    } finally {
      claimGate.resolve();
      await claimDatabase.close();
      await writerDatabase.close();
    }
  });

  it('Panel writer先行時はclaimがuser lockを待ちcommit後fresh inventoryでclaimする', async () => {
    const fixture = await insertPanelFixture(pool);
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
      const writer = new PostgresPanelRepository(writerDatabase, 'legacy_2debe_v1').createPanel(
        fixture.pageId,
        fixture.userId,
        panelInput(2),
      );
      await waitForSignal(requestLocked.promise, 'writer request lock');
      const claim = new PostgresLegacyAccountDeletionRepository(claimDatabase, claimDatabase)
        .claimRequest(claimInput(fixture.userId));
      await waitForBlockedQuery(pool, claimDatabase.pid);
      writerGate.resolve();
      expect((await writer)?.order).toBe(2);
      expect((await claim).kind).toBe('claimed');
      expect((await pool.query('SELECT 1 FROM panels WHERE page_id=$1', [fixture.pageId])).rowCount).toBe(2);
    } finally {
      writerGate.resolve();
      await writerDatabase.close();
      await claimDatabase.close();
    }
  });
});

interface PanelFixture {
  userId: string;
  organizationId: string | null;
  workId: string;
  pageId: string;
  panelId: string;
  frameId: string;
  initialSnapshot: PanelSnapshot;
}

interface PanelSnapshot {
  situationText: string | null;
  entities: unknown;
  layoutConfig: unknown;
  frames: Array<{ id: string; panel_id: string | null; vertices: unknown; border_style: string; reading_order: number }>;
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

async function insertPanelFixture(
  pool: Pool,
  existingUserId?: string,
  organizationId: string | null = null,
): Promise<PanelFixture> {
  const userId = existingUserId ?? await insertUser(pool);
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  const panelId = randomUUID();
  const frameId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Panel fence work')", [workId, userId, organizationId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status,layout_config) VALUES($1,$2,1,'editing',$3::jsonb)", [pageId, episodeId, JSON.stringify({ type: 'template', template_id: 'splash_1', marker: 'initial' })]);
  await pool.query("INSERT INTO panels(id,page_id,\"order\",situation_text,entities) VALUES($1,$2,1,'initial',$3::jsonb)", [panelId, pageId, JSON.stringify([assignmentJson(randomUUID())])]);
  await pool.query('INSERT INTO panel_frames(id,page_id,panel_id,vertices,border_style,reading_order) VALUES($1,$2,$3,$4::jsonb,\'solid\',1)', [frameId, pageId, panelId, JSON.stringify(vertices())]);
  const fixture = { userId, organizationId, workId, pageId, panelId, frameId };
  return { ...fixture, initialSnapshot: await panelSnapshot(pool, fixture) };
}

async function insertOrganizationPanelFixture(
  pool: Pool,
  status: 'active' | 'suspended',
): Promise<PanelFixture & { organizationId: string }> {
  const userId = await insertUser(pool);
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Panel org',$2)", [organizationId, userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor',$3)", [organizationId, userId, status]);
  return { ...await insertPanelFixture(pool, userId, organizationId), organizationId };
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

async function panelSnapshot(pool: Pool, fixture: Pick<PanelFixture, 'pageId' | 'panelId'>): Promise<PanelSnapshot> {
  const panel = await pool.query<{ situation_text: string | null; entities: unknown }>('SELECT situation_text,entities FROM panels WHERE id=$1', [fixture.panelId]);
  const page = await pool.query<{ layout_config: unknown }>('SELECT layout_config FROM pages WHERE id=$1', [fixture.pageId]);
  const frames = await pool.query<PanelSnapshot['frames'][number]>('SELECT id,panel_id,vertices,border_style,reading_order FROM panel_frames WHERE page_id=$1 ORDER BY reading_order,id', [fixture.pageId]);
  return {
    situationText: panel.rows[0]?.situation_text ?? null,
    entities: panel.rows[0]?.entities ?? null,
    layoutConfig: page.rows[0]?.layout_config ?? null,
    frames: frames.rows,
  };
}

function panelInput(order: number) {
  return { order, situationText: 'created' };
}

function frameInput(panelId: string | null, borderStyle: 'solid' | 'dashed' | 'none', readingOrder = 1) {
  return {
    panelId,
    vertices: vertices(),
    borderStyle,
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: readingOrder,
    readingOrder,
  };
}

function vertices() {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

function assignmentJson(entityId: string) {
  return {
    entity_id: entityId,
    role: 'primary',
    expression: 'calm',
    custom_expression: null,
    action: 'standing_firm',
    custom_action: null,
    position: 'center',
    facing_direction: null,
    effect_note: null,
    state_id: null,
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
