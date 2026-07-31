import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PanelEntityAssignment } from '../../src/domain/types/panelEntityAssignment.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresPanelEntityAssignmentRepository } from '../../src/repositories/PanelEntityAssignmentRepository.js';
import { PanelEntityAssignmentService } from '../../src/services/page/PanelEntityAssignmentService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('panel entity assignment conditional update', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `panel_assignment_${process.pid}_${Date.now()}`;
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

  it('保存前snapshotが一致する場合だけ同一workのEntityとstateを保存する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];
      const replacement = [assignment(ids.entityId, ids.stateId, {
        expression: 'calm',
        action: 'running',
        effectNote: 'after',
      })];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        null,
        expected,
      )).resolves.toEqual(replacement);
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(replacement);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('active organization memberはorganization scopeで条件付き保存できる', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      await moveFixtureWorkToOrganization(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];
      const replacement = [assignment(ids.entityId, ids.stateId, { role: 'secondary' })];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        ids.organizationId,
        expected,
      )).resolves.toEqual(replacement);
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(replacement);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('organization scopeは非active member、別organization、personal fallbackを拒否する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      await moveFixtureWorkToOrganization(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];
      const replacement = [assignment(ids.entityId, ids.stateId, { role: 'secondary' })];
      await pool.query(
        `UPDATE organization_members
         SET status = 'suspended'
         WHERE organization_id = $1::uuid AND user_id = $2::uuid`,
        [ids.organizationId, ids.userId],
      );

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        ids.organizationId,
        expected,
      )).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await pool.query(
        `UPDATE organization_members
         SET status = 'active'
         WHERE organization_id = $1::uuid AND user_id = $2::uuid`,
        [ids.organizationId, ids.userId],
      );
      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        randomUUID(),
        expected,
      )).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        null,
        expected,
      )).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(expected);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('古いnullable field欠損JSONをnullへ正規化して条件付き保存できる', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `UPDATE panels
         SET entities = $2::jsonb
         WHERE id = $1::uuid`,
        [
          ids.panelId,
          JSON.stringify([{
            entity_id: ids.entityId,
            role: 'primary',
            expression: 'determined',
            action: 'attacking',
            position: 'center',
          }]),
        ],
      );
      const expected = [assignment(ids.entityId, null, { facingDirection: null })];
      const replacement = [assignment(ids.entityId, ids.stateId, { role: 'secondary' })];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        null,
        expected,
      )).resolves.toEqual(replacement);
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(replacement);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('古いstale custom値とメモ空白をrequestと同じ意味値へ正規化して比較する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      await pool.query(
        `UPDATE panels
         SET entities = $2::jsonb
         WHERE id = $1::uuid`,
        [
          ids.panelId,
          JSON.stringify([{
            entity_id: ids.entityId,
            role: 'primary',
            expression: 'calm',
            custom_expression: 'stale expression',
            action: 'running',
            custom_action: 'stale action',
            position: 'center',
            facing_direction: null,
            effect_note: '  rim light  ',
            state_id: null,
          }]),
        ],
      );
      const expected = [assignment(ids.entityId, null, {
        expression: 'calm',
        action: 'running',
        facingDirection: null,
        effectNote: 'rim light',
      })];
      const replacement = [assignment(ids.entityId, ids.stateId, { role: 'secondary' })];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        replacement,
        null,
        expected,
      )).resolves.toEqual(replacement);
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(replacement);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('破損した保存済みentitiesを空扱いせず条件付き上書きを拒否する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    const brokenEntities = { corrupted: true };

    try {
      await insertFixture(pool, ids);
      await pool.query(
        'UPDATE panels SET entities = $2::jsonb WHERE id = $1::uuid',
        [ids.panelId, JSON.stringify(brokenEntities)],
      );

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [assignment(ids.entityId, ids.stateId, { role: 'secondary' })],
        null,
        [],
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(readRawPanelJson(pool, ids.panelId, 'entities')).resolves.toEqual(brokenEntities);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('破損した保存済みdialogueではassignmentを変更しない', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    const brokenDialogue = { corrupted: true };

    try {
      await insertFixture(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];
      await pool.query(
        'UPDATE panels SET dialogue = $2::jsonb WHERE id = $1::uuid',
        [ids.panelId, JSON.stringify(brokenDialogue)],
      );

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [assignment(ids.entityId, ids.stateId, { role: 'secondary' })],
        null,
        expected,
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(expected);
      await expect(readRawPanelJson(pool, ids.panelId, 'dialogue')).resolves.toEqual(brokenDialogue);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('Story自動入力相当のlock中更新を待ち、commit後はstaleとして上書きしない', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);
    let plannerClient: PoolClient | undefined;

    try {
      await insertFixture(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];
      const plannerAssignments = [assignment(ids.entityId, ids.stateId, { role: 'secondary' })];
      plannerClient = await pool.connect();
      await plannerClient.query('BEGIN');
      await plannerClient.query('SELECT id FROM pages WHERE id = $1::uuid FOR UPDATE', [ids.pageId]);
      await plannerClient.query('SELECT id FROM panels WHERE id = $1::uuid FOR UPDATE', [ids.panelId]);
      await plannerClient.query(
        'UPDATE panels SET entities = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid',
        [ids.panelId, JSON.stringify(plannerAssignments.map(toAssignmentJson))],
      );

      const savePromise = service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [assignment(ids.entityId, ids.stateId, { role: 'background' })],
        null,
        expected,
      );
      await expectPromiseToRemainPending(savePromise);
      await plannerClient.query('COMMIT');

      await expect(savePromise).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(plannerAssignments);
    } finally {
      if (plannerClient !== undefined) {
        try {
          await plannerClient.query('ROLLBACK');
        } catch {
          // COMMIT済みまたは切断済みならfixture cleanupへ進む。
        }
        plannerClient.release();
      }
      await removeFixture(pool, ids);
    }
  }, 30_000);

  it.each(['confirmed', 'generating'] as const)(
    '%s Pageではassignmentを変更しない',
    async (status) => {
      const ids = createFixtureIds();
      const service = createService(pool);

      try {
        await insertFixture(pool, ids);
        await pool.query('UPDATE pages SET status = $2 WHERE id = $1::uuid', [ids.pageId, status]);
        const expected = [assignment(ids.entityId, ids.stateId)];

        await expect(service.replacePanelEntityAssignments(
          ids.userId,
          ids.panelId,
          [assignment(ids.entityId, ids.stateId, { role: 'secondary' })],
          null,
          expected,
        )).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(expected);
      } finally {
        await removeFixture(pool, ids);
      }
    },
  );

  it('保存済み会話speakerをassignmentから外す場合は変更しない', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [],
        null,
        expected,
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(expected);
    } finally {
      await removeFixture(pool, ids);
    }
  });

  it('別workのEntityと別Entityのstateをtransaction内で拒否する', async () => {
    const ids = createFixtureIds();
    const service = createService(pool);

    try {
      await insertFixture(pool, ids);
      const expected = [assignment(ids.entityId, ids.stateId)];

      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [assignment(ids.otherEntityId, ids.otherStateId)],
        null,
        expected,
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(service.replacePanelEntityAssignments(
        ids.userId,
        ids.panelId,
        [assignment(ids.entityId, ids.otherStateId)],
        null,
        expected,
      )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(readAssignments(pool, ids.panelId)).resolves.toEqual(expected);
    } finally {
      await removeFixture(pool, ids);
    }
  });
});

