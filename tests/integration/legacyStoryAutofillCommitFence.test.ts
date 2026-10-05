import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/domain/errors/index.js';
import type { EpisodePagePlanApplyResult } from '../../src/domain/types/page.js';
import type { GenerationJob } from '../../src/domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../src/repositories/EpisodePlanPersistenceRepository.js';
import {
  PostgresEpisodeStoryAutofillExecutionRepository,
} from '../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { PostgresOrganizationRepository } from '../../src/repositories/OrganizationRepository.js';
import { PostgresPanelRepository } from '../../src/repositories/PanelRepository.js';
import { PostgresPanelFrameRepository } from '../../src/repositories/PanelFrameRepository.js';
import type { EpisodePlanPersistenceResources } from '../../src/services/page/EpisodePlanPersistence.js';
import { fingerprintEpisodePlanningContext } from '../../src/services/page/EpisodePlanContinuity.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

interface AtomicResources extends EpisodePlanPersistenceResources {
  storyAutofillCommitStarted: boolean;
  updateStoryAutofillProgress?: (input: {
    stage: string;
    message: string;
    currentChunk: number | null;
    totalChunks: number | null;
  }) => Promise<boolean>;
}

// Spec 5/11: only explicit legacy queued autofill uses the durable attempt
// identity. Admission, commit marker, graph write, applying progress and the
// legacy terminal trigger must share one transaction and one database client.
describePostgres('legacy story autofill atomic commit fence', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `legacy_story_autofill_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 16,
    });
    expect(await withPostgresTestMigrationLock(admin, () => runPendingMigrations(testDatabase(pool), {
      migrationsDir: LEGACY_MIGRATIONS,
    }))).toHaveLength(38);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 120_000);

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    '退会状態%sはjob marker・content・通知を全て拒否する', async (status) => {
      const fixture = await insertFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      await insertDeletionRequest(pool, fixture.userId, status);
      const database = new TrackingDatabase(pool);

      const outcome = await settle(commitPlan(database, fixture, job));

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(database.transactionQueries.some((sql) => sql.includes('FOR UPDATE OF works'))).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    },
  );

  it.each([null, 'blocked'] as const)(
    'request %s は実claim時刻を使いmax1の同一TXでatomic完了する', async (requestStatus) => {
      const fixture = await insertFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      if (requestStatus !== null) await insertDeletionRequest(pool, fixture.userId, requestStatus);
      const single = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema},public -c statement_timeout=30000`,
        max: 1,
        connectionTimeoutMillis: 500,
      });
      try {
        const database = new TrackingDatabase(single);
        await commitPlan(database, fixture, job);
        expect(database.transactionCount).toBe(1);
        expect(database.baseQueriesDuringTransaction).toBe(0);
        const queries = database.transactionQueries;
        const candidate = queries.findIndex((sql) => sql.includes('FROM generation_jobs') && !sql.includes('FOR UPDATE'));
        const user = queries.findIndex((sql) => sql.includes('FROM users') && sql.includes('FOR UPDATE'));
        const request = queries.findIndex((sql) => sql.includes('account_deletion_requests'));
        const registry = queries.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
        const jobLock = queries.findIndex((sql) => sql.includes('FROM generation_jobs') && sql.includes('FOR UPDATE'));
        const graph = queries.findIndex((sql) => sql.includes('FOR UPDATE OF works'));
        expect(candidate).toBeGreaterThanOrEqual(0);
        expect(user).toBeGreaterThan(candidate);
        expect(request).toBeGreaterThan(user);
        expect(registry).toBeGreaterThan(request);
        expect(jobLock).toBeGreaterThan(registry);
        expect(graph).toBeGreaterThan(jobLock);
        expect(await readDialogueMode(pool, fixture.pageId)).toBe('mixed');
        expect((await readJob(pool, job.id))).toMatchObject({
          status: 'completed',
          commit_started_at: expect.any(Date),
          result: expect.objectContaining({ progress_stage: 'completed' }),
        });
        expect(await notificationCount(pool, job.id)).toBe(1);
      } finally {
        await single.end();
      }
    },
  );

  it('active organization attemptは個人退会状態に影響されずactual resource scopeで完了する', async () => {
    const fixture = await insertOrganizationFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    await insertDeletionRequest(pool, fixture.userId, 'processing');

    await commitPlan(testDatabase(pool), fixture, job);

    expect(await readDialogueMode(pool, fixture.pageId)).toBe('mixed');
    expect((await readJob(pool, job.id)).status).toBe('completed');
    expect(await notificationCount(pool, job.id)).toBe(1);
  });

  it.each(['retry', 'started', 'params', 'cancel'] as const)(
    '%s変更後のstale attemptはcontent・marker・通知を残さずsettlementも上書きしない', async (kind) => {
      const fixture = await insertFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      if (kind === 'retry') {
        await pool.query("UPDATE generation_jobs SET status='queued',retry_count=retry_count+1,started_at=NULL WHERE id=$1", [job.id]);
        await new PostgresEpisodeStoryAutofillExecutionRepository(testDatabase(pool), 'legacy_2debe_v1')
          .claimQueuedEpisodeStoryAutofillJob(job.id);
      }
      if (kind === 'started') await pool.query("UPDATE generation_jobs SET started_at=started_at+interval '1 second' WHERE id=$1", [job.id]);
      if (kind === 'params') await pool.query(`UPDATE generation_jobs SET params=params || '{"language":"en"}'::jsonb WHERE id=$1`, [job.id]);
      if (kind === 'cancel') await pool.query('UPDATE generation_jobs SET cancel_requested_at=NOW(),cancel_requested_by=$2 WHERE id=$1', [job.id, fixture.userId]);

      const repository = new PostgresEpisodeStoryAutofillExecutionRepository(testDatabase(pool), 'legacy_2debe_v1');
      const outcome = await settle(commitPlan(testDatabase(pool), fixture, job));
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id, kind === 'retry' || kind === 'started' || kind === 'params' ? 'processing' : 'processing');
      expect(await repository.settleEpisodeStoryAutofillAttempt(job, 'old worker failed')).toBe(
        kind === 'cancel' ? 'cancelled' : 'lost',
      );
      if (kind !== 'cancel') expect((await readJob(pool, job.id)).status).toBe('processing');
    },
  );

  it.each(['fake organization', 'foreign actor', 'foreign episode', 'inactive member'] as const)(
    '%sはactual job/resource scope再照合で変更0になる', async (kind) => {
      const fixture = kind === 'inactive member' ? await insertOrganizationFixture(pool) : await insertFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const inputFixture = { ...fixture };
      const inputJob = { ...job };
      if (kind === 'fake organization') inputJob.organizationId = randomUUID();
      if (kind === 'foreign actor') inputJob.userId = await insertUser(pool);
      if (kind === 'foreign episode') inputFixture.episodeId = (await insertFixture(pool, fixture.userId)).episodeId;
      if (kind === 'inactive member' && fixture.organizationId !== null) {
        await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [fixture.organizationId, fixture.userId]);
      }
      const outcome = await settle(commitPlan(testDatabase(pool), inputFixture, inputJob));
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    },
  );

  it.each(['source', 'child', 'terminal'] as const)(
    '%s失敗はcommit marker・content・通知を全rollbackする', async (kind) => {
      const fixture = await insertFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const initial = await readFingerprint(pool, fixture);
      if (kind === 'source') await pool.query("UPDATE episodes SET introduction='edited concurrently' WHERE id=$1", [fixture.episodeId]);
      const database = new TrackingDatabase(pool, (sql) => kind === 'child'
        ? sql.replace('UPDATE pages', 'UPDATE missing_story_autofill_pages')
        : kind === 'terminal'
          ? sql.replace('AND commit_started_at IS NOT NULL', 'AND FALSE')
          : sql);
      const outcome = await settle(commitPlan(database, fixture, job, initial));
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    },
  );

  it('cancel先行はcommitのjob lockを待たせ、解除後もcontentとmarkerを拒否する', async () => {
    const fixture = await insertFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    const cancel = await PinnedDatabase.connect(pool);
    const commit = await PinnedDatabase.connect(pool);
    try {
      await cancel.query('BEGIN');
      await cancel.query(`UPDATE generation_jobs
        SET cancel_requested_at=NOW(),cancel_requested_by=$2
        WHERE id=$1 AND status='processing' AND commit_started_at IS NULL`, [job.id, fixture.userId]);
      const commitOutcome = settle(commitPlan(commit, fixture, job));
      await waitForBlockedQuery(pool, commit.pid);
      await cancel.query('COMMIT');
      const outcome = await commitOutcome;
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    } finally {
      await settle(cancel.query('ROLLBACK'));
      await cancel.close();
      await commit.close();
    }
  });

  it('commit先行はcancelをjob lockで待たせ、atomic完了後のcancel CASを0件にする', async () => {
    const fixture = await insertFixture(pool);
    const job = await insertAndClaimJob(pool, fixture);
    const commitGate = deferred<void>();
    const commitLocked = deferred<void>();
    const commit = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('SET commit_started_at')) {
        commitLocked.resolve();
        await commitGate.promise;
      }
    });
    const cancel = await PinnedDatabase.connect(pool);
    try {
      const commitOutcome = commitPlan(commit, fixture, job);
      await waitForSignal(commitLocked.promise, 'story autofill commit marker');
      const cancelOutcome = cancel.query(`UPDATE generation_jobs
        SET cancel_requested_at=NOW(),cancel_requested_by=$2
        WHERE id=$1 AND status='processing' AND commit_started_at IS NULL
        RETURNING id`, [job.id, fixture.userId]);
      await waitForBlockedQuery(pool, cancel.pid);
      commitGate.resolve();
      await commitOutcome;
      expect((await cancelOutcome).rowCount).toBe(0);
      expect(await readDialogueMode(pool, fixture.pageId)).toBe('mixed');
      expect((await readJob(pool, job.id)).status).toBe('completed');
      expect(await notificationCount(pool, job.id)).toBe(1);
    } finally {
      commitGate.resolve();
      await commit.close();
      await cancel.close();
    }
  });

  it.each(['commit first', 'removal first'] as const)(
    '%sはactive membershipの失効とStory autofill確定を直列化する', async (order) => {
      const fixture = await insertOrganizationFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const organizationId = fixture.organizationId;
      const memberId = (await pool.query<{ id: string }>(
        'SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2',
        [organizationId, fixture.userId],
      )).rows[0]?.id;
      if (memberId === undefined || organizationId === null) throw new Error('Missing fixture member');
      const gate = deferred<void>();
      const acquired = deferred<void>();
      const first = await PinnedDatabase.connect(pool, async (sql) => {
        const stop = order === 'commit first'
          ? sql.includes('FOR UPDATE OF works, chapters, episodes')
          : sql.includes('UPDATE organization_members');
        if (stop) { acquired.resolve(); await gate.promise; }
      });
      const second = await PinnedDatabase.connect(pool);
      const commit = (database: PinnedDatabase) => commitPlan(database, fixture, job);
      const remove = (database: PinnedDatabase) => database.transaction(async (client) => {
        const organization = new PostgresOrganizationRepository(database, database);
        await organization.findOrganizationById(organizationId, client, true);
        return organization.updateMember(organizationId, memberId, { status: 'removed' }, client);
      });
      let firstResult: Promise<unknown> | undefined;
      let secondResult: Promise<unknown> | undefined;
      try {
        firstResult = settle<unknown>(order === 'commit first' ? commit(first) : remove(first));
        await waitForSignal(acquired.promise, 'membership or graph lock');
        secondResult = settle<unknown>(order === 'commit first' ? remove(second) : commit(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        if (order === 'commit first') {
          expect(await firstResult).toMatchObject({ ok: true });
          expect(await secondResult).toMatchObject({ ok: true, value: { status: 'removed' } });
          expect(await notificationCount(pool, job.id)).toBe(1);
        } else {
          expect(await firstResult).toMatchObject({ ok: true, value: { status: 'removed' } });
          expect(await secondResult).toMatchObject({ ok: false });
          await expectUnchanged(pool, fixture, job.id);
        }
      } finally {
        gate.resolve();
        await firstResult;
        await secondResult;
        await first.close();
        await second.close();
      }
    }, 10_000,
  );

  it.each([
    ['commit first', true], ['downgrade first', true],
    ['commit first', false], ['downgrade first', false],
  ] as const)(
    '%s・organization lock=%sはedit_work降格とStory autofill確定を直列化する', async (order, lockOrganization) => {
      const fixture = await insertOrganizationFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const organizationId = fixture.organizationId;
      const memberId = (await pool.query<{ id: string }>(
        'SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2',
        [organizationId, fixture.userId],
      )).rows[0]?.id;
      if (memberId === undefined || organizationId === null) throw new Error('Missing fixture member');
      const gate = deferred<void>();
      const acquired = deferred<void>();
      const first = await PinnedDatabase.connect(pool, async (sql) => {
        const stop = order === 'commit first'
          ? sql.includes('FOR UPDATE OF works, chapters, episodes')
          : sql.includes('UPDATE organization_members');
        if (stop) { acquired.resolve(); await gate.promise; }
      });
      const second = await PinnedDatabase.connect(pool);
      const commit = (database: PinnedDatabase) => commitPlan(database, fixture, job);
      const downgrade = (database: PinnedDatabase) => database.transaction(async (client) => {
        const organization = new PostgresOrganizationRepository(database, database);
        if (lockOrganization) await organization.findOrganizationById(organizationId, client, true);
        return organization.updateMember(organizationId, memberId, { role: 'viewer' }, client);
      });
      let firstResult: Promise<unknown> | undefined;
      let secondResult: Promise<unknown> | undefined;
      try {
        firstResult = settle<unknown>(order === 'commit first' ? commit(first) : downgrade(first));
        await waitForSignal(acquired.promise, 'role update or graph lock');
        secondResult = settle<unknown>(order === 'commit first' ? downgrade(second) : commit(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        if (order === 'commit first') {
          expect(await firstResult).toMatchObject({ ok: true });
          expect(await secondResult).toMatchObject({ ok: true, value: { role: 'viewer' } });
          expect(await notificationCount(pool, job.id)).toBe(1);
        } else {
          expect(await firstResult).toMatchObject({ ok: true, value: { role: 'viewer' } });
          expect(await secondResult).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
          await expectUnchanged(pool, fixture, job.id);
        }
        expect((await pool.query<{ role: string }>(
          'SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2',
          [organizationId, fixture.userId],
        )).rows[0]?.role).toBe('viewer');
      } finally {
        gate.resolve();
        await firstResult;
        await secondResult;
        await first.close();
        await second.close();
      }
    }, 10_000,
  );

  it.each(['Frame replace', 'Panel delete'] as const)(
    'org %sがFrameを先行lockしても40P01を起こさずStory autofillを全rollbackして通常編集を保存する', async (kind) => {
      const fixture = await insertOrganizationFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const frames = await new PostgresPanelFrameRepository(testDatabase(pool), 'legacy_2debe_v1')
        .findFramesByPageIdAndUserId(fixture.pageId, fixture.userId, fixture.organizationId);
      const gate = deferred<void>();
      const acquired = deferred<void>();
      const editor = await PinnedDatabase.connect(pool, async (sql) => {
        if (sql.includes(kind === 'Frame replace' ? 'DELETE FROM panel_frames' : 'UPDATE panel_frames')) {
          acquired.resolve();
          await gate.promise;
        }
      });
      const committer = await PinnedDatabase.connect(pool);
      const edit = settle<unknown>(kind === 'Frame replace'
        ? new PostgresPanelFrameRepository(editor, 'legacy_2debe_v1')
          .replaceFramesByPageIdAndUserId(
            fixture.pageId,
            fixture.userId,
            frames.map((frame) => ({ ...frame, borderWidth: 7 })),
            undefined,
            fixture.organizationId,
          )
        : new PostgresPanelRepository(editor, 'legacy_2debe_v1')
          .deletePanel(fixture.panelId, fixture.userId, fixture.organizationId));
      let commit: ReturnType<typeof settle> | undefined;
      let commitSettled = false;
      try {
        await waitForSignal(acquired.promise, 'normal editor frame lock');
        commit = settle(commitPlan(committer, fixture, job));
        void commit.then(() => { commitSettled = true; });
        await waitForBlockedOrSettled(pool, committer.pid, () => commitSettled);
        gate.resolve();
        const edited = await edit;
        const committed = await commit;
        expect(edited.ok).toBe(true);
        expect(committed.ok).toBe(false);
        if (!committed.ok) expect(committed.error).toMatchObject({ code: 'CONFLICT' });
        await expectUnchanged(pool, fixture, job.id);
        if (kind === 'Frame replace') {
          expect((await pool.query('SELECT border_width FROM panel_frames WHERE page_id=$1', [fixture.pageId])).rows[0]?.border_width).toBe(7);
        } else {
          expect((await pool.query('SELECT id FROM panels WHERE id=$1', [fixture.panelId])).rowCount).toBe(0);
          expect((await pool.query('SELECT panel_id FROM panel_frames WHERE page_id=$1', [fixture.pageId])).rows[0]?.panel_id).toBeNull();
        }
      } finally {
        gate.resolve();
        await edit;
        await commit;
        await editor.close();
        await committer.close();
      }
    }, 10_000,
  );

  it.each(['commit first', 'anonymize first'] as const)(
    '%sでもusers→organizations→membership順を保ちorg確定と退会匿名化のcycleを作らない', async (order) => {
      const fixture = await insertOrganizationFixture(pool);
      const job = await insertAndClaimJob(pool, fixture);
      const token = randomUUID();
      await insertDeletionRequest(pool, fixture.userId, 'processing');
      await pool.query(
        'UPDATE account_deletion_requests SET processing_token=$2,processing_started_at=NOW() WHERE user_id=$1',
        [fixture.userId, token],
      );
      const gate = deferred<void>();
      const acquired = deferred<void>();
      const first = await PinnedDatabase.connect(pool, async (sql) => {
        const stop = order === 'commit first'
          ? sql.includes('FOR UPDATE OF works, chapters, episodes')
          : sql.includes('DELETE FROM organization_members');
        if (stop) { acquired.resolve(); await gate.promise; }
      });
      const second = await PinnedDatabase.connect(pool);
      const commit = (database: PinnedDatabase) => commitPlan(database, fixture, job);
      const anonymize = (database: PinnedDatabase) => new PostgresLegacyAccountDeletionRepository(database, database)
        .anonymizePersonalData(fixture.userId, token);
      let firstResult: Promise<unknown> | undefined;
      let secondResult: Promise<unknown> | undefined;
      try {
        firstResult = settle<unknown>(order === 'commit first' ? commit(first) : anonymize(first));
        await waitForSignal(acquired.promise, 'anonymize or graph lock');
        secondResult = settle<unknown>(order === 'commit first' ? anonymize(second) : commit(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        expect(await firstResult).toMatchObject({ ok: true });
        if (order === 'commit first') {
          expect(await secondResult).toEqual({ ok: true, value: true });
          expect(await notificationCount(pool, job.id)).toBe(1);
        } else {
          expect(await secondResult).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
          await expectUnchanged(pool, fixture, job.id);
        }
        expect((await pool.query(
          'SELECT status FROM organization_members WHERE organization_id=$1 AND user_id=$2',
          [fixture.organizationId, fixture.userId],
        )).rowCount).toBe(0);
      } finally {
        gate.resolve();
        await firstResult;
        await secondResult;
        await first.close();
        await second.close();
      }
    }, 10_000,
  );
});

async function commitPlan(
  database: DatabaseClient & TransactionRunner,
  fixture: Fixture,
  job: GenerationJob,
  expectedFingerprint?: string,
): Promise<void> {
  const repository = new PostgresEpisodePlanPersistenceRepository(database, 'legacy_2debe_v1');
  await repository.withLockedEpisodePlan({
    episodeId: fixture.episodeId,
    userId: job.userId,
    organizationId: job.organizationId ?? null,
    storyAutofillAttempt: job,
  }, async (context, resources) => {
    if (expectedFingerprint !== undefined && fingerprintEpisodePlanningContext(context) !== expectedFingerprint) {
      throw new ConflictError('Episode source changed');
    }
    const atomic = resources as AtomicResources;
    if (!atomic.storyAutofillCommitStarted || atomic.updateStoryAutofillProgress === undefined) {
      throw new Error('Missing bound legacy story autofill resources');
    }
    if (!await atomic.updateStoryAutofillProgress({
      stage: 'applying', message: 'Saving story plan.', currentChunk: null, totalChunks: null,
    })) throw new ConflictError('Bound progress was rejected');
    const updated = await resources.pageRepository.updatePageSettings(
      fixture.pageId, job.userId, { dialogueMode: 'mixed' }, job.organizationId,
    );
    if (updated === null) throw new ConflictError('Page update was rejected');
    if (!await resources.completeStoryAutofillJob?.(job.id, job.userId, completedPlan)) {
      throw new ConflictError('Terminal update was rejected');
    }
  });
}

const completedPlan: EpisodePagePlanApplyResult = {
  updatedPageCount: 1, updatedPanelCount: 1, updatedAssignmentCount: 0, filledFieldCount: 1,
  compilerUsed: true, compilerProvider: 'openai', compilerModel: 'test', compilerPromptVersion: 'v1', compilerError: null,
};

interface Fixture {
  userId: string;
  organizationId: string | null;
  workId: string;
  episodeId: string;
  pageId: string;
  panelId: string;
}

async function insertAndClaimJob(pool: Pool, fixture: Fixture): Promise<GenerationJob> {
  const jobId = randomUUID();
  await pool.query(`INSERT INTO generation_jobs(id,user_id,organization_id,job_type,status,credit_cost,params)
    VALUES($1,$2,$3,'episode_story_autofill','queued',0,$4::jsonb)`, [
    jobId, fixture.userId, fixture.organizationId,
    JSON.stringify({ episode_id: fixture.episodeId, language: 'ja' }),
  ]);
  const job = await new PostgresEpisodeStoryAutofillExecutionRepository(testDatabase(pool), 'legacy_2debe_v1')
    .claimQueuedEpisodeStoryAutofillJob(jobId);
  if (job === null || job.startedAt === null) throw new Error('Failed to claim story autofill fixture');
  return job;
}

async function insertFixture(pool: Pool, existingUserId?: string, organizationId: string | null = null): Promise<Fixture> {
  const userId = existingUserId ?? await insertUser(pool);
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  const pageId = randomUUID();
  const panelId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Story autofill fence')", [workId, userId, organizationId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query("INSERT INTO episodes(id,chapter_id,\"order\",estimated_pages,introduction) VALUES($1,$2,1,1,'initial source')", [episodeId, chapterId]);
  await pool.query("INSERT INTO pages(id,episode_id,page_number,status,dialogue_mode) VALUES($1,$2,1,'editing','image_baked')", [pageId, episodeId]);
  await pool.query("INSERT INTO panels(id,page_id,\"order\",situation_text) VALUES($1,$2,1,'initial')", [panelId, pageId]);
  await pool.query(
    'INSERT INTO panel_frames(page_id,panel_id,vertices,reading_order) VALUES($1,$2,$3::jsonb,1)',
    [pageId, panelId, JSON.stringify(vertices())],
  );
  return { userId, organizationId, workId, episodeId, pageId, panelId };
}

async function insertOrganizationFixture(pool: Pool): Promise<Fixture> {
  const userId = await insertUser(pool);
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Story autofill org',$2)", [organizationId, userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')", [organizationId, userId]);
  return insertFixture(pool, userId, organizationId);
}

async function insertUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, `identity-${userId}`, `${userId}@example.invalid`]);
  return userId;
}

