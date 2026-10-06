import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { PostgresPanelRepository } from '../../src/repositories/PanelRepository.js';
import { PostgresPanelFrameRepository } from '../../src/repositories/PanelFrameRepository.js';
import { PostgresPanelEntityAssignmentRepository } from '../../src/repositories/PanelEntityAssignmentRepository.js';
import { PostgresOrganizationRepository } from '../../src/repositories/OrganizationRepository.js';
import type { GenerationJob } from '../../src/domain/types/job.js';
import type { PageSkeletonPageDraft } from '../../src/domain/types/storyAi.js';
import type { PageSkeletonPreparation } from '../../src/services/story/PageSkeletonService.js';
import { fingerprintPageSkeletonContext } from '../../src/domain/pageSkeletonFingerprint.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');
// Spec 5/11: provider/validation precede this transaction. Legacy admission,
// attempt CAS, saved-source check, bound children and terminal trigger are atomic.
// Canonical SQL and rollbackFreshPageSkeleton compensation are unchanged.
describePostgres('legacy skeleton atomic commit fence', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `legacy_skeleton_commit_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public -c statement_timeout=10000`, max: 16 });
    expect(await withPostgresTestMigrationLock(admin, () => runPendingMigrations(testDatabase(pool), { migrationsDir: LEGACY_MIGRATIONS }))).toHaveLength(38);
  }, 120_000);
  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 120_000);

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    '同期fallbackも退会状態%sでは既存skeletonを変更しない', async (status) => {
      const fixture = await insertFixture(pool);
      await insertDeletionRequest(pool, fixture.userId, status);
      const db = testDatabase(pool);
      const outcome = await settle(new PostgresStoryRepository(db, db, 'legacy_2debe_v1')
        .createPageSkeleton(fixture.episodeId, fixture.userId, draft(), { overwriteExisting: true }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'FORBIDDEN' });
      expect(await readSituation(pool, fixture.panelId)).toBe('initial');
    },
  );

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    'queued確定も退会状態%sではgraphとmarkerと通知を残さない', async (status) => {
      const fixture = await insertFixture(pool);
      const { job, preparation } = await prepareFixture(pool, fixture);
      await insertDeletionRequest(pool, fixture.userId, status);
      const db = new TrackingDatabase(pool);
      const outcome = await settle(new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
        .commitPreparedEpisodePageSkeleton(job, preparation));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'FORBIDDEN' });
      expect(db.transactionQueries.some((sql) => sql.includes('FOR UPDATE OF works'))).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    },
  );

  it('old38かつmax1で内容とcompletedと旧通知1件を同一TXに確定する', async () => {
    const fixture = await insertFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const single = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 1, connectionTimeoutMillis: 500 });
    try {
      const db = new TrackingDatabase(single);
      const repository = new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1');
      expect(await repository.commitPreparedEpisodePageSkeleton(job, preparation)).toEqual({ pagesCreated: 1, panelsCreated: 1, replacedExisting: true });
      expect(db.transactionCount).toBe(1);
      expect(db.baseQueriesDuringTransaction).toBe(0);
      const queries = db.transactionQueries;
      const user = queries.findIndex((sql) => sql.includes('FROM users') && sql.includes('FOR UPDATE'));
      const request = queries.findIndex((sql) => sql.includes('account_deletion_requests'));
      const registry = queries.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
      const jobLock = queries.findIndex((sql) => sql.includes('generation_jobs') && sql.includes('FOR UPDATE'));
      const graph = queries.findIndex((sql) => sql.includes('FOR UPDATE OF works'));
      expect(user).toBeGreaterThanOrEqual(0);
      expect(request).toBeGreaterThan(user);
      expect(registry).toBeGreaterThan(request);
      expect(jobLock).toBeGreaterThan(registry);
      expect(graph).toBeGreaterThan(jobLock);
      expect((await pool.query('SELECT status,commit_started_at FROM generation_jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ status: 'completed', commit_started_at: expect.any(Date) });
      expect(await notificationCount(pool, job.id)).toBe(1);
      expect(await readSituation(pool, fixture.panelId)).toBeNull();
      expect((await pool.query('SELECT p.situation_text FROM panels p JOIN pages g ON g.id=p.page_id WHERE g.episode_id=$1', [fixture.episodeId])).rows[0]?.situation_text).toBe('new skeleton');
      const replay = await settle(repository.commitPreparedEpisodePageSkeleton(job, preparation));
      expect(replay.ok).toBe(false);
      expect(await notificationCount(pool, job.id)).toBe(1);
    } finally { await single.end(); }
  });

  it.each(['fake organization', 'foreign actor', 'episode substitution', 'actual resource organization'] as const)(
    '%sではjobと保存先scopeを再照合して変更を残さない', async (kind) => {
      const fixture = await insertFixture(pool);
      const { job, preparation } = await prepareFixture(pool, fixture);
      if (kind === 'fake organization') {
        job.organizationId = randomUUID(); preparation.organizationId = job.organizationId;
      } else if (kind === 'foreign actor') {
        job.userId = await insertUser(pool); preparation.userId = job.userId;
      } else if (kind === 'episode substitution') {
        preparation.episodeId = (await insertFixture(pool, fixture.userId)).episodeId;
      } else {
        const org = await insertOrganizationFixture(pool);
        await pool.query('UPDATE works SET organization_id=$2 WHERE id=$1', [fixture.workId, org.organizationId]);
      }
      const outcome = await settle(new PostgresEpisodePageSkeletonExecutionRepository(testDatabase(pool), 'legacy_2debe_v1')
        .commitPreparedEpisodePageSkeleton(job, preparation));
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
    },
  );

  it('active organizationは個人退会中でも正しいresource scopeでのみ確定する', async () => {
    const fixture = await insertOrganizationFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    expect(await new PostgresEpisodePageSkeletonExecutionRepository(testDatabase(pool), 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation)).toMatchObject({ pagesCreated: 1 });
    expect(await notificationCount(pool, job.id)).toBe(1);
  });

  it.each(['source', 'cancel', 'retry', 'started', 'params', 'membership'] as const)(
    '%s変更後の古い準備は内容marker通知を残さない', async (kind) => {
      const fixture = kind === 'membership' ? await insertOrganizationFixture(pool) : await insertFixture(pool);
      const { job, preparation } = await prepareFixture(pool, fixture);
      if (kind === 'source') await pool.query("UPDATE episodes SET introduction='edited meanwhile' WHERE id=$1", [fixture.episodeId]);
      if (kind === 'cancel') await new PostgresGenerationJobRepository(testDatabase(pool), 'legacy_2debe_v1').requestCancellation(job.id, job.userId);
      if (kind === 'retry') await pool.query('UPDATE generation_jobs SET retry_count=retry_count+1 WHERE id=$1', [job.id]);
      if (kind === 'started') await pool.query("UPDATE generation_jobs SET started_at=started_at+interval '1 second' WHERE id=$1", [job.id]);
      if (kind === 'params') await pool.query(`UPDATE generation_jobs SET params=params || '{"language":"en"}'::jsonb WHERE id=$1`, [job.id]);
      if (kind === 'membership') await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [fixture.organizationId, job.userId]);
      const repository = new PostgresEpisodePageSkeletonExecutionRepository(testDatabase(pool), 'legacy_2debe_v1');
      const outcome = await settle(repository.commitPreparedEpisodePageSkeleton(job, preparation));
      expect(outcome.ok).toBe(false);
      await expectUnchanged(pool, fixture, job.id);
      if (kind === 'retry' || kind === 'started' || kind === 'params') {
        expect(await repository.settleEpisodePageSkeletonAttempt(job, 'old worker failed')).toBe('lost');
        await expectUnchanged(pool, fixture, job.id);
      }
      if (kind === 'cancel') {
        expect(await repository.settleEpisodePageSkeletonAttempt(job, 'cancel wins')).toBe('cancelled');
        expect(await notificationCount(pool, job.id)).toBe(0);
      }
    },
  );

  it.each(['child', 'terminal CAS'] as const)('%s失敗時は既存graphとmarkerと通知を全rollbackする', async (kind) => {
    const fixture = await insertFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const db = new TrackingDatabase(pool, (sql) => kind === 'child'
      ? sql.replace('INSERT INTO panels (', 'INSERT INTO missing_skeleton_test_table (')
      : sql.replace('AND commit_started_at IS NOT NULL', 'AND FALSE'));
    const outcome = await settle(new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation));
    expect(outcome.ok).toBe(false);
    await expectUnchanged(pool, fixture, job.id);
  });

  it.each(['Page settings', 'Panel content'] as const)(
    '準備後の通常%s編集はページ数不変でもoverwriteで消さずsource conflictにする', async (kind) => {
      const fixture = await insertFixture(pool);
      const { job, preparation } = await prepareFixture(pool, fixture);
      const db = testDatabase(pool);
      if (kind === 'Page settings') {
        expect(await new PostgresPageRepository(db, 'legacy_2debe_v1').updatePageSettings(fixture.pageId, fixture.userId,
          { storyPagePurpose: 'user edited purpose', pageDialogueToggle: false })).not.toBeNull();
      } else {
        expect(await new PostgresPanelRepository(db, 'legacy_2debe_v1').updatePanel(fixture.panelId, fixture.userId,
          { situationText: 'user edited panel' })).not.toBeNull();
      }
      const edited = await readSavedGraph(pool, fixture.episodeId);
      const outcome = await settle(new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
        .commitPreparedEpisodePageSkeleton(job, preparation));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'CONFLICT' });
      expect(await readSavedGraph(pool, fixture.episodeId)).toEqual(edited);
      expect((await pool.query('SELECT commit_started_at FROM generation_jobs WHERE id=$1', [job.id])).rows[0]?.commit_started_at).toBeNull();
      expect(await notificationCount(pool, job.id)).toBe(0);
    },
  );

  it.each(['Page image', 'Frame', 'Assignment', 'Balloon', 'Entity reference', 'Entity state', 'Entity speech', 'Scene state'] as const)(
    '%sだけの変更も既存graphを保護しopaque fingerprintの競合として拒否する', async (kind) => {
      const fixture = await insertFixture(pool);
      const entityId = randomUUID();
      const stateId = randomUUID();
      const sceneId = randomUUID();
      await pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'fixture entity')", [entityId, fixture.workId, fixture.userId]);
      await pool.query("INSERT INTO reference_sets(entity_id,reference_images) VALUES($1,'[]')", [entityId]);
      await pool.query('INSERT INTO scenes(id,episode_id,"order") VALUES($1,$2,1)', [sceneId, fixture.episodeId]);
      await pool.query('INSERT INTO entity_states(id,entity_id,scene_id) VALUES($1,$2,$3)', [stateId, entityId, sceneId]);
      await pool.query(`INSERT INTO balloons(page_id,text,position) VALUES($1,'original','{"x":0,"y":0}')`, [fixture.pageId]);
      const { job, preparation } = await prepareFixture(pool, fixture);
      const db = testDatabase(pool);
      if (kind === 'Page image') {
        expect(await new PostgresPageRepository(db, 'legacy_2debe_v1').updateGeneratedImageAndState(fixture.pageId, fixture.userId,
          { status: 'generated', generationMode: 'standard', generatedImage: { s3Key: 'fixture/latest.png', cdnUrl: null, generationMode: 'standard', generatedAt: new Date().toISOString() } })).toBe(true);
      } else if (kind === 'Frame') {
        const frames = new PostgresPanelFrameRepository(db, 'legacy_2debe_v1');
        const existing = await frames.findFramesByPageIdAndUserId(fixture.pageId, fixture.userId);
        expect(await frames.replaceFramesByPageIdAndUserId(fixture.pageId, fixture.userId, existing.map((frame) => ({ ...frame, borderWidth: 7 })))).toHaveLength(1);
      } else if (kind === 'Assignment') {
        expect(await new PostgresPanelEntityAssignmentRepository(db, 'legacy_2debe_v1').updatePanelEntityAssignments(
          fixture.panelId, fixture.userId, [{ entityId, stateId, role: 'primary', expression: 'calm', customExpression: null,
            action: 'standing_firm', customAction: null, position: 'center', facingDirection: 'front', effectNote: null }])).toHaveLength(1);
      } else if (kind === 'Balloon') {
        await pool.query("UPDATE balloons SET text='user edited dialogue' WHERE page_id=$1", [fixture.pageId]);
      } else if (kind === 'Entity reference') {
        await pool.query(`UPDATE reference_sets SET reference_images='[{"id":"fixture-ref","s3_key":"fixture/latest.png"}]',primary_ref_id='fixture-ref' WHERE entity_id=$1`, [entityId]);
      } else if (kind === 'Entity state') {
        await pool.query("UPDATE entity_states SET costume_note='user edited costume' WHERE id=$1", [stateId]);
      } else if (kind === 'Entity speech') {
        await pool.query(`UPDATE entities SET speech_profile='{"tone":"user edited"}' WHERE id=$1`, [entityId]);
      } else {
        await pool.query('UPDATE scenes SET entity_states=$2::jsonb WHERE id=$1', [sceneId, JSON.stringify([{ entity_id: entityId, state_id: stateId }])]);
      }
      const edited = await readSavedGraph(pool, fixture.episodeId);
      const outcome = await settle(new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
        .commitPreparedEpisodePageSkeleton(job, preparation));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'CONFLICT' });
      expect(await readSavedGraph(pool, fixture.episodeId)).toEqual(edited);
      expect((await pool.query('SELECT commit_started_at FROM generation_jobs WHERE id=$1', [job.id])).rows[0]?.commit_started_at).toBeNull();
      expect(await notificationCount(pool, job.id)).toBe(0);
    },
  );

  it('退会admission後でも同一attempt失敗settlementと既存fresh補償は利用できる', async () => {
    const fixture = await insertFixture(pool);
    const { job } = await prepareFixture(pool, fixture);
    const db = testDatabase(pool);
    const story = new PostgresStoryRepository(db, db, 'legacy_2debe_v1');
    await story.createPageSkeleton(fixture.episodeId, fixture.userId, draft(), { overwriteExisting: true });
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(testDatabase(pool), 'legacy_2debe_v1');
    expect(await repository.settleEpisodePageSkeletonAttempt(job, 'provider failed')).toBe('failed');
    expect(await repository.settleEpisodePageSkeletonAttempt(job, 'duplicate failure')).toBe('lost');
    expect(await notificationCount(pool, job.id)).toBe(1);
    expect(await story.rollbackFreshPageSkeleton(fixture.episodeId, fixture.userId, 1)).toBe(true);
  });

  it.each(['claim first', 'commit first'] as const)('%sは実user lockで待機しfresh flightとatomic確定を直列化する', async (order) => {
    const fixture = await insertFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const gate = deferred<void>();
    const acquired = deferred<void>();
    const first = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('account_deletion_requests') && sql.includes('FOR UPDATE')) {
        acquired.resolve();
        await gate.promise;
      }
    });
    const second = await PinnedDatabase.connect(pool);
    const writer = (database: PinnedDatabase) => new PostgresEpisodePageSkeletonExecutionRepository(database, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation);
    const claimant = (database: PinnedDatabase) => new PostgresLegacyAccountDeletionRepository(database, database)
      .claimRequest({ ...claimInput(job.userId), acknowledgePersonalAssets: true });
    try {
      if (order === 'claim first') {
        const claim = settle(claimant(first));
        await waitForSignal(acquired.promise, 'claim user/request lock');
        const commit = settle(writer(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        expect(await claim).toMatchObject({ ok: true, value: { kind: 'blocked' } });
        expect(await commit).toMatchObject({ ok: true, value: { pagesCreated: 1 } });
      } else {
        const commit = settle(writer(first));
        await waitForSignal(acquired.promise, 'commit user/request lock');
        const claim = settle(claimant(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        expect(await commit).toMatchObject({ ok: true, value: { pagesCreated: 1 } });
        expect(await claim).toMatchObject({ ok: true, value: { kind: 'claimed' } });
      }
      expect(await notificationCount(pool, job.id)).toBe(1);
    } finally {
      gate.resolve();
      await first.close(); await second.close();
    }
  });

  it.each(['cancel first', 'commit first'] as const)('%sは実job lockで待機しcancelとcompletedの片方だけを確定する', async (order) => {
    const fixture = await insertFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const gate = deferred<void>();
    const acquired = deferred<void>();
    const first = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes(order === 'cancel first' ? 'SET cancel_requested_at =' : 'SET commit_started_at =')) {
        acquired.resolve();
        await gate.promise;
      }
    });
    const second = await PinnedDatabase.connect(pool);
    const writer = (database: PinnedDatabase) => new PostgresEpisodePageSkeletonExecutionRepository(database, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation);
    const cancel = (database: PinnedDatabase) => database.transaction(async (client) =>
      new PostgresGenerationJobRepository(client, 'legacy_2debe_v1').requestCancellation(job.id, job.userId));
    try {
      if (order === 'cancel first') {
        const cancellation = settle(cancel(first));
        await waitForSignal(acquired.promise, 'cancel job update');
        const commit = settle(writer(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        expect(await cancellation).toMatchObject({ ok: true, value: { status: 'processing' } });
        expect(await commit).toMatchObject({ ok: false });
        await expectUnchanged(pool, fixture, job.id);
        expect(await new PostgresEpisodePageSkeletonExecutionRepository(testDatabase(pool), 'legacy_2debe_v1')
          .settleEpisodePageSkeletonAttempt(job)).toBe('cancelled');
      } else {
        const commit = settle(writer(first));
        await waitForSignal(acquired.promise, 'commit job CAS');
        const cancellation = settle(cancel(second));
        await waitForBlockedQuery(pool, second.pid);
        gate.resolve();
        expect(await commit).toMatchObject({ ok: true, value: { pagesCreated: 1 } });
        expect(await cancellation).toEqual({ ok: true, value: null });
        expect(await notificationCount(pool, job.id)).toBe(1);
      }
    } finally {
      gate.resolve();
      await first.close(); await second.close();
    }
  });

  it.each([
    ['commit first', true], ['removal first', true],
    ['commit first', false], ['removal first', false],
  ] as const)('%s・organization lock=%sはactive membershipの失効とSkeleton確定を直列化する', async (order, lockOrganization) => {
    const fixture = await insertOrganizationFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const memberId = (await pool.query<{ id: string }>('SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2', [fixture.organizationId, fixture.userId])).rows[0]?.id;
    if (memberId === undefined) throw new Error('Missing fixture member');
    const gate = deferred<void>();
    const acquired = deferred<void>();
    const first = await PinnedDatabase.connect(pool, async (sql) => {
      const stop = order === 'commit first'
        ? sql.includes('SELECT episodes.id,') && sql.includes('existing_page_count') && sql.includes('FOR UPDATE')
        : sql.includes('UPDATE organization_members');
      if (stop) { acquired.resolve(); await gate.promise; }
    });
    const second = await PinnedDatabase.connect(pool);
    const commit = (db: PinnedDatabase) => new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation);
    const remove = (db: PinnedDatabase) => db.transaction(async (client) => {
      const organization = new PostgresOrganizationRepository(db, db);
      // Same lock path as OrganizationService.updateMember/removeMember.
      if (lockOrganization) await organization.findOrganizationById(fixture.organizationId, client, true);
      return organization.updateMember(fixture.organizationId, memberId, { status: 'removed' }, client);
    });
    let firstResult: Promise<unknown> | undefined;
    let secondResult: Promise<unknown> | undefined;
    try {
      firstResult = settle<unknown>(order === 'commit first' ? commit(first) : remove(first));
      await waitForSignal(acquired.promise, 'membership/last ownership statement');
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
      const settledFirst = await firstResult;
      const settledSecond = await secondResult;
      console.info('skeleton_membership_controlled_race', { order, lockOrganization, first: outcomeKind(settledFirst), second: outcomeKind(settledSecond), secondCode: outcomeErrorCode(settledSecond),
        notificationCount: await notificationCount(pool, job.id) });
      await first.close(); await second.close();
    }
  }, 10_000);

  it.each([
    ['commit first', true, 'viewer'], ['removal first', true, 'viewer'],
    ['commit first', false, 'viewer'], ['removal first', false, 'viewer'],
    ['commit first', true, 'billing'], ['removal first', true, 'billing'],
    ['commit first', false, 'billing'], ['removal first', false, 'billing'],
  ] as const)('%s・organization lock=%s・role=%sの場合は編集権限失効とSkeleton確定を直列化する', async (order, lockOrganization, role) => {
    const fixture = await insertOrganizationFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const originalJob = (await pool.query('SELECT status, result FROM generation_jobs WHERE id=$1', [job.id])).rows[0];
    const memberId = (await pool.query<{ id: string }>('SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2', [fixture.organizationId, fixture.userId])).rows[0]?.id;
    if (memberId === undefined) throw new Error('Missing fixture member');
    const gate = deferred<void>();
    const acquired = deferred<void>();
    const first = await PinnedDatabase.connect(pool, async (sql) => {
      const stop = order === 'commit first'
        ? sql.includes('SELECT episodes.id,') && sql.includes('existing_page_count') && sql.includes('FOR UPDATE')
        : sql.includes('UPDATE organization_members');
      if (stop) { acquired.resolve(); await gate.promise; }
    });
    const second = await PinnedDatabase.connect(pool);
    const commit = (db: PinnedDatabase) => new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation);
    const remove = (db: PinnedDatabase) => db.transaction(async (client) => {
      const organization = new PostgresOrganizationRepository(db, db);
      // Same lock path as OrganizationService.updateMember/removeMember.
      if (lockOrganization) await organization.findOrganizationById(fixture.organizationId, client, true);
      return organization.updateMember(fixture.organizationId, memberId, { role }, client);
    });
    let firstResult: Promise<unknown> | undefined;
    let secondResult: Promise<unknown> | undefined;
    try {
      firstResult = settle<unknown>(order === 'commit first' ? commit(first) : remove(first));
      await waitForSignal(acquired.promise, 'membership/last ownership statement');
      secondResult = settle<unknown>(order === 'commit first' ? remove(second) : commit(second));
      await waitForBlockedQuery(pool, second.pid);
      gate.resolve();
      if (order === 'commit first') {
        expect(await firstResult).toMatchObject({ ok: true });
        expect(await secondResult).toMatchObject({ ok: true, value: { role } });
        expect(await notificationCount(pool, job.id)).toBe(1);
      } else {
        expect(await firstResult).toMatchObject({ ok: true, value: { role } });
        expect(await secondResult).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
        await expectUnchanged(pool, fixture, job.id);
        expect((await pool.query('SELECT status, result FROM generation_jobs WHERE id=$1', [job.id])).rows[0]).toEqual(originalJob);
      }
    } finally {
      gate.resolve();
      const settledFirst = await firstResult;
      const settledSecond = await secondResult;
      console.info('skeleton_role_controlled_race', { order, lockOrganization, role, first: outcomeKind(settledFirst), second: outcomeKind(settledSecond), secondCode: outcomeErrorCode(settledSecond),
        notificationCount: await notificationCount(pool, job.id) });
      await first.close(); await second.close();
    }
  }, 10_000);

  it.each(['Frame replace', 'Panel delete'] as const)(
    'org %sがFrameを先行lockしても40P01を起こさずSkeleton全rollbackで通常編集を保存する', async (kind) => {
      const fixture = await insertOrganizationFixture(pool);
      const { job, preparation } = await prepareFixture(pool, fixture);
      const frames = await new PostgresPanelFrameRepository(testDatabase(pool), 'legacy_2debe_v1')
        .findFramesByPageIdAndUserId(fixture.pageId, fixture.userId, fixture.organizationId);
      const gate = deferred<void>();
      const acquired = deferred<void>();
      const editor = await PinnedDatabase.connect(pool, async (sql) => {
        if (sql.includes(kind === 'Frame replace' ? 'DELETE FROM panel_frames' : 'UPDATE panel_frames')) {
          acquired.resolve(); await gate.promise;
        }
      });
      const committer = await PinnedDatabase.connect(pool);
      const edit = settle<unknown>(kind === 'Frame replace'
        ? new PostgresPanelFrameRepository(editor, 'legacy_2debe_v1')
          .replaceFramesByPageIdAndUserId(fixture.pageId, fixture.userId, frames.map((frame) => ({ ...frame, borderWidth: 7 })), undefined, fixture.organizationId)
        : new PostgresPanelRepository(editor, 'legacy_2debe_v1').deletePanel(fixture.panelId, fixture.userId, fixture.organizationId));
      let commit: ReturnType<typeof settle> | undefined;
      let commitSettled = false;
      try {
        await waitForSignal(acquired.promise, 'normal editor frame lock');
        commit = settle(new PostgresEpisodePageSkeletonExecutionRepository(committer, 'legacy_2debe_v1')
          .commitPreparedEpisodePageSkeleton(job, preparation));
        void commit.then(() => { commitSettled = true; });
        await waitForBlockedOrSettled(pool, committer.pid, () => commitSettled);
        gate.resolve();
        const edited = await edit;
        const committed = await commit;
        console.info('skeleton_org_controlled_lock_race', { kind, editOk: edited.ok, commitOk: committed.ok,
          editCode: edited.ok ? null : errorCode(edited.error), commitCode: committed.ok ? null : errorCode(committed.error) });
        expect(edited.ok).toBe(true);
        expect(committed.ok).toBe(false);
        if (!committed.ok) expect(committed.error).toMatchObject({ code: 'CONFLICT' });
        expect((await pool.query('SELECT commit_started_at FROM generation_jobs WHERE id=$1', [job.id])).rows[0]?.commit_started_at).toBeNull();
        expect(await notificationCount(pool, job.id)).toBe(0);
        if (kind === 'Frame replace') {
          expect((await pool.query('SELECT border_width FROM panel_frames WHERE page_id=$1', [fixture.pageId])).rows[0]?.border_width).toBe(7);
          expect(await readSituation(pool, fixture.panelId)).toBe('initial');
        } else {
          expect(await readSituation(pool, fixture.panelId)).toBeNull();
          expect((await pool.query('SELECT panel_id FROM panel_frames WHERE page_id=$1', [fixture.pageId])).rows[0]?.panel_id).toBeNull();
        }
      } finally {
        gate.resolve();
        await edit; await commit;
        await editor.close(); await committer.close();
      }
    }, 10_000,
  );

  it.each(['commit first', 'anonymize first'] as const)('%sでもusers→membership順を保ちorg確定と退会匿名化のcycleを作らない', async (order) => {
    const fixture = await insertOrganizationFixture(pool);
    const { job, preparation } = await prepareFixture(pool, fixture);
    const token = randomUUID();
    await insertDeletionRequest(pool, fixture.userId, 'processing');
    await pool.query('UPDATE account_deletion_requests SET processing_token=$2,processing_started_at=NOW() WHERE user_id=$1', [fixture.userId, token]);
    const gate = deferred<void>();
    const acquired = deferred<void>();
    const first = await PinnedDatabase.connect(pool, async (sql) => {
      const stop = order === 'commit first'
        ? sql.includes('SELECT episodes.id,') && sql.includes('existing_page_count') && sql.includes('FOR UPDATE')
        : sql.includes('DELETE FROM organization_members');
      if (stop) { acquired.resolve(); await gate.promise; }
    });
    const second = await PinnedDatabase.connect(pool);
    const commit = (db: PinnedDatabase) => new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1')
      .commitPreparedEpisodePageSkeleton(job, preparation);
    const anonymize = (db: PinnedDatabase) => new PostgresLegacyAccountDeletionRepository(db, db)
      .anonymizePersonalData(fixture.userId, token);
    let firstResult: Promise<unknown> | undefined;
    let secondResult: Promise<unknown> | undefined;
    try {
      firstResult = settle<unknown>(order === 'commit first' ? commit(first) : anonymize(first));
      await waitForSignal(acquired.promise, 'anonymize/user membership lock');
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
      expect((await pool.query('SELECT status FROM organization_members WHERE organization_id=$1 AND user_id=$2', [fixture.organizationId, fixture.userId])).rowCount).toBe(0);
    } finally {
      gate.resolve();
      await firstResult; await secondResult;
      await first.close(); await second.close();
    }
  }, 10_000);
});

