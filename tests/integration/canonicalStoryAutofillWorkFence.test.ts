import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EpisodePagePlanApplyResult } from '../../src/domain/types/page.js';
import type { GenerationJob } from '../../src/domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../src/repositories/EpisodePlanPersistenceRepository.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;

// Spec 6/10: migration 050 protects every job update with a NOWAIT work fence.
// The attempt identity, commit marker, graph write, progress and terminal result
// must therefore use one transaction-bound client in canonical deployments.
describePostgres('canonical story autofill migration 050 work fence', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `canonical_story_autofill_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 8,
    });
    const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(testDatabase(pool)));
    expect(applied.at(-1)).toBe('052_add_generation_worker_warm_control.sql');
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 120_000);

  it('旧external commit開始は保持中work rowへ別TXで再入して55P03になる', async () => {
    const fixture = await insertFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    const persistence = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'canonical');
    const external = new PostgresEpisodeStoryAutofillExecutionRepository(testDatabase(pool), 'canonical');

    await expect(persistence.withLockedEpisodePlan({
      episodeId: fixture.episodeId,
      userId: fixture.userId,
      organizationId: null,
    }, async () => external.beginEpisodeStoryAutofillCommit(job.id, job.userId)))
      .rejects.toMatchObject({ code: '55P03' });

    await expectUnchanged(pool, fixture, job.id);
  });

  it('claim済みattemptはmarker・NOWAIT graph・progress・保存・完了を同一TXで確定する', async () => {
    const fixture = await insertFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    const persistence = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'canonical');

    await persistence.withLockedEpisodePlan({
      episodeId: fixture.episodeId,
      userId: fixture.userId,
      organizationId: null,
      storyAutofillAttempt: job,
    }, async (_context, resources) => {
      expect(resources.storyAutofillCommitStarted).toBe(true);
      expect(await resources.updateStoryAutofillProgress?.({
        stage: 'applying',
        message: 'Saving story plan.',
        currentChunk: null,
        totalChunks: null,
      })).toBe(true);
      expect(await resources.pageRepository.updatePageSettings(
        fixture.pageId,
        fixture.userId,
        { dialogueMode: 'mixed' },
      )).not.toBeNull();
      expect(await resources.completeStoryAutofillJob?.(job.id, job.userId, completedPlan)).toBe(true);
    });

    expect(await readDialogueMode(pool, fixture.pageId)).toBe('mixed');
    expect(await readJob(pool, job.id)).toMatchObject({
      status: 'completed',
      commit_started_at: expect.any(Date),
      result: expect.objectContaining({ progress_stage: 'completed' }),
    });
    expect(await notificationCount(pool, job.id)).toBe(1);
  });

  it('callback失敗はcanonical marker・progress・contentをまとめてrollbackする', async () => {
    const fixture = await insertFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    const persistence = new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'canonical');
    const injected = new Error('injected atomic rollback');

    await expect(persistence.withLockedEpisodePlan({
      episodeId: fixture.episodeId,
      userId: fixture.userId,
      organizationId: null,
      storyAutofillAttempt: job,
    }, async (_context, resources) => {
      expect(resources.storyAutofillCommitStarted).toBe(true);
      expect(await resources.updateStoryAutofillProgress?.({
        stage: 'applying',
        message: 'Saving story plan.',
        currentChunk: null,
        totalChunks: null,
      })).toBe(true);
      expect(await resources.pageRepository.updatePageSettings(
        fixture.pageId,
        fixture.userId,
        { dialogueMode: 'mixed' },
      )).not.toBeNull();
      expect(await resources.completeStoryAutofillJob?.(job.id, job.userId, completedPlan)).toBe(true);
      throw injected;
    })).rejects.toBe(injected);

    await expectUnchanged(pool, fixture, job.id);
  });
});

interface Fixture {
  userId: string;
  episodeId: string;
  pageId: string;
}

const completedPlan: EpisodePagePlanApplyResult = {
  updatedPageCount: 1,
  updatedPanelCount: 1,
  updatedAssignmentCount: 0,
  filledFieldCount: 1,
  compilerUsed: true,
  compilerProvider: 'openai',
  compilerModel: 'test',
  compilerPromptVersion: 'v1',
  compilerError: null,
};

async function insertFixture(pool: Pool): Promise<Fixture> {
  const userId = randomUUID();
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  const panelId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [
    userId, `canonical-fence-${userId}`, `${userId}@example.invalid`,
  ]);
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Canonical story autofill fence')", [workId, userId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query("INSERT INTO episodes(id,chapter_id,\"order\",estimated_pages,introduction) VALUES($1,$2,1,1,'initial source')", [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status,dialogue_mode) VALUES($1,$2,1,'editing','image_baked')", [pageId, episodeId]);
  await pool.query("INSERT INTO panels(id,page_id,\"order\",situation_text) VALUES($1,$2,1,'initial')", [panelId, pageId]);
  await pool.query(
    'INSERT INTO panel_frames(page_id,panel_id,vertices,reading_order) VALUES($1,$2,$3::jsonb,1)',
    [pageId, panelId, JSON.stringify([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ])],
  );
  return { userId, episodeId, pageId };
}

async function insertAndClaimJob(pool: Pool, fixture: Fixture): Promise<GenerationJob> {
  const jobId = randomUUID();
  await pool.query(`INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params)
    VALUES($1,$2,'episode_story_autofill','queued',0,$3::jsonb)`, [
    jobId,
    fixture.userId,
    JSON.stringify({ episode_id: fixture.episodeId, language: 'ja' }),
  ]);
  const job = await new PostgresEpisodeStoryAutofillExecutionRepository(testDatabase(pool), 'canonical')
    .claimQueuedEpisodeStoryAutofillJob(jobId);
  if (job === null || job.startedAt === null) throw new Error('Failed to claim canonical autofill fixture');
  return job;
}

async function expectUnchanged(pool: Pool, fixture: Fixture, jobId: string): Promise<void> {
  expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
  expect(await readJob(pool, jobId)).toMatchObject({
    status: 'processing',
    commit_started_at: null,
    result: null,
  });
  expect(await notificationCount(pool, jobId)).toBe(0);
}

async function readDialogueMode(pool: Pool, pageId: string): Promise<string | null> {
  return (await pool.query<{ dialogue_mode: string }>(
    'SELECT dialogue_mode FROM pages WHERE id=$1', [pageId],
  )).rows[0]?.dialogue_mode ?? null;
}

async function readJob(pool: Pool, jobId: string): Promise<Record<string, unknown>> {
  return (await pool.query(
    'SELECT status,commit_started_at,result FROM generation_jobs WHERE id=$1', [jobId],
  )).rows[0] ?? {};
}

async function notificationCount(pool: Pool, jobId: string): Promise<number> {
  return (await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM mobile_push_notification_outbox WHERE generation_job_id=$1',
    [jobId],
  )).rows[0]?.count ?? 0;
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
