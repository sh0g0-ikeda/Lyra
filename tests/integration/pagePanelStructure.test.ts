import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PanelFrameBorderStyle } from '../../src/domain/types/panelFrame.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresBalloonRepository } from '../../src/repositories/BalloonRepository.js';
import { PostgresPagePanelStructureRepository } from '../../src/repositories/PagePanelStructureRepository.js';
import { lockStoryEpisodeAdmission } from '../../src/repositories/StoryEpisodeAdmissionLock.js';
import { PagePanelStructureService } from '../../src/services/page/PagePanelStructureService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('page panel structure safety', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `panel_structure_${process.pid}_${Date.now()}`;
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

  it('並び替えはFrame形状を保持しPanelリンクと吹き出し参照を同じPanelへ追従させる', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    try {
      await insertFixture(pool, ids);
      const beforeFrames = await readFrames(pool, ids.pageId);

      const result = await service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'reorder', panelIds: [ids.panelIds[2]!, ids.panelIds[0]!, ids.panelIds[1]!] },
      });

      expect(result.panelIds).toEqual([ids.panelIds[2], ids.panelIds[0], ids.panelIds[1]]);
      expect(result.layoutTemplateId).toBeNull();
      expect(result.balloonReferenceUpdatedCount).toBe(3);
      expect(result.balloonReferenceClearedCount).toBe(0);
      const afterFrames = await readFrames(pool, ids.pageId);
      expect(afterFrames.map((frame) => frame.vertices)).toEqual(beforeFrames.map((frame) => frame.vertices));
      expect(afterFrames.map((frame) => frame.panel_id)).toEqual([
        ids.panelIds[2],
        ids.panelIds[0],
        ids.panelIds[1],
      ]);
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([2, 3, 1]);
      await expect(readLayoutMetadata(pool, ids.pageId)).resolves.toMatchObject({
        story_page_purpose: 'keep me',
        panel_count: 3,
      });
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('削除は対象吹き出し参照だけ解除して既定Frameと後続順をatomicに保存する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    try {
      await insertFixture(pool, ids);

      const result = await service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'delete', panelId: ids.panelIds[1]! },
      });

      expect(result.panelIds).toEqual([ids.panelIds[0], ids.panelIds[2]]);
      expect(result.layoutTemplateId).toBe('climax_2');
      expect(result.balloonReferenceUpdatedCount).toBe(2);
      expect(result.balloonReferenceClearedCount).toBe(1);
      await expect(readPanelIds(pool, ids.pageId)).resolves.toEqual([ids.panelIds[0], ids.panelIds[2]]);
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([1, null, 2]);
      await expect(readLayoutMetadata(pool, ids.pageId)).resolves.toMatchObject({
        story_page_purpose: 'keep me',
        type: 'template',
        template_id: 'climax_2',
        panel_count: 2,
      });
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('古いPanel順またはactive生成ジョブの場合に構造を変更しない', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    try {
      await insertFixture(pool, ids);
      await expect(service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: [ids.panelIds[1]!, ids.panelIds[0]!, ids.panelIds[2]!],
        operation: { type: 'append' },
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(readPanelIds(pool, ids.pageId)).resolves.toEqual(ids.panelIds);

      await pool.query(
        `INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params)
         VALUES ($1::uuid, $2::uuid, 'page_generate', 'queued', 1, $3::jsonb)`,
        [randomUUID(), ids.userId, JSON.stringify({ page_id: ids.pageId })],
      );
      await expect(service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'append' },
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(readPanelIds(pool, ids.pageId)).resolves.toEqual(ids.panelIds);
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([1, 2, 3]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('Frame保存が失敗する場合にPanelと吹き出し更新をrollbackする', async () => {
    const ids = createFixtureIds();
    const repository = new PostgresPagePanelStructureRepository(new PoolTransactionDatabase(pool));
    try {
      await insertFixture(pool, ids);
      const invalidBorderStyle = 'invalid' as PanelFrameBorderStyle;

      await expect(repository.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'delete', panelId: ids.panelIds[1]! },
        replacementLayout: {
          templateId: 'climax_2',
          frameDefinitions: [1, 2].map((readingOrder) => ({
            panelId: null,
            vertices: rectangle(readingOrder),
            borderStyle: invalidBorderStyle,
            borderWidth: 3,
            borderColor: '#000000',
            zIndex: 1,
            readingOrder,
          })),
        },
      })).rejects.toBeDefined();

      await expect(readPanelIds(pool, ids.pageId)).resolves.toEqual(ids.panelIds);
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([1, 2, 3]);
      await expect(readFrames(pool, ids.pageId)).resolves.toHaveLength(3);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('生成admissionが先行する場合にcommit後のactive jobを再確認して更新しない', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    const blocker = await pool.connect();
    try {
      await insertFixture(pool, ids);
      await blocker.query('BEGIN');
      await lockStoryEpisodeAdmission(toDatabaseClient(blocker), ids.episodeId);

      const pendingApply = service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'append' },
      });
      await expectPromiseToRemainPending(pendingApply);
      await blocker.query(
        `INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params)
         VALUES ($1::uuid, $2::uuid, 'page_generate', 'queued', 1, $3::jsonb)`,
        [randomUUID(), ids.userId, JSON.stringify({ page_id: ids.pageId })],
      );
      await blocker.query('COMMIT');

      await expect(pendingApply).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(readPanelIds(pool, ids.pageId)).resolves.toEqual(ids.panelIds);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      await removeFixture(pool, ids);
    }
  });

  it('organization scopeはactive memberだけを許可してpersonal fallbackを拒否する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    try {
      await insertFixture(pool, ids);
      await moveFixtureWorkToOrganization(pool, ids);

      await expect(service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'reorder', panelIds: [ids.panelIds[1]!, ids.panelIds[0]!, ids.panelIds[2]!] },
      }, ids.organizationId)).resolves.toMatchObject({
        panelIds: [ids.panelIds[1], ids.panelIds[0], ids.panelIds[2]],
      });
      await expect(service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: [ids.panelIds[1]!, ids.panelIds[0]!, ids.panelIds[2]!],
        operation: { type: 'reorder', panelIds: ids.panelIds },
      }, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await pool.query(
        `UPDATE organization_members
         SET status = 'suspended'
         WHERE organization_id = $1::uuid AND user_id = $2::uuid`,
        [ids.organizationId, ids.userId],
      );
      await expect(service.apply(ids.userId, ids.pageId, {
        expectedPanelIds: [ids.panelIds[1]!, ids.panelIds[0]!, ids.panelIds[2]!],
        operation: { type: 'reorder', panelIds: ids.panelIds },
      }, ids.organizationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('構造変更後の古いPanel snapshotではBalloon作成・更新・自動置換を行わない', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const structureService = new PagePanelStructureService(new PostgresPagePanelStructureRepository(database));
    const balloonRepository = new PostgresBalloonRepository(database);
    try {
      await insertFixture(pool, ids);
      const balloonIds = await readBalloonIds(pool, ids.pageId);
      const oldPanelIds = [...ids.panelIds];
      const newPanelIds = [ids.panelIds[1]!, ids.panelIds[0]!, ids.panelIds[2]!];
      await structureService.apply(ids.userId, ids.pageId, {
        expectedPanelIds: oldPanelIds,
        operation: { type: 'reorder', panelIds: newPanelIds },
      });

      await expect(balloonRepository.createBalloon(
        ids.pageId,
        ids.userId,
        balloonInput(1),
        null,
        oldPanelIds,
      )).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(balloonRepository.updateBalloon(
        balloonIds[0]!,
        ids.userId,
        { panelOrderReference: 2 },
        null,
        oldPanelIds,
      )).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(balloonRepository.replaceBalloonsByPageIdAndUserId(
        ids.pageId,
        ids.userId,
        [balloonInput(1)],
        null,
        oldPanelIds,
      )).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([2, 1, 3]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('コマ削除後の最新snapshotでも範囲外Balloon参照を保存しない', async () => {
    const ids = createFixtureIds();
    const database = new PoolTransactionDatabase(pool);
    const structureService = new PagePanelStructureService(new PostgresPagePanelStructureRepository(database));
    const balloonRepository = new PostgresBalloonRepository(database);
    try {
      await insertFixture(pool, ids);
      const newPanelIds = [ids.panelIds[0]!, ids.panelIds[1]!];
      await structureService.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'delete', panelId: ids.panelIds[2]! },
      });

      await expect(balloonRepository.createBalloon(
        ids.pageId,
        ids.userId,
        balloonInput(3),
        null,
        newPanelIds,
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([1, 2, null]);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('Balloon更新がPage lockを先に取った場合に構造削除が待機して参照を再調整する', async () => {
    const ids = createFixtureIds();
    const pausingDatabase = new PausingPageLockDatabase(pool);
    const balloonRepository = new PostgresBalloonRepository(pausingDatabase);
    const structureService = createService(pool);
    try {
      await insertFixture(pool, ids);
      const balloonIds = await readBalloonIds(pool, ids.pageId);
      const balloonUpdate = balloonRepository.updateBalloon(
        balloonIds[0]!,
        ids.userId,
        { panelOrderReference: 3 },
        null,
        ids.panelIds,
      );
      await pausingDatabase.waitForPageLock();

      const structureDelete = structureService.apply(ids.userId, ids.pageId, {
        expectedPanelIds: ids.panelIds,
        operation: { type: 'delete', panelId: ids.panelIds[2]! },
      });
      await expectPromiseToRemainPending(structureDelete);
      pausingDatabase.continueAfterPageLock();

      await expect(balloonUpdate).resolves.toMatchObject({ panelOrderReference: 3 });
      await expect(structureDelete).resolves.toMatchObject({
        panelIds: [ids.panelIds[0], ids.panelIds[1]],
      });
      await expect(readBalloonReferences(pool, ids.pageId)).resolves.toEqual([null, 2, null]);
    } finally {
      pausingDatabase.continueAfterPageLock();
      await removeFixture(pool, ids);
    }
  });
});

interface FixtureIds {
  userId: string;
  workId: string;
  chapterId: string;
  episodeId: string;
  organizationId: string;
  pageId: string;
  panelIds: [string, string, string];
}

function createFixtureIds(): FixtureIds {
  return {
    userId: randomUUID(),
    workId: randomUUID(),
    chapterId: randomUUID(),
    episodeId: randomUUID(),
    organizationId: randomUUID(),
    pageId: randomUUID(),
    panelIds: [randomUUID(), randomUUID(), randomUUID()],
  };
}

async function moveFixtureWorkToOrganization(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO organizations (id, name, created_by_user_id)
     VALUES ($1::uuid, 'Panel structure organization', $2::uuid)`,
    [ids.organizationId, ids.userId],
  );
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
     VALUES ($1::uuid, $2::uuid, 'editor', 'active', NOW())`,
    [ids.organizationId, ids.userId],
  );
  await pool.query(
    'UPDATE works SET organization_id = $2::uuid WHERE id = $1::uuid',
    [ids.workId, ids.organizationId],
  );
}

function createService(pool: Pool): PagePanelStructureService {
  return new PagePanelStructureService(
    new PostgresPagePanelStructureRepository(new PoolTransactionDatabase(pool)),
  );
}

async function insertFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `panel-structure-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title)
     VALUES ($1::uuid, $2::uuid, 'Panel structure test')`,
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
    `INSERT INTO pages (id, episode_id, page_number, status, dialogue_mode, layout_config, generated_image)
     VALUES ($1::uuid, $2::uuid, 1, 'editing', 'mixed', $3::jsonb, $4::jsonb)`,
    [
      ids.pageId,
      ids.episodeId,
      JSON.stringify({ type: 'custom', story_page_purpose: 'keep me' }),
      JSON.stringify({
        s3_key: `session/${ids.userId}/pages/${ids.pageId}/image.png`,
        cdn_url: `https://cdn.example.invalid/${ids.pageId}.png`,
        generation_mode: 'standard',
        generated_at: '2026-08-01T00:00:00.000Z',
      }),
    ],
  );
  for (const [index, panelId] of ids.panelIds.entries()) {
    await pool.query(
      `INSERT INTO panels (id, page_id, "order", entities, dialogue)
       VALUES ($1::uuid, $2::uuid, $3::int, '[]'::jsonb, '[]'::jsonb)`,
      [panelId, ids.pageId, index + 1],
    );
    await pool.query(
      `INSERT INTO panel_frames (
         page_id, panel_id, vertices, border_style, border_width,
         border_color, z_index, reading_order
       )
       VALUES ($1::uuid, $2::uuid, $3::jsonb, 'solid', 3, '#000000', 1, $4::int)`,
      [ids.pageId, panelId, JSON.stringify(rectangle(index + 1)), index + 1],
    );
    await pool.query(
      `INSERT INTO balloons (
         page_id, text, position, panel_order_reference, z_index
       )
       VALUES ($1::uuid, $2, $3::jsonb, $4::int, $4::int)`,
      [
        ids.pageId,
        `Balloon ${index + 1}`,
        JSON.stringify({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
        index + 1,
      ],
    );
  }
}

async function removeFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query('DELETE FROM generation_jobs WHERE user_id = $1::uuid', [ids.userId]);
  await pool.query('DELETE FROM works WHERE id = $1::uuid', [ids.workId]);
  await pool.query('DELETE FROM organizations WHERE id = $1::uuid', [ids.organizationId]);
  await pool.query('DELETE FROM users WHERE id = $1::uuid', [ids.userId]);
}

async function readPanelIds(pool: Pool, pageId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM panels WHERE page_id = $1::uuid ORDER BY "order" ASC',
    [pageId],
  );
  return result.rows.map((row) => row.id);
}

interface FrameSnapshot {
  panel_id: string | null;
  vertices: unknown;
}

async function readFrames(pool: Pool, pageId: string): Promise<FrameSnapshot[]> {
  const result = await pool.query<FrameSnapshot>(
    `SELECT panel_id, vertices
     FROM panel_frames
     WHERE page_id = $1::uuid
     ORDER BY reading_order ASC`,
    [pageId],
  );
  return result.rows;
}

async function readBalloonReferences(pool: Pool, pageId: string): Promise<Array<number | null>> {
  const result = await pool.query<{ panel_order_reference: number | null }>(
    `SELECT panel_order_reference
     FROM balloons
     WHERE page_id = $1::uuid
     ORDER BY z_index ASC`,
    [pageId],
  );
  return result.rows.map((row) => row.panel_order_reference);
}

async function readBalloonIds(pool: Pool, pageId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM balloons WHERE page_id = $1::uuid ORDER BY z_index ASC',
    [pageId],
  );
  return result.rows.map((row) => row.id);
}

function balloonInput(panelOrderReference: number) {
  return {
    speakerEntityId: null,
    balloonType: 'speech' as const,
    writingMode: 'vertical' as const,
    text: 'new balloon',
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    tail: null,
    fontSize: 18,
    fontFamily: 'manga_gothic' as const,
    panelOrderReference,
    zIndex: 20,
  };
}

async function readLayoutMetadata(pool: Pool, pageId: string): Promise<Record<string, unknown>> {
  const result = await pool.query<{ layout_config: unknown }>(
    'SELECT layout_config FROM pages WHERE id = $1::uuid',
    [pageId],
  );
  const value = result.rows[0]?.layout_config;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rectangle(seed: number): Array<{ x: number; y: number }> {
  const offset = seed / 100;
  return [
    { x: offset, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: offset, y: 1 },
  ];
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
    throw new Error('DATABASE_URL is required for the Panel structure integration test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(value: string): void {
  if (!/^panel_structure_[0-9]+_[0-9]+$/u.test(value)) {
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

class PausingPageLockDatabase implements DatabaseClient, TransactionRunner {
  private readonly pageLocked: Promise<void>;
  private readonly continueSignal: Promise<void>;
  private markPageLocked: () => void = () => undefined;
  private releasePageLock: () => void = () => undefined;
  private hasPaused = false;

  public constructor(private readonly pool: Pool) {
    this.pageLocked = new Promise<void>((resolve) => {
      this.markPageLocked = resolve;
    });
    this.continueSignal = new Promise<void>((resolve) => {
      this.releasePageLock = resolve;
    });
  }

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
        query: async <TRow extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<TRow>> => {
          const queryResult = await client.query<TRow>(
            text,
            values === undefined ? undefined : [...values],
          );
          if (!this.hasPaused && text.includes('FOR UPDATE OF pages')) {
            this.hasPaused = true;
            this.markPageLocked();
            await this.continueSignal;
          }
          return queryResult;
        },
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

  public waitForPageLock(): Promise<void> {
    return this.pageLocked;
  }

  public continueAfterPageLock(): void {
    this.releasePageLock();
  }
}

function toDatabaseClient(client: PoolClient): DatabaseClient {
  return {
    query: <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => client.query<T>(
      text,
      values === undefined ? undefined : [...values],
    ),
  };
}
