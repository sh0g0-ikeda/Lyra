import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresSceneRepository } from '../../src/repositories/SceneRepository.js';
import { presentEntityStateReference } from '../../src/services/entity/EntityStatePresentation.js';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import { PostgresEntityRepository } from '../../src/repositories/EntityRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../../src/repositories/PageGenerationExecutionRepository.js';
import { PostgresImageStorageReferenceRepository } from '../../src/repositories/ImageStorageReferenceRepository.js';
import { AccountDeletionService } from '../../src/services/account/AccountDeletionService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('entity state image retention', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `entity_state_retention_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schemaName);
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    pool = createPool(schemaName);
    const applied = await withPostgresTestMigrationLock(adminPool, () => runPendingMigrations(
      new PoolTransactionDatabase(pool),
      { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 },
    ));
    expect(applied).toContain('046_bridge_production_schema_lineage.sql');
    expect(applied.at(-1)).toBe('047_add_state_reference_copy_attempts.sql');
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

  it('一覧と更新の状態画像metadataは現在のbaseと内容でfreshnessを再検証する', async () => {
    const ids = createFixtureIds();
    await insertFixture(pool, ids, { personalStateKey:'unused-personal.png', organizationStateKey:'unused-org.png', snapshotKey:'unused-snapshot.png' });
    const baseKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/base.png`;
    const stateKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/states/${ids.personalStateId}/ref.png`;
    await pool.query(`INSERT INTO reference_sets (entity_id,reference_images,primary_ref_id,status) VALUES ($1,$2::jsonb,'base','ready')`,
      [ids.personalEntityId,JSON.stringify([{ref_id:'base',s3_key:baseKey}])]);
    const descriptor={ref_id:'ref',s3_key:stateKey,storage_owner_user_id:ids.userId,image_model:'gpt-image-2',base_ref_id:'base',created_at:'2026-10-01T00:00:00Z',
      input_fingerprint:computeStateReferenceFingerprint({entityId:ids.personalEntityId,stateId:ids.personalStateId,name:'injured',description:'A cheek scar',baseRefId:'base'})};
    await pool.query('UPDATE entity_states SET reference_image=$2::jsonb WHERE id=$1',[ids.personalStateId,JSON.stringify(descriptor)]);
    const repository=new PostgresSceneRepository(new PoolTransactionDatabase(pool));
    const rows=await repository.findEntityStatesByEntityIdAndUserId(ids.personalEntityId,ids.userId);
    expect(presentEntityStateReference(rows[0]).reference_status).toBe('confirmed');
    const updated=await repository.updateEntityState(ids.personalEntityId,ids.personalStateId,ids.userId,{description:'Changed injury'});
    expect(updated).not.toBeNull();
    expect(presentEntityStateReference(updated!).reference_status).toBe('stale');
    const created=await repository.createEntityState(ids.personalEntityId,{sceneId:null,name:'wet',description:'Wet clothing',costumeNote:null,costumeRefId:null,conditionNote:null,hairNote:null,expressionDefault:'neutral',extraNote:null});
    expect(created.baseReferenceId).toBe('base');
    expect(presentEntityStateReference(created).reference_status).toBe('draft');
  });

  it('live state descriptorとinput snapshot参照をprune保護し、退会対象はpersonal state画像だけにする', async () => {
    const ids = createFixtureIds();
    const personalStateKey = `state-images/${ids.personalStateId}/personal.png`;
    const organizationStateKey = `state-images/${ids.organizationStateId}/organization.png`;
    const snapshotKey = `page-inputs/${ids.jobId}/reference.png`;
    await insertFixture(pool, ids, {
      organizationStateKey,
      personalStateKey,
      snapshotKey,
    });

    const database = new PoolTransactionDatabase(pool);
    const protectedKeys = await new PostgresImageStorageReferenceRepository(database)
      .findProtectedImageS3Keys({ protectRecentCandidateHours: 1 });
    const flight = await new PostgresAccountDeletionRepository(database, database)
      .getFlight(ids.userId);

    expect([...protectedKeys]).toEqual(expect.arrayContaining([
      personalStateKey,
      organizationStateKey,
      snapshotKey,
    ]));
    expect(flight.personalAssetKeys).toContain(personalStateKey);
    expect(flight.personalAssetKeys).not.toContain(organizationStateKey);
  });

  it('旧ページの不正な状態IDでは既定画像を維持し、存在しないUUID状態は拒否する', async () => {
    const ids = createFixtureIds();
    const baseKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/base.png`;
    await insertFixture(pool, ids, {
      organizationStateKey: `state-images/${ids.organizationStateId}/organization.png`,
      personalStateKey: `state-images/${ids.personalStateId}/personal.png`,
      snapshotKey: `page-inputs/${ids.jobId}/reference.png`,
    });
    await pool.query(
      `INSERT INTO reference_sets (entity_id, reference_images, primary_ref_id, status)
       VALUES ($1::uuid, $2::jsonb, 'base-ref', 'ready')`,
      [ids.personalEntityId, JSON.stringify([{
        ref_id: 'base-ref', s3_key: baseKey, cdn_url: 'https://img.lyra.test/base.png',
        source: 'generated', created_at: '2026-09-30T00:00:00.000Z',
      }])],
    );

    const repository = new PostgresEntityRepository(new PoolTransactionDatabase(pool));
    const missingStateId = randomUUID();
    const resolved = await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.([
      { entityId: ids.personalEntityId, stateId: 'legacy-invalid-id' },
      { entityId: ids.personalEntityId, stateId: missingStateId },
    ], ids.personalWorkId, ids.userId);

    expect(resolved?.find((row) => row.stateId === 'legacy-invalid-id')).toMatchObject({
      stateExists: true, refId: 'base-ref', s3Key: baseKey,
    });
    expect(resolved?.find((row) => row.stateId === missingStateId)).toMatchObject({
      stateExists: false, refId: null, s3Key: null,
    });
  });

  it('退会時は失われたpersonal参照も履歴から回収し、法人・他ユーザー・不正keyは削除対象にしない', async () => {
    const ids = createFixtureIds();
    await insertFixture(pool, ids, {
      organizationStateKey: `saved/${ids.userId}/entities/${ids.organizationEntityId}/current.png`,
      personalStateKey: `saved/${ids.userId}/entities/${ids.personalEntityId}/current.png`,
      snapshotKey: `page-inputs/${ids.jobId}/reference.png`,
    });
    const deletedEntityId = randomUUID();
    await pool.query(
      `INSERT INTO entities (id, work_id, user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Deleted personal character')`,
      [deletedEntityId, ids.personalWorkId, ids.userId],
    );
    await pool.query('DELETE FROM entities WHERE id = $1::uuid', [deletedEntityId]);
    const oldBaseKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/old-base.png`;
    const oldStateKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/states/${ids.personalStateId}/old-state.png`;
    const deletedEntityKey = `saved/${ids.userId}/entities/${deletedEntityId}/old-base.png`;
    const organizationKey = `saved/${ids.userId}/entities/${ids.organizationEntityId}/old-base.png`;
    const foreignOwnerKey = `saved/${randomUUID()}/entities/${ids.personalEntityId}/foreign.png`;
    const malformedKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/../foreign.png`;
    const mismatchedEntityKey = `saved/${ids.userId}/entities/${randomUUID()}/mismatched.png`;
    const organizationJobKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/organization-job.png`;
    const otherTypeJobKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/other-type-job.png`;
    const intentRefId = `${randomUUID()}-1`;
    const copyIntentKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/states/${ids.personalStateId}/${intentRefId}.png`;
    const excludedCopyIntents = [
      { organizationId: ids.organizationId, entityId: ids.personalEntityId,
        stateId: ids.personalStateId, refId: 'organization-job-copy' },
      { organizationId: null, entityId: ids.organizationEntityId,
        stateId: ids.organizationStateId, refId: 'organization-entity-copy' },
    ].map((entry) => ({
      ...entry,
      s3Key: `saved/${ids.userId}/entities/${entry.entityId}/states/${entry.stateId}/${entry.refId}.png`,
    }));
    const snapshot = (references: Array<{ entityId: string; s3Key: string }>) => ({
      input_snapshot: { references },
    });
    await pool.query(
      `UPDATE generation_jobs SET result = $2::jsonb WHERE id = $1::uuid`,
      [ids.jobId, JSON.stringify(snapshot([
        { entityId: ids.personalEntityId, s3Key: oldBaseKey },
        { entityId: ids.personalEntityId, s3Key: oldStateKey },
        { entityId: deletedEntityId, s3Key: deletedEntityKey },
        { entityId: ids.organizationEntityId, s3Key: organizationKey },
        { entityId: ids.personalEntityId, s3Key: foreignOwnerKey },
        { entityId: ids.personalEntityId, s3Key: malformedKey },
        { entityId: ids.personalEntityId, s3Key: mismatchedEntityKey },
      ]))],
    );
    await pool.query(
      `INSERT INTO generation_jobs (id, user_id, organization_id, job_type, status, credit_cost, params, result)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'page_generate', 'completed', 0, '{}'::jsonb, $4::jsonb),
              ($5::uuid, $2::uuid, NULL, 'entity_generate', 'completed', 0, $7::jsonb, $6::jsonb)`,
      [randomUUID(), ids.userId, ids.organizationId,
        JSON.stringify(snapshot([{ entityId: ids.personalEntityId, s3Key: organizationJobKey }])),
        randomUUID(), JSON.stringify({
          ...snapshot([{ entityId: ids.personalEntityId, s3Key: otherTypeJobKey }]),
          state_reference_copies: [
            { entity_id: ids.personalEntityId, state_id: ids.personalStateId,
              ref_id: intentRefId, s3_key: copyIntentKey, attempt_id: randomUUID(), state: 'succeeded' },
          ],
        }), JSON.stringify({ target: 'entity_state', entity_id: ids.personalEntityId,
          entity_state_id: ids.personalStateId })],
    );
    for (const intent of excludedCopyIntents) {
      await pool.query(
        `INSERT INTO generation_jobs (id, user_id, organization_id, job_type, status, credit_cost, params, result)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'entity_generate', 'completed', 0, $4::jsonb, $5::jsonb)`,
        [randomUUID(), ids.userId, intent.organizationId,
          JSON.stringify({ target: 'entity_state', entity_id: intent.entityId, entity_state_id: intent.stateId }),
          JSON.stringify({ state_reference_copies: [{ entity_id: intent.entityId, state_id: intent.stateId,
            ref_id: intent.refId, s3_key: intent.s3Key, attempt_id: randomUUID(), state: 'succeeded' }] })],
      );
    }

    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresAccountDeletionRepository(database, database);
    const flight = await repository.getFlight(ids.userId);
    expect(flight.personalAssetKeys).toEqual(expect.arrayContaining([
      oldBaseKey, oldStateKey, deletedEntityKey, copyIntentKey,
    ]));
    for (const key of [organizationKey, foreignOwnerKey, malformedKey,
      mismatchedEntityKey, organizationJobKey, otherTypeJobKey,
      ...excludedCopyIntents.map((intent) => intent.s3Key)]) {
      expect(flight.personalAssetKeys).not.toContain(key);
    }

    const deletedKeys: string[] = [];
    const service = new AccountDeletionService(
      repository,
      { cancelPersonalSubscription: async () => {} },
      { disableIdentity: async () => {}, deleteIdentity: async () => {} },
      { deleteExactObject: async (key) => { deletedKeys.push(key); } },
      'integration-only-identity-key-secret',
    );
    expect(await (service.requestDeletion({
      userId: ids.userId,
      identityId: `entity-state-retention-${ids.userId}`,
      confirmation: 'DELETE',
      acknowledgePersonalSubscriptions: true,
      acknowledgeStoreBilling: true,
      acknowledgePersonalAssets: true,
    }))).toEqual({ status: 'completed', blockers: [] });
    expect(deletedKeys.sort()).toEqual([...flight.personalAssetKeys].sort());
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id = $1::uuid', [ids.jobId]))
      .rows[0]?.result).toBeNull();
    expect((await pool.query('SELECT id FROM works WHERE id = $1::uuid', [ids.organizationWorkId]))
      .rowCount).toBe(1);
  });

  it('legacy・不正copy intentは削除対象keyを拡張せず退会をblockする', async () => {
    const ids = createFixtureIds();
    await insertFixture(pool, ids, {
      organizationStateKey: `saved/${ids.userId}/entities/${ids.organizationEntityId}/organization.png`,
      personalStateKey: `saved/${ids.userId}/entities/${ids.personalEntityId}/personal.png`,
      snapshotKey: 'snapshot.png',
    });
    const refId = `${randomUUID()}-1`;
    const exactKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/states/${ids.personalStateId}/${refId}.png`;
    const mismatchedKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/states/${randomUUID()}/${refId}.png`;
    const organizationKey = `saved/${ids.userId}/entities/${ids.organizationEntityId}/states/${ids.organizationStateId}/${refId}.png`;
    const jobId = randomUUID();
    const history = [
      { entity_id: ids.personalEntityId, state_id: ids.personalStateId, ref_id: refId, s3_key: exactKey },
      { entity_id: ids.personalEntityId, state_id: ids.personalStateId, ref_id: refId,
        s3_key: mismatchedKey, attempt_id: randomUUID(), state: 'succeeded' },
      { entity_id: ids.organizationEntityId, state_id: ids.organizationStateId, ref_id: refId,
        s3_key: organizationKey, attempt_id: randomUUID(), state: 'succeeded' },
    ];
    await pool.query(`INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params, result)
      VALUES ($1, $2, 'entity_generate', 'completed', 0, $3::jsonb, $4::jsonb)`,
    [jobId, ids.userId, JSON.stringify({ target: 'entity_state', entity_id: ids.personalEntityId,
      entity_state_id: ids.personalStateId }), JSON.stringify({ state_reference_copies: history })]);
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresAccountDeletionRepository(database, database);
    const flight = await repository.getFlight(ids.userId);
    expect(flight.personalAssetKeys).toContain(exactKey);
    expect(flight.personalAssetKeys).not.toContain(mismatchedKey);
    expect(flight.personalAssetKeys).not.toContain(organizationKey);
    const deleted: string[] = [];
    const service = new AccountDeletionService(repository,
      { cancelPersonalSubscription: async () => {} },
      { disableIdentity: async () => {}, deleteIdentity: async () => {} },
      { deleteExactObject: async (key) => { deleted.push(key); } },
      'integration-only-identity-key-secret');
    expect((await service.requestDeletion({
      userId: ids.userId, identityId: `entity-state-retention-${ids.userId}`, confirmation: 'DELETE',
      acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true,
    })).status).toBe('blocked');
    expect(deleted).toEqual([]);
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id = $1', [jobId]))
      .rows[0]?.result.state_reference_copies).toEqual(history);
  });

  it('画像checkpointが残る期限切れjobは保持し、欠落・null・空配列だけなら削除できる', async () => {
    const ids = createFixtureIds();
    await insertFixture(pool, ids, { organizationStateKey: 'organization.png',
      personalStateKey: 'personal.png', snapshotKey: 'snapshot.png' });
    const retainedResults = [
      { input_snapshot: { references: [{ s3Key: 'saved/image.png' }] } },
      { state_reference_copies: [{ s3_key: 'saved/copy.png' }] },
      { retained_input_references: [{ entityId: ids.personalEntityId, s3Key: 'saved/history.png' }] },
      { input_snapshot: { references: { s3Key: 'malformed-image.png' } } },
      { state_reference_copies: 'malformed-copy.png' },
      { input_snapshot: { references: false } },
      { state_reference_copies: 1 },
      { retained_input_references: { s3Key: 'malformed-history.png' } },
    ];
    const removableResults = [
      null,
      {},
      { input_snapshot: { references: null }, state_reference_copies: null, retained_input_references: null },
      { input_snapshot: { references: [] }, state_reference_copies: [], retained_input_references: [] },
    ];
    const retainedIds: string[] = [];
    const removableIds: string[] = [];
    for (const [results, recordIds] of [[retainedResults, retainedIds], [removableResults, removableIds]] as const) {
      for (const result of results) {
        const jobId = randomUUID();
        recordIds.push(jobId);
        await pool.query(
          `INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params, result, expires_at)
           VALUES ($1::uuid, $2::uuid, 'page_generate', 'completed', 0, '{}'::jsonb, $3::jsonb, NOW() - INTERVAL '8 days')`,
          [jobId, ids.userId, JSON.stringify(result)],
        );
      }
    }
    const repository = new PostgresGenerationJobRepository(new PoolTransactionDatabase(pool));
    const preview = await repository.pruneExpiredTerminalJobs({ maxDeletes: 100, dryRun: true });
    expect(preview.candidateIds.sort()).toEqual(removableIds.sort());
    const applied = await repository.pruneExpiredTerminalJobs({ maxDeletes: 100, dryRun: false });
    expect(applied.candidateIds.sort()).toEqual(removableIds.sort());
    const remaining = await pool.query('SELECT id FROM generation_jobs WHERE id = ANY($1::uuid[])', [retainedIds]);
    expect(remaining.rowCount).toBe(retainedIds.length);
  });

  it('prune候補取得後にcopy intentが増えた場合もDELETEで再確認してjobを保持する', async () => {
    const ids = createFixtureIds();
    await insertFixture(pool, ids, { organizationStateKey: 'organization.png',
      personalStateKey: 'personal.png', snapshotKey: 'snapshot.png' });
    await pool.query(`UPDATE generation_jobs SET result = '{}'::jsonb,
      expires_at = NOW() - INTERVAL '8 days' WHERE id = $1::uuid`, [ids.jobId]);
    const database = new PoolTransactionDatabase(pool);
    const repository = new PostgresGenerationJobRepository({
      async query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
        if (sql.includes('DELETE FROM generation_jobs')) {
          await pool.query(`UPDATE generation_jobs SET result = $2::jsonb WHERE id = $1::uuid`,
            [ids.jobId, JSON.stringify({ state_reference_copies: [{ s3_key: 'saved/in-flight-copy.png' }] })]);
        }
        return database.query<T>(sql, values);
      },
    });
    const applied = await repository.pruneExpiredTerminalJobs({ maxDeletes: 100, dryRun: false });
    expect(applied.candidateCount).toBe(1);
    expect(applied.deletedCount).toBe(0);
    expect((await pool.query('SELECT id FROM generation_jobs WHERE id = $1::uuid', [ids.jobId])).rowCount).toBe(1);
  });

  it('再試行でAからBへ入力が変わっても両画像の最小履歴を保持し退会で削除する', async () => {
    const ids = createFixtureIds();
    const firstKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/first.png`;
    const secondKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/second.png`;
    await insertFixture(pool, ids, { organizationStateKey: 'organization.png',
      personalStateKey: secondKey, snapshotKey: firstKey });
    await pool.query(`UPDATE generation_jobs SET status = 'processing', retry_count = 1,
      result = $2::jsonb WHERE id = $1::uuid`, [ids.jobId, JSON.stringify({
      progress_message: 'Preserve other fields',
      input_snapshot: { references: [{ entityId: ids.personalEntityId, s3Key: firstKey, subjectLabel: 'Private name' }] },
    })]);
    const database = new PoolTransactionDatabase(pool);
    const execution = new PostgresPageGenerationExecutionRepository(database);
    const snapshot = { pageId: randomUUID(), requestKind: 'initial' as const,
      generationMode: 'standard' as const, panelCount: 0, panels: [], references: [{
        entityId: ids.personalEntityId, stateId: null, refId: 'second', s3Key: secondKey,
        imageModel: null, subjectLabel: 'Private name', modelInputOrder: 1,
      }] };
    for (const references of [snapshot.references, snapshot.references, []]) {
      expect(await execution.savePageGenerationInputSnapshot({ jobId: ids.jobId, userId: ids.userId,
        snapshot: { ...snapshot, references }, savedAt: new Date().toISOString() })).toBe(true);
    }
    const result = (await pool.query('SELECT result FROM generation_jobs WHERE id = $1::uuid', [ids.jobId])).rows[0]?.result;
    expect(result.retained_input_references).toEqual([
      { entityId: ids.personalEntityId, s3Key: firstKey },
      { entityId: ids.personalEntityId, s3Key: secondKey },
    ]);
    expect(result.progress_message).toBe('Preserve other fields');
    expect(result.input_snapshot.references).toEqual([]);
    await pool.query(`UPDATE generation_jobs SET status = 'completed', expires_at = NOW() - INTERVAL '8 days'
      WHERE id = $1::uuid`, [ids.jobId]);
    expect((await new PostgresGenerationJobRepository(database)
      .pruneExpiredTerminalJobs({ maxDeletes: 100, dryRun: false })).candidateIds).not.toContain(ids.jobId);
    const protectedKeys = await new PostgresImageStorageReferenceRepository(database)
      .findProtectedImageS3Keys({ protectRecentCandidateHours: 1 });
    expect(protectedKeys.has(firstKey)).toBe(true);
    expect(protectedKeys.has(secondKey)).toBe(true);
    const deletedKeys: string[] = [];
    const deletion = new AccountDeletionService(new PostgresAccountDeletionRepository(database, database),
      { cancelPersonalSubscription: async () => {} },
      { disableIdentity: async () => {}, deleteIdentity: async () => {} },
      { deleteExactObject: async (key) => { deletedKeys.push(key); } }, 'integration-only-identity-key-secret');
    expect(await deletion.requestDeletion({ userId: ids.userId, identityId: `entity-state-retention-${ids.userId}`,
      confirmation: 'DELETE', acknowledgePersonalSubscriptions: true,
      acknowledgeStoreBilling: true, acknowledgePersonalAssets: true })).toEqual({ status: 'completed', blockers: [] });
    expect(deletedKeys.sort()).toEqual([firstKey, secondKey]);
  });
});