async function insertDeletionRequest(pool: Pool, userId: string, status: 'blocked' | 'processing' | 'pending_external_action' | 'completed'): Promise<void> {
  await pool.query(`INSERT INTO account_deletion_requests(user_id,identity_id,status,completed_at)
    VALUES($1,$2,$3,CASE WHEN $3='completed' THEN NOW() ELSE NULL END)`, [userId, `identity-${userId}`, status]);
}

async function readFingerprint(pool: Pool, fixture: Fixture): Promise<string> {
  let fingerprint = '';
  await new PostgresEpisodePlanPersistenceRepository(testDatabase(pool), 'legacy_2debe_v1').withLockedEpisodePlan(
    { episodeId: fixture.episodeId, userId: fixture.userId, organizationId: fixture.organizationId },
    async (context) => { fingerprint = fingerprintEpisodePlanningContext(context); },
  );
  return fingerprint;
}

async function expectUnchanged(pool: Pool, fixture: Fixture, jobId: string, expectedStatus = 'processing'): Promise<void> {
  expect(await readDialogueMode(pool, fixture.pageId)).toBe('image_baked');
  expect(await readJob(pool, jobId)).toMatchObject({ status: expectedStatus, commit_started_at: null });
  expect(await notificationCount(pool, jobId)).toBe(0);
}