function draft(): PageSkeletonPageDraft[] {
  return [{ pageNumber: 1, purpose: 'setup', suggestedLayout: 'splash_1', suggestedPanelCount: 1, panels: [
    { order: 1, panelRole: 'establish', suggestedSize: 'splash', situationHint: 'new skeleton', suggestedEntities: [], suggestedDialogueHint: '' },
  ] }];
}

async function prepareFixture(pool: Pool, fixture: Fixture): Promise<{ job: GenerationJob; preparation: PageSkeletonPreparation }> {
  const jobId = randomUUID();
  await pool.query(`INSERT INTO generation_jobs(id,user_id,organization_id,job_type,status,credit_cost,params)
    VALUES($1,$2,$3,'episode_page_skeleton','queued',0,$4::jsonb)`,
    [jobId, fixture.userId, fixture.organizationId, JSON.stringify({ episode_id: fixture.episodeId, language: 'ja', overwrite_existing: true })]);
  const db = testDatabase(pool);
  const job = await new PostgresEpisodePageSkeletonExecutionRepository(db, 'legacy_2debe_v1').claimQueuedEpisodePageSkeletonJob(jobId);
  const context = await new PostgresStoryRepository(db, db, 'legacy_2debe_v1')
    .findEpisodePageSkeletonContextByIdAndUserId(fixture.episodeId, fixture.userId, fixture.organizationId);
  if (job === null || context === null) throw new Error('Missing skeleton fixture');
  return { job, preparation: { userId: fixture.userId, organizationId: fixture.organizationId, episodeId: fixture.episodeId,
    overwriteExisting: true, pages: draft(), sourceFingerprint: fingerprintPageSkeletonContext(context) } };
}