interface FixtureIds {
  chapterId: string;
  entityId: string;
  episodeId: string;
  otherEntityId: string;
  otherStateId: string;
  otherWorkId: string;
  organizationId: string;
  pageId: string;
  panelId: string;
  stateId: string;
  userId: string;
  workId: string;
}

function createFixtureIds(): FixtureIds {
  return {
    chapterId: randomUUID(),
    entityId: randomUUID(),
    episodeId: randomUUID(),
    otherEntityId: randomUUID(),
    otherStateId: randomUUID(),
    otherWorkId: randomUUID(),
    organizationId: randomUUID(),
    pageId: randomUUID(),
    panelId: randomUUID(),
    stateId: randomUUID(),
    userId: randomUUID(),
    workId: randomUUID(),
  };
}

async function moveFixtureWorkToOrganization(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO organizations (id, name, created_by_user_id)
     VALUES ($1::uuid, 'Panel assignment organization', $2::uuid)`,
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

function createService(pool: Pool): PanelEntityAssignmentService {
  const database = new PoolTransactionDatabase(pool);
  return new PanelEntityAssignmentService(new PostgresPanelEntityAssignmentRepository(database));
}

async function insertFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `panel-assignment-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title)
     VALUES ($1::uuid, $2::uuid, 'Panel assignment test'),
            ($3::uuid, $2::uuid, 'Other work')`,
    [ids.workId, ids.userId, ids.otherWorkId],
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
  await pool.query(
    `INSERT INTO entities (id, work_id, user_id, name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Speaker'),
            ($4::uuid, $5::uuid, $3::uuid, 'Other entity')`,
    [ids.entityId, ids.workId, ids.userId, ids.otherEntityId, ids.otherWorkId],
  );
  await pool.query(
    `INSERT INTO entity_states (id, entity_id, expression_default)
     VALUES ($1::uuid, $2::uuid, 'calm'),
            ($3::uuid, $4::uuid, 'angry')`,
    [ids.stateId, ids.entityId, ids.otherStateId, ids.otherEntityId],
  );
  const initial = assignment(ids.entityId, ids.stateId);
  await pool.query(
    `INSERT INTO panels (id, page_id, "order", entities, dialogue)
     VALUES (
       $1::uuid,
       $2::uuid,
       1,
       $3::jsonb,
       $4::jsonb
     )`,
    [
      ids.panelId,
      ids.pageId,
      JSON.stringify([toAssignmentJson(initial)]),
      JSON.stringify([
        {
          entity_id: ids.entityId,
          text: 'hello',
          type: 'speech',
          position: 'top',
        },
      ]),
    ],
  );
}

async function removeFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [[ids.workId, ids.otherWorkId]]);
  await pool.query('DELETE FROM organizations WHERE id = $1::uuid', [ids.organizationId]);
  await pool.query('DELETE FROM users WHERE id = $1::uuid', [ids.userId]);
}

async function readAssignments(pool: Pool, panelId: string): Promise<PanelEntityAssignment[]> {
  const result = await pool.query<{ entities: unknown }>(
    'SELECT entities FROM panels WHERE id = $1::uuid',
    [panelId],
  );
  const value = result.rows[0]?.entities;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const assignmentValue = entry as Record<string, unknown>;
    return {
      entityId: String(assignmentValue.entity_id),
      role: assignmentValue.role as PanelEntityAssignment['role'],
      expression: assignmentValue.expression as PanelEntityAssignment['expression'],
      customExpression: assignmentValue.custom_expression as string | null,
      action: assignmentValue.action as PanelEntityAssignment['action'],
      customAction: assignmentValue.custom_action as string | null,
      position: assignmentValue.position as PanelEntityAssignment['position'],
      facingDirection: assignmentValue.facing_direction as PanelEntityAssignment['facingDirection'],
      effectNote: assignmentValue.effect_note as string | null,
      stateId: assignmentValue.state_id as string | null,
    };
  });
}

async function readRawPanelJson(
  pool: Pool,
  panelId: string,
  field: 'dialogue' | 'entities',
): Promise<unknown> {
  const result = await pool.query<{ value: unknown }>(
    `SELECT ${field} AS value FROM panels WHERE id = $1::uuid`,
    [panelId],
  );
  return result.rows[0]?.value;
}

function assignment(
  entityId: string,
  stateId: string | null,
  overrides: Partial<PanelEntityAssignment> = {},
): PanelEntityAssignment {
  return {
    entityId,
    role: 'primary',
    expression: 'determined',
    customExpression: null,
    action: 'attacking',
    customAction: null,
    position: 'center',
    facingDirection: 'front',
    effectNote: null,
    stateId,
    ...overrides,
  };
}

function toAssignmentJson(value: PanelEntityAssignment): Record<string, unknown> {
  return {
    entity_id: value.entityId,
    role: value.role,
    expression: value.expression,
    custom_expression: value.customExpression,
    action: value.action,
    custom_action: value.customAction,
    position: value.position,
    facing_direction: value.facingDirection,
    effect_note: value.effectNote,
    state_id: value.stateId,
  };
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
    throw new Error('DATABASE_URL is required for the Panel assignment integration test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(value: string): void {
  if (!/^panel_assignment_[0-9]+_[0-9]+$/u.test(value)) {
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
    query: <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => client.query<T>(
      text,
      values === undefined ? undefined : [...values],
    ),
  };
}
