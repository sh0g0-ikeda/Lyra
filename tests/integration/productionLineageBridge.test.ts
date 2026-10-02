import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { inspectMigrationLineage, PRODUCTION_BRIDGE_FILENAME } from '../../src/lib/migrationLineage.js';
import { createAccountDeletionIdentityKey } from '../../src/domain/accountDeletion.js';
import { checkDeploymentDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import { checkMigrationLineage } from '../../scripts/checkMigrationLineage.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { throwingRejectionOf } from './asyncPostgresAssertions.js';
const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const secret = 'synthetic-lineage-identity-hash-key-only-for-tests';
const currentDir = join(process.cwd(), 'migrations');
const productionDir = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');
const fixtureExportRelationsSql = `SELECT
    to_regclass(format('%I.%I', current_schema(), 'export_jobs')) AS old,
    to_regclass(format('%I.%I', current_schema(), 'episode_export_jobs')) AS candidate`;
describePostgres('forward-only production lineage bridge', () => {
    let admin: Pool;
    const pools: Pool[] = [];
    const schemas: string[] = [];
    beforeAll(() => { admin = new Pool({ connectionString: process.env.DATABASE_URL }); });
    // This hook drops 26 full fixture schemas; allow bounded DDL cleanup on busy CI runners.
    afterAll(async () => {
        for (const pool of pools)
            await pool.end();
        for (const schema of schemas)
            await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }, 60_000);
    async function database(production = true): Promise<{
        pool: Pool;
        db: DatabaseClient & TransactionRunner;
    }> {
        const schema = `lineage_${randomUUID().replaceAll('-', '')}`;
        schemas.push(schema);
        await admin.query(`CREATE SCHEMA ${schema}`);
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 4 });
        pools.push(pool);
        const db = adapter(pool);
        if (production)
            await withPostgresTestMigrationLock(admin, () => runPendingMigrations(db, { migrationsDir: productionDir }));
        return { pool, db };
    }
    async function seed(pool: Pool, includeLegacyCompletedDeletion=true): Promise<{
        userId: string;
        deletedUserId: string;
        identityId: string;
        pageId: string;
        exportId: string;
        jobId: string;
    }> {
        const userId = randomUUID(), deletedUserId = randomUUID(), workId = randomUUID(), chapterId = randomUUID(), episodeId = randomUUID(), pageId = randomUUID(), exportId = randomUUID(), jobId = randomUUID();
        const identityId = `historical-identity-${randomUUID()}`;
        await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[userId,`live-${userId}`,`${userId}@example.invalid`]);
        if(includeLegacyCompletedDeletion) await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[deletedUserId,`deleted:${deletedUserId}`,`deleted+${deletedUserId}@invalid.local`]);
        await pool.query(`INSERT INTO credit_balances (user_id,purchased_credits) VALUES ($1,777)`, [userId]);
        await pool.query(`INSERT INTO credit_ledger (user_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description) VALUES ($1,'signup_bonus',777,0,777,0,777,'Preserve sentinel credits')`, [userId]);
        await pool.query(`INSERT INTO works(id,user_id,title) VALUES ($1,$2,'Preserve work')`, [workId, userId]);
        await pool.query(`INSERT INTO chapters(id,work_id,"order") VALUES ($1,$2,1)`, [chapterId, workId]);
        await pool.query(`INSERT INTO episodes(id,chapter_id,"order") VALUES ($1,$2,1)`, [episodeId, chapterId]);
        await pool.query(`INSERT INTO pages(id,episode_id,page_number,layout_config,story_source_scene_ids,story_page_purpose,story_continuity_note)
      VALUES ($1,$2,1,'{"story_source_scene_ids":["stale"],"story_page_purpose":"stale","story_continuity_note":"stale","other":"keep"}','{}',NULL,'current continuity')`, [pageId, episodeId]);
        await pool.query(`INSERT INTO export_jobs(id,user_id,episode_id,format,filename,page_ids,page_snapshot,request_fingerprint,idempotency_key,status,progress_stage,progress_percent,artifact_s3_key,artifact_mime_type,artifact_size_bytes,created_at,started_at,completed_at,expires_at)
      VALUES($1,$2,$3,'pdf','kept.pdf',ARRAY[$4::uuid],$5::jsonb,$6,$7,'completed','completed',100,$8,'application/pdf',128,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '110 minutes',NOW()-INTERVAL '100 minutes',NOW()+INTERVAL '20 hours')`, [exportId, userId, episodeId, pageId, JSON.stringify([{ page_id: pageId, page_number: 1, s3_key: `session/${userId}/pages/${pageId}/image.png` }]), 'a'.repeat(64), randomUUID(), `exports/${userId}/episodes/${episodeId}/${exportId}.pdf`]);
        await pool.query(`INSERT INTO export_job_outbox(export_job_id) VALUES($1)`, [exportId]);
        await pool.query(`INSERT INTO mobile_push_tokens(user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id) VALUES($1,$2,'ios','en',$3,$4,'fixture-key')`, [userId, randomUUID(), 'b'.repeat(64), `v1.${'A'.repeat(16)}.${'B'.repeat(32)}.${'C'.repeat(22)}`]);
        await pool.query(`INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params) VALUES($1,$2,'entity_generate','queued',0,'{}')`, [jobId, userId]);
        await pool.query(`UPDATE generation_jobs SET status='completed',completed_at=NOW() WHERE id=$1`, [jobId]);
        await pool.query(`INSERT INTO mobile_store_purchases(user_id,store,environment,external_purchase_key,product_id,kind,plan_code,state,last_observed_at,scheduled_product_id,scheduled_plan_code,scheduled_effective_at)
      VALUES($1,'google','production',$2,'standard-product','subscription','standard','active',NOW(),'premium-product','premium',NOW()+INTERVAL '7 days')`, [userId, 'D'.repeat(43)]);
        if(includeLegacyCompletedDeletion) await pool.query(`INSERT INTO account_deletion_requests(user_id,identity_id,status,data_anonymized_at,identity_deleted_at,completed_at,created_at)
      VALUES($1,$2,'completed',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day',NOW()-INTERVAL '2 days')`, [deletedUserId, identityId]);
        return { userId, deletedUserId, identityId, pageId, exportId, jobId };
    }
    async function upgrade(db: DatabaseClient & TransactionRunner): Promise<string[]> {
        const applied=await withPostgresTestMigrationLock(admin, () => runPendingMigrations(db, { allowProductionLineageBridge: true, accountDeletionIdentityHashSecret: secret }));
        const invariants=await checkDeploymentDataInvariants(db);
        expect(invariants.violations).toEqual([]);
        expect(invariants.ok).toBe(true);
        return applied;
    }
    it('本番履歴・ID・課金を保持して新規schemaへ進み二度目は何もしない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool,false);
        const exportOid = (await pool.query("SELECT 'export_jobs'::regclass::oid AS oid")).rows[0]?.oid;
        const history = (await pool.query('SELECT filename,applied_at FROM schema_migrations ORDER BY filename')).rows;
        const exportBefore = (await pool.query('SELECT to_jsonb(export_jobs) AS row FROM export_jobs WHERE id=$1', [ids.exportId])).rows[0]?.row;
        const purchaseBefore = (await pool.query('SELECT to_jsonb(mobile_store_purchases) AS row FROM mobile_store_purchases WHERE user_id=$1', [ids.userId])).rows[0]?.row;
        const report = await checkMigrationLineage(db, { migrationsDir: currentDir, accountDeletionIdentityHashSecret: secret });
        expect(report.lineage).toBe('production');
        expect(report.blockers).toEqual([]);
        expect(JSON.stringify(report)).not.toContain(ids.identityId);
        expect(JSON.stringify(report)).not.toContain(ids.userId);
        const applied = await upgrade(db);
        expect(applied).toContain(PRODUCTION_BRIDGE_FILENAME);
        expect(applied.at(-1)).toBe('047_add_state_reference_copy_attempts.sql');
        expect((await pool.query("SELECT to_regclass(format('%I.%I', current_schema(), 'state_reference_copy_attempts')) AS journal")).rows[0]?.journal).toBe('state_reference_copy_attempts');
        for (const row of history) {
            expect((await pool.query('SELECT applied_at FROM schema_migrations WHERE filename=$1', [row.filename])).rows[0]?.applied_at).toEqual(row.applied_at);
        }
        expect((await pool.query("SELECT 'episode_export_jobs'::regclass::oid AS oid")).rows[0]?.oid).toBe(exportOid);
        const exportAfter = (await pool.query('SELECT to_jsonb(episode_export_jobs) AS row FROM episode_export_jobs WHERE id=$1', [ids.exportId])).rows[0]?.row;
        for (const [key, value] of Object.entries(exportBefore)) {
            expect(exportAfter[key]).toEqual(value);
        }
        expect((await pool.query('SELECT export_job_id FROM episode_export_job_outbox WHERE export_job_id=$1', [ids.exportId])).rows).toHaveLength(1);
        expect((await pool.query('SELECT to_jsonb(mobile_store_purchases) AS row FROM mobile_store_purchases WHERE user_id=$1', [ids.userId])).rows[0]?.row).toEqual(purchaseBefore);
        expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1', [ids.userId])).rows[0]?.purchased_credits).toBe(777);
        expect((await pool.query('SELECT layout_config FROM pages WHERE id=$1', [ids.pageId])).rows[0]?.layout_config).toMatchObject({ story_source_scene_ids: [], story_page_purpose: null, story_continuity_note: 'current continuity', other: 'keep' });
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM account_deletion_requests')).rows[0]?.count).toBe(0);
        expect(await (upgrade(db))).toEqual([]);
    }, 120000);
    it('明示quiescenceなし・secretなし・active jobでは変更前に停止する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        expect(await throwingRejectionOf(runPendingMigrations(db, { accountDeletionIdentityHashSecret: secret }))).toThrow();
        expect(await throwingRejectionOf(runPendingMigrations(db, { allowProductionLineageBridge: true }))).toThrow();
        await pool.query(`UPDATE generation_jobs SET status='queued',completed_at=NULL WHERE id=$1`, [ids.jobId]);
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toMatchObject({ old: 'export_jobs', candidate: null });
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1', [PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
    }, 120000);
    it('不明hybrid schemaと不正な既存tokenを集計報告して保存しない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query('CREATE TABLE episode_export_jobs (id uuid PRIMARY KEY)');
        expect((await inspectMigrationLineage(db, { migrationsDir: currentDir, accountDeletionIdentityHashSecret: secret })).blockers.length).toBeGreaterThan(0);
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        await pool.query('DROP TABLE episode_export_jobs');
        await pool.query(`UPDATE mobile_push_tokens SET token_hash=$2 WHERE user_id=$1`, [ids.userId, 'Z'.repeat(64)]);
        const report = await inspectMigrationLineage(db, { migrationsDir: currentDir, accountDeletionIdentityHashSecret: secret });
        expect(report.blockers.length).toBeGreaterThan(0);
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        expect((await pool.query("SELECT to_regclass(format('%I.%I', current_schema(), 'export_jobs')) AS old")).rows[0]?.old).toBe('export_jobs');
    }, 120000);
    it('prepass途中失敗はrename・schema・migration receiptを全てrollbackする', async () => {
        const { pool, db } = await database();
        await seed(pool,false);
        const failing = adapter(pool, PRODUCTION_BRIDGE_FILENAME);
        expect(await throwingRejectionOf(upgrade(failing))).toThrow('Injected bridge checkpoint failure');
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toMatchObject({ old: 'export_jobs', candidate: null });
        expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA() AND table_name='account_deletion_requests' AND column_name='identity_key'")).rows).toEqual([]);
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1', [PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
        expect(await (upgrade(db))).toContain(PRODUCTION_BRIDGE_FILENAME);
    }, 120000);
    it('既知legacy alias名を消さずcanonical receiptを追加して移行する', async () => {
        const { pool, db } = await database();
        await seed(pool,false);
        const mappings = [['027_add_account_deletion_requests.sql', '024_add_account_deletion_requests.sql'], ['028_add_page_story_metadata_columns.sql', '025_add_page_story_metadata_columns.sql'], ['029_add_mobile_store_purchase_ledger.sql', '026_add_mobile_store_purchase_ledger.sql'], ['031_add_entity_reference_upload_tokens.sql', '028_add_entity_reference_upload_tokens.sql'], ['032_add_episode_export_jobs.sql', '029_add_episode_export_jobs.sql'], ['033_add_mobile_push_token_registry.sql', '030_add_mobile_push_token_registry.sql'], ['034_add_mobile_push_notification_outbox.sql', '031_add_mobile_push_notification_outbox.sql']];
        for (const [canonical, legacy] of mappings)
            await pool.query('UPDATE schema_migrations SET filename=$2 WHERE filename=$1', [canonical, legacy]);
        await upgrade(db);
        for (const [canonical, legacy] of mappings) {
            const found = (await pool.query('SELECT filename FROM schema_migrations WHERE filename=ANY($1::text[])', [[canonical, legacy]])).rows.map((row) => row.filename);
            expect(found).toEqual(expect.arrayContaining([canonical, legacy]));
        }
    }, 120000);
    it('既知の旧actor列とcanceled表記だけを記録済みactorで修復する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool,false);
        await pool.query(`UPDATE schema_migrations SET filename='032_add_processing_generation_job_cancellation.sql' WHERE filename='024_add_generation_job_cancellation.sql'`);
        await pool.query('ALTER TABLE generation_jobs RENAME COLUMN cancel_requested_by TO cancel_requested_by_user_id');
        await pool.query('DROP TRIGGER generation_jobs_enqueue_mobile_push_notification ON generation_jobs');
        await pool.query('ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check');
        await pool.query(`ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check CHECK(status IN ('queued','processing','completed','failed','canceled'))`);
        const canceledJobId=randomUUID();
        await pool.query(`INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,created_at,completed_at,cancel_requested_at,cancel_requested_by_user_id,cancelled_at)
          VALUES($1,$2,'entity_generate','canceled',0,'{}',NOW(),NOW(),NOW(),$2,NOW())`,[canceledJobId,ids.userId]);
        await upgrade(db);
        expect((await pool.query('SELECT status,cancel_requested_by,cancel_requested_by_user_id FROM generation_jobs WHERE id=$1', [canceledJobId])).rows[0]).toEqual({ status: 'cancelled', cancel_requested_by: ids.userId, cancel_requested_by_user_id: ids.userId });
        expect((await pool.query("SELECT filename FROM schema_migrations WHERE filename IN ('024_add_generation_job_cancellation.sql','032_add_processing_generation_job_cancellation.sql')")).rows).toHaveLength(2);
    }, 120000);
    it('actor不明のcancelled記録からactorを捏造せず停止する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query('DROP TRIGGER generation_jobs_enqueue_mobile_push_notification ON generation_jobs');
        await pool.query(`UPDATE generation_jobs SET status='cancelled',cancelled_at=completed_at WHERE id=$1`, [ids.jobId]);
        const report = await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.blockers).toContain('LEGACY_ROWS_VIOLATE_GENERATION_JOBS_CANCELLATION_STATE_CHECK');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        expect((await pool.query('SELECT cancel_requested_by FROM generation_jobs WHERE id=$1', [ids.jobId])).rows[0]?.cancel_requested_by).toBeNull();
    }, 120000);
    it('未追跡candidate列・不足履歴・未知履歴を変更前に拒否する', async () => {
        const { pool, db } = await database();
        await seed(pool);
        await pool.query('ALTER TABLE mobile_push_notification_outbox ADD COLUMN generation_retry_count INTEGER');
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNTRACKED_CANDIDATE_SCHEMA');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        await pool.query('ALTER TABLE mobile_push_notification_outbox DROP COLUMN generation_retry_count');
        await pool.query("DELETE FROM schema_migrations WHERE filename='019_add_organization_workspaces.sql'");
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('INCOMPLETE_PRODUCTION_HISTORY');
        await pool.query("INSERT INTO schema_migrations(filename) VALUES('019_add_organization_workspaces.sql'),('099_unrecognized.sql')");
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNKNOWN_MIGRATION_HISTORY');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('既存primary key欠落を静かに補修せず停止する', async () => {
        const { pool, db } = await database();
        await seed(pool);
        await pool.query('ALTER TABLE mobile_push_notification_deliveries DROP CONSTRAINT mobile_push_notification_deliveries_pkey');
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNSUPPORTED_PRIMARY_KEYS');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('後続migration失敗後も元履歴を保ちquiescence確認付きで再開する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool,false);
        expect(await throwingRejectionOf(upgrade(adapter(pool, '036_add_episode_export_processing_lease.sql')))).toThrow('Injected bridge checkpoint failure');
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toMatchObject({ old: null, candidate: 'episode_export_jobs' });
        const report = await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.lineage).toBe('production_bridged');
        expect(report.continuationRequiresQuiescence).toBe(true);
        expect(report.blockers).toEqual([]);
        expect(await throwingRejectionOf(runPendingMigrations(db, { accountDeletionIdentityHashSecret: secret }))).toThrow('quiescence');
        await upgrade(db);
        expect((await pool.query('SELECT id FROM episode_export_jobs WHERE id=$1', [ids.exportId])).rows).toHaveLength(1);
        expect(await (upgrade(db))).toEqual([]);
    }, 120000);
    it('同名でも異なるunique indexとforeign key欠落を拒否する', async () => {
        const { pool, db } = await database();
        await seed(pool);
        await pool.query('DROP INDEX idx_export_jobs_idempotency_scope');
        await pool.query('CREATE UNIQUE INDEX idx_export_jobs_idempotency_scope ON export_jobs(id)');
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNSUPPORTED_UNIQUE_INDEXES');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        await pool.query('ALTER TABLE export_job_outbox DROP CONSTRAINT export_job_outbox_export_job_id_fkey');
        expect((await inspectMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNSUPPORTED_FOREIGN_KEYS');
    }, 120000);
    it('既存tombstoneと異なるsecretをdry-runで検出し値を変更しない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query('ALTER TABLE account_deletion_requests ADD COLUMN identity_key TEXT');
        const original = createAccountDeletionIdentityKey('different-synthetic-only-existing-key', ids.identityId);
        await pool.query('UPDATE account_deletion_requests SET identity_key=$2 WHERE user_id=$1', [ids.deletedUserId, original]);
        expect((await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('EXISTING_IDENTITY_KEY_MISMATCH');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
        expect((await pool.query('SELECT identity_key FROM account_deletion_requests WHERE user_id=$1', [ids.deletedUserId])).rows[0]?.identity_key).toBe(original);
    }, 120000);
    it('active export・push lease・account deletionが残る場合は集計だけで停止する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query(`UPDATE export_jobs SET status='processing' WHERE id=$1`, [ids.exportId]);
        await pool.query(`UPDATE mobile_push_notification_deliveries SET status='processing',locked_at=NOW(),lease_token=$1`, [randomUUID()]);
        await pool.query(`UPDATE account_deletion_requests SET status='processing',processing_token=$2,processing_started_at=NOW() WHERE user_id=$1`, [ids.deletedUserId, randomUUID()]);
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.counts).toMatchObject({ active_export_jobs: 1, active_push_deliveries: 1, active_account_deletions: 1 });
        expect(report.blockers).toContain('ACTIVE_WORK_REQUIRES_QUIESCENCE');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('元identity証拠がない削除済みaccountのtombstoneを捏造しない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query('DELETE FROM account_deletion_requests WHERE user_id=$1', [ids.deletedUserId]);
        expect((await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('INVALID_MISSING_DELETION_IDENTITY_RECORD');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('欠落していた正規化列は検証済みlayout値から一度だけ補い他keyを維持する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool,false);
        await pool.query('ALTER TABLE pages DROP COLUMN story_source_scene_ids, DROP COLUMN story_page_purpose, DROP COLUMN story_continuity_note');
        expect((await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('INVALID_LEGACY_SCENE_IDS');
        const sourceId = randomUUID();
        await pool.query('UPDATE pages SET layout_config=$2::jsonb WHERE id=$1', [ids.pageId, JSON.stringify({ story_source_scene_ids: [sourceId], story_page_purpose: 'original purpose', story_continuity_note: null, other: 'keep' })]);
        await upgrade(db);
        expect((await pool.query('SELECT story_source_scene_ids,story_page_purpose,story_continuity_note,layout_config FROM pages WHERE id=$1', [ids.pageId])).rows[0]).toMatchObject({ story_source_scene_ids: [sourceId], story_page_purpose: 'original purpose', story_continuity_note: null, layout_config: { story_source_scene_ids: [sourceId], story_page_purpose: 'original purpose', story_continuity_note: null, other: 'keep' } });
    }, 120000);
    it('必須storage keyのnullable driftを既存rowがなくても拒否する', async () => {
        const { pool, db } = await database();
        await seed(pool);
        await pool.query('ALTER TABLE entity_reference_upload_tokens ALTER COLUMN s3_key DROP NOT NULL');
        expect((await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret })).blockers).toContain('UNSUPPORTED_NULLABILITY');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('大文字小文字だけ異なるactive email重複を集計だけで拒否する', async () => {
        const { pool, db } = await database();
        await seed(pool);
        const firstId = randomUUID(), secondId = randomUUID();
        const firstEmail = 'CaseVariant@example.invalid', secondEmail = 'casevariant@example.invalid';
        await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3),($4,$5,$6)', [firstId, `first-${firstId}`, firstEmail, secondId, `second-${secondId}`, secondEmail]);
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.counts.duplicate_normalized_active_email_groups).toBe(1);
        expect(report.blockers).toContain('INVALID_DUPLICATE_NORMALIZED_ACTIVE_EMAIL_GROUPS');
        expect(JSON.stringify(report)).not.toContain(firstEmail);
        expect(JSON.stringify(report)).not.toContain(secondEmail);
        expect(JSON.stringify(report)).not.toContain(firstId);
        expect(JSON.stringify(report)).not.toContain(secondId);
        expect(await throwingRejectionOf(upgrade(db))).toThrow('DUPLICATE_NORMALIZED_ACTIVE_EMAIL');
        expect((await pool.query('SELECT id,email FROM users WHERE id=ANY($1::uuid[]) ORDER BY email', [[firstId, secondId]])).rows).toEqual([{ id: firstId, email: firstEmail }, { id: secondId, email: secondEmail }]);
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toEqual({ old: 'export_jobs', candidate: null });
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1', [PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
    }, 120000);
    it('email列欠落はデータ照会や変更の前にschema blockerにする', async () => {
        const { pool, db } = await database();
        await seed(pool);
        await pool.query('ALTER TABLE users RENAME COLUMN email TO old_email');
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.blockers).toContain('UNSUPPORTED_REQUIRED_COLUMNS');
        expect(await throwingRejectionOf(upgrade(db))).toThrow();
    }, 120000);
    it('確定済み削除recordにより無効化されるemailはactive重複に数えない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query('UPDATE users SET email=$2 WHERE id=$1', [ids.userId, 'same@example.invalid']);
        await pool.query('UPDATE users SET email=$2 WHERE id=$1', [ids.deletedUserId, 'Same@example.invalid']);
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.counts.duplicate_normalized_active_email_groups).toBe(0);
        expect(report.blockers).toContain('INVALID_LEGACY_COMPLETED_DELETION_UNSCRUBBED');
        expect(await throwingRejectionOf(upgrade(db))).toThrow('LEGACY_COMPLETED_DELETION_UNSCRUBBED');
    }, 120000);
    it('legacy pending削除は保存されたacknowledgement証拠なしに新workerへ引き継がない', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        await pool.query(`UPDATE account_deletion_requests SET status='pending_external_action',completed_at=NULL,last_failure_code='DELETE_IDENTITY_FAILED' WHERE user_id=$1`, [ids.deletedUserId]);
        const before = (await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1', [ids.deletedUserId])).rows[0]?.row;
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.counts.legacy_pending_deletion_requests).toBe(1);
        expect(report.blockers).toContain('INVALID_LEGACY_PENDING_DELETION_REQUESTS');
        expect(await throwingRejectionOf(upgrade(db))).toThrow('LEGACY_PENDING_DELETION_REQUESTS');
        expect((await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1', [ids.deletedUserId])).rows[0]?.row).toEqual(before);
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1', [PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
    }, 120000);
    it('completedでもlifecycle予定assetをexact deletion済みと読み替えず保存して停止する', async () => {
        const { pool, db } = await database();
        const ids = await seed(pool);
        const historicalKey = `saved/${ids.deletedUserId}/entities/${randomUUID()}/ref.png`;
        await pool.query('UPDATE account_deletion_requests SET scheduled_asset_keys=ARRAY[$2::text] WHERE user_id=$1', [ids.deletedUserId, historicalKey]);
        const before = (await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1', [ids.deletedUserId])).rows[0]?.row;
        const report = await checkMigrationLineage(db, { accountDeletionIdentityHashSecret: secret });
        expect(report.counts.legacy_scheduled_asset_records).toBe(1);
        expect(report.blockers).toContain('INVALID_LEGACY_SCHEDULED_ASSET_RECORDS');
        expect(JSON.stringify(report)).not.toContain(historicalKey);
        expect(await throwingRejectionOf(upgrade(db))).toThrow('LEGACY_SCHEDULED_ASSET_RECORDS');
        expect((await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1', [ids.deletedUserId])).rows[0]?.row).toEqual(before);
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toEqual({ old: 'export_jobs', candidate: null });
    }, 120000);
    it.each([false,true])('予定assetが空でも未scrubのlegacy completed証拠は変更せず停止する:既存key=%s', async (existingKey) => {
        const {pool, db}=await database(); const ids=await seed(pool);
        if(existingKey){
            await pool.query('ALTER TABLE account_deletion_requests ADD COLUMN identity_key TEXT');
            await pool.query('UPDATE account_deletion_requests SET identity_key=$2 WHERE user_id=$1',[ids.deletedUserId,createAccountDeletionIdentityKey(secret,ids.identityId)]);
        }
        const before=(await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1',[ids.deletedUserId])).rows[0]?.row;
        expect(before.scheduled_asset_keys).toEqual([]);
        expect(before.identity_id).toBe(ids.identityId);
        const report=await checkMigrationLineage(db,{accountDeletionIdentityHashSecret:secret});
        expect(report.counts.legacy_completed_deletion_unscrubbed).toBe(1);
        expect(report.blockers).toContain('INVALID_LEGACY_COMPLETED_DELETION_UNSCRUBBED');
        expect(JSON.stringify(report)).not.toContain(ids.identityId);
        expect(await throwingRejectionOf(upgrade(db))).toThrow('LEGACY_COMPLETED_DELETION_UNSCRUBBED');
        expect((await pool.query('SELECT to_jsonb(r) AS row FROM account_deletion_requests r WHERE user_id=$1',[ids.deletedUserId])).rows[0]?.row).toEqual(before);
        expect((await pool.query(fixtureExportRelationsSql)).rows[0]).toEqual({old:'export_jobs',candidate:null});
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1',[PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
    },120_000);
    it('legacy未送信pushが現在のterminal状態と一致しない場合は送信済みにせず停止する', async () => {
        const {pool,db}=await database(); const ids=await seed(pool,false);
        await pool.query(`UPDATE generation_jobs SET status='cancelled',cancel_requested_at=created_at,cancel_requested_by=user_id,cancelled_at=completed_at WHERE id=$1`,[ids.jobId]);
        const before=(await pool.query('SELECT to_jsonb(d) AS row FROM mobile_push_notification_deliveries d')).rows;
        const report=await checkMigrationLineage(db,{accountDeletionIdentityHashSecret:secret});
        expect(report.counts.invalid_pending_push_terminal_snapshots).toBe(1);
        expect(report.blockers).toContain('INVALID_PENDING_PUSH_TERMINAL_SNAPSHOTS');
        expect(await throwingRejectionOf(upgrade(db))).toThrow('PENDING_PUSH_TERMINAL_SNAPSHOTS');
        expect((await pool.query('SELECT to_jsonb(d) AS row FROM mobile_push_notification_deliveries d')).rows).toEqual(before);
        expect((await pool.query('SELECT filename FROM schema_migrations WHERE filename=$1',[PRODUCTION_BRIDGE_FILENAME])).rows).toEqual([]);
    },120_000);
    it('空DBへのread-only dry-runはmigration metadataも作成しない', async () => {
        const { pool, db } = await database(false);
        const before = (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=CURRENT_SCHEMA()')).rows;
        expect((await checkMigrationLineage(db)).lineage).toBe('fresh');
        expect((await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=CURRENT_SCHEMA()')).rows).toEqual(before);
    }, 120000);
    it('fresh candidateはbridge opt-in不要で通常順に適用する', async () => {
        const { db } = await database(false);
        const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(db));
        expect(applied).toContain(PRODUCTION_BRIDGE_FILENAME);
        expect(applied.at(-1)).toBe('047_add_state_reference_copy_attempts.sql');
        expect((await checkDeploymentDataInvariants(db)).violations).toEqual([]);
        expect(await (runPendingMigrations(db))).toEqual([]);
    }, 120000);
});
function adapter(pool: Pool, fail: string | null = null): DatabaseClient & TransactionRunner {
    return { query: <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => pool.query<T>(sql, values ? [...values] : undefined), transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
            const connection = await pool.connect();
            try {
                await connection.query('BEGIN');
                const value = await work({ query: async <R extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
                        if (fail && sql.includes('INSERT INTO schema_migrations') && values?.[0] === fail)
                            throw new Error('Injected bridge checkpoint failure');
                        return connection.query<R>(sql, values ? [...values] : undefined);
                    } });
                await connection.query('COMMIT');
                return value;
            }
            catch (error) {
                await connection.query('ROLLBACK');
                throw error;
            }
            finally {
                connection.release();
            }
        } };
}