interface FixtureIds {
  jobId: string;
  organizationId: string;
  organizationEntityId: string;
  organizationStateId: string;
  organizationWorkId: string;
  personalEntityId: string;
  personalStateId: string;
  personalWorkId: string;
  userId: string;
}

interface FixtureKeys {
  organizationStateKey: string;
  personalStateKey: string;
  snapshotKey: string;
}

function createFixtureIds(): FixtureIds {
  return {
    jobId: randomUUID(),
    organizationId: randomUUID(),
    organizationEntityId: randomUUID(),
    organizationStateId: randomUUID(),
    organizationWorkId: randomUUID(),
    personalEntityId: randomUUID(),
    personalStateId: randomUUID(),
    personalWorkId: randomUUID(),
    userId: randomUUID(),
  };
}

async function insertFixture(pool: Pool, ids: FixtureIds, keys: FixtureKeys): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `entity-state-retention-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO organizations (id, name, created_by_user_id)
     VALUES ($1::uuid, 'Entity state retention organization', $2::uuid)`,
    [ids.organizationId, ids.userId],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title, organization_id)
     VALUES ($1::uuid, $2::uuid, 'Personal work', NULL),
            ($3::uuid, $2::uuid, 'Organization work', $4::uuid)`,
    [ids.personalWorkId, ids.userId, ids.organizationWorkId, ids.organizationId],
  );
  await pool.query(
    `INSERT INTO entities (id, work_id, user_id, name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Personal character'),
            ($4::uuid, $5::uuid, $3::uuid, 'Organization character')`,
    [
      ids.personalEntityId,
      ids.personalWorkId,
      ids.userId,
      ids.organizationEntityId,
      ids.organizationWorkId,
    ],
  );
  await pool.query(
    `INSERT INTO entity_states (id, entity_id, name, description, reference_image)
     VALUES ($1::uuid, $2::uuid, 'injured', 'A cheek scar', $3::jsonb),
            ($4::uuid, $5::uuid, 'rain', 'Wet hair', $6::jsonb)`,
    [
      ids.personalStateId,
      ids.personalEntityId,
      JSON.stringify({ s3_key: keys.personalStateKey }),
      ids.organizationStateId,
      ids.organizationEntityId,
      JSON.stringify({ s3_key: keys.organizationStateKey }),
    ],
  );
  await pool.query(
    `INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params, result)
     VALUES ($1::uuid, $2::uuid, 'page_generate', 'completed', 0, '{}'::jsonb, $3::jsonb)`,
    [
      ids.jobId,
      ids.userId,
      JSON.stringify({
        input_snapshot: {
          references: [{ s3Key: keys.snapshotKey }],
        },
      }),
    ],
  );
}

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the entity state image retention integration test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(value: string): void {
  if (!/^entity_state_retention_[0-9]+_[0-9]+$/u.test(value)) {
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