async function notificationCount(pool: Pool, jobId: string): Promise<number> {
  return (await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM mobile_push_notification_outbox WHERE generation_job_id=$1', [jobId])).rows[0]?.count ?? 0;
}

async function readSavedGraph(pool: Pool, episodeId: string): Promise<string> {
  const rows = (await pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM pages p WHERE p.episode_id=$1) AS pages,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM panels p JOIN pages g ON g.id=p.page_id WHERE g.episode_id=$1) AS panels,
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM panel_frames f JOIN pages g ON g.id=f.page_id WHERE g.episode_id=$1) AS frames,
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM balloons b JOIN pages g ON g.id=b.page_id WHERE g.episode_id=$1) AS balloons,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM scenes s WHERE s.episode_id=$1) AS scenes,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM entities e WHERE e.work_id=c.work_id) AS entities,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM reference_sets r JOIN entities e ON e.id=r.entity_id WHERE e.work_id=c.work_id) AS refs,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM entity_states s JOIN entities e ON e.id=s.entity_id WHERE e.work_id=c.work_id) AS states
    FROM episodes ep JOIN chapters c ON c.id=ep.chapter_id WHERE ep.id=$1`, [episodeId])).rows;
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function expectUnchanged(pool: Pool, fixture: Fixture, jobId: string): Promise<void> {
  expect(await readSituation(pool, fixture.panelId)).toBe('initial');
  expect((await pool.query('SELECT page_skeleton_generated FROM episodes WHERE id=$1', [fixture.episodeId])).rows[0]?.page_skeleton_generated).toBe(false);
  expect((await pool.query('SELECT commit_started_at FROM generation_jobs WHERE id=$1', [jobId])).rows[0]?.commit_started_at).toBeNull();
  expect(await notificationCount(pool, jobId)).toBe(0);
}
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
      const result = await work({
        query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
          this.transactionQueries.push(text);
          return client.query<Row>(this.transformSql(text), values === undefined ? undefined : [...values]);
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

async function waitForBlockedOrSettled(pool: Pool, pid: number, isSettled: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (isSettled()) return;
    const result = await pool.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
    if (result.rows[0]?.blocked === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Commit did not reach graph contention');
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
}

function outcomeKind(outcome: unknown): string {
  return typeof outcome === 'object' && outcome !== null && 'ok' in outcome && outcome.ok === true ? 'ok' : 'rejected';
}

function outcomeErrorCode(outcome: unknown): unknown {
  return typeof outcome === 'object' && outcome !== null && 'error' in outcome ? errorCode(outcome.error) : null;
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