async function readDialogueMode(pool: Pool, pageId: string): Promise<string | null> {
  return (await pool.query<{ dialogue_mode: string }>('SELECT dialogue_mode FROM pages WHERE id=$1', [pageId])).rows[0]?.dialogue_mode ?? null;
}

async function readJob(pool: Pool, jobId: string): Promise<Record<string, unknown>> {
  return (await pool.query('SELECT status,commit_started_at,result FROM generation_jobs WHERE id=$1', [jobId])).rows[0] ?? {};
}

async function notificationCount(pool: Pool, jobId: string): Promise<number> {
  return (await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM mobile_push_notification_outbox WHERE generation_job_id=$1', [jobId])).rows[0]?.count ?? 0;
}

class TrackingDatabase implements DatabaseClient, TransactionRunner {
  public baseQueriesDuringTransaction = 0;
  public transactionCount = 0;
  public readonly transactionQueries: string[] = [];
  private inTransaction = false;
  public constructor(private readonly pool: Pool, private readonly transformSql: (sql: string) => string = (sql) => sql) {}
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
      const result = await work({ query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        this.transactionQueries.push(text);
        return client.query<Row>(this.transformSql(text), values === undefined ? undefined : [...values]);
      } });
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
      const result = await work(transactionClient);
      await this.client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  public async close(): Promise<void> { this.client.release(); }
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
      pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work({ query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
          client.query<Row>(text, values === undefined ? undefined : [...values]) });
        await client.query('COMMIT');
        return value;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try { return { ok: true, value: await promise }; } catch (error: unknown) { return { ok: false, error }; }
}

async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = (await pool.query<{ blocked: boolean }>(
      'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not become blocked`);
}

async function waitForBlockedOrSettled(pool: Pool, pid: number, isSettled: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (isSettled()) return;
    const blocked = (await pool.query<{ blocked: boolean }>(
      'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Commit did not reach graph contention');
}

function vertices(): Array<{ x: number; y: number }> {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
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
