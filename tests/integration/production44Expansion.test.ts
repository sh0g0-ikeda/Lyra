import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPendingMigrations, runProduction44Expansion } from '../../src/lib/migrations.js';
import { readRuntimeSchemaCatalogInTransaction } from '../../src/lib/runtimeSchemaAttestation.js';
import { describeProduction44ExpansionCheckpoint } from '../../src/lib/production44ExpandedRuntimeSchemaAttestation.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { checkDeploymentDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import type { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import type { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import type { PostgresCreditRepository } from '../../src/repositories/CreditRepository.js';
import type { CreditService } from '../../src/services/credit/CreditService.js';

const native = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
native('048 legacy writer row revision', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = 'revision48_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema + ',public -c timezone=UTC' });
    await pool.query(`CREATE TABLE entity_states(id int PRIMARY KEY, costume_note text, name text, description text,
      reference_image jsonb, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())`);
    await pool.query(await readFile(join(process.cwd(), 'migrations/048_advance_entity_state_revision_for_legacy_writers.sql'), 'utf8'));
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); } });
  it('旧writerの同一値はrevisionを保ち変更時だけ既存画像を保ってms単調増加する', async () => {
    await pool.query(`INSERT INTO entity_states VALUES (1,'old','variant','description','{"id":"saved"}',NOW(),'2099-01-01T00:00:00.123456Z')`);
    const unchanged = await pool.query('UPDATE entity_states SET costume_note=costume_note WHERE id=1 RETURNING updated_at::text AS revision');
    expect(unchanged.rows[0].revision).toContain('.123456');
    const changed = await pool.query("UPDATE entity_states SET costume_note='new' WHERE id=1 RETURNING updated_at::text AS revision,reference_image,name,description");
    expect(changed.rows[0]).toMatchObject({ revision: '2099-01-01 00:00:00.124+00', reference_image: { id: 'saved' }, name: 'variant', description: 'description' });
    const again = await pool.query("UPDATE entity_states SET costume_note='again', updated_at='2000-01-01' WHERE id=1 RETURNING updated_at::text AS revision");
    expect(again.rows[0].revision).toBe('2099-01-01 00:00:00.125+00');
  });
  it('null revisionの旧行と明示future revisionでも有限のms revisionへ進む', async () => {
    await pool.query("INSERT INTO entity_states(id,updated_at) VALUES(2,NULL)");
    const changed = await pool.query("UPDATE entity_states SET costume_note='new' WHERE id=2 RETURNING updated_at IS NOT NULL AS present, extract(microseconds from updated_at)::bigint % 1000 AS remainder");
    expect(changed.rows[0]).toEqual({ present: true, remainder: '0' });
    const explicit = await pool.query("UPDATE entity_states SET updated_at='2199-01-01T00:00:00.333999Z' WHERE id=2 RETURNING updated_at::text AS revision");
    expect(explicit.rows[0].revision).toBe('2199-01-01 00:00:00.333+00');
  });
});

native('actual44 explicit forward expansion', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = 'expansion44_' + randomUUID().replaceAll('-', '');
  const userId = randomUUID();
  const workId = randomUUID();
  const entityId = randomUUID();
  const stateId = randomUUID();
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema + ',public', max: 5 });
    const session = await pool.connect();
    try {
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations({ query: session.query.bind(session), transaction: async work => {
        await session.query('BEGIN');
        try { const result = await work(session); await session.query('COMMIT'); return result; }
        catch (error) { await session.query('ROLLBACK'); throw error; }
      } }, { migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18') }));
    } finally { session.release(); }
    await pool.query("INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)", [userId, 'expansion-'+userId, userId+'@example.invalid']);
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'expansion')", [workId,userId]);
    await pool.query("INSERT INTO entities(id,user_id,work_id,name) VALUES($1,$2,$3,'legacy character')", [entityId,userId,workId]);
    await pool.query("INSERT INTO entity_states(id,entity_id,costume_note) VALUES($1,$2,'old')", [stateId,entityId]);
    await pool.query("UPDATE entity_states SET costume_note='before expansion',condition_note=NULL,hair_note=NULL,expression_default='neutral',extra_note=NULL,scene_id=NULL,costume_ref_id=NULL WHERE id=$1", [stateId]);
    await pool.query("INSERT INTO generation_jobs(user_id,job_type,status,credit_cost,params,completed_at) SELECT $1,'page_generate','completed',0,'{}',NOW() FROM generate_series(1,20000)", [userId]);
  }, 120_000);
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); } });
  const checkpoint = async (): Promise<number | null> => {
    const session = await pool.connect();
    try { return describeProduction44ExpansionCheckpoint(await readRuntimeSchemaCatalogInTransaction(session, { includeFunctionBodies: true, includeLegacyAttributes: true })); }
    finally { session.release(); }
  };
  it('未知catalogでは履歴もDDLも変えず拒否する', async () => {
    expect(await checkpoint()).toBe(0);
    await pool.query('ALTER TABLE entity_states ADD COLUMN unknown_expansion_column text');
    await expect(runProduction44Expansion(pool)).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED');
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(44);
    await pool.query('ALTER TABLE entity_states DROP COLUMN unknown_expansion_column');
    expect(await checkpoint()).toBe(0);
  });
  it('既存普通runnerロックと別session advisory lockを尊重する', async () => {
    await pool.query("INSERT INTO schema_migration_locks(name) VALUES('schema_migrations')");
    try { await expect(runProduction44Expansion(pool)).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED'); }
    finally { await pool.query('DELETE FROM schema_migration_locks'); }
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(1744048,52)');
      await expect(runProduction44Expansion(pool)).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED');
    } finally { await holder.query('SELECT pg_advisory_unlock(1744048,52)'); holder.release(); }
    expect(await checkpoint()).toBe(0);
  });
  it('DDL後catalogが一致しなければそのfileとreceiptを一緒にrollbackする', async () => {
    await expect(runProduction44Expansion({ connect: async () => {
      const session = await pool.connect();
      return { release: session.release.bind(session), query: async <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
        const result = await session.query<T>(sql, values === undefined ? undefined : [...values]);
        if (sql === 'INSERT INTO schema_migrations(filename) VALUES($1)') await session.query('ALTER TABLE entity_states ADD COLUMN unexpected_after_ddl text');
        return result;
      } };
    } })).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED');
    expect(await checkpoint()).toBe(0);
  });
  it('043ロックtimeoutはそのfileをrollbackしexact3checkpointから再開して52履歴だけとなる', async () => {
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('LOCK TABLE generation_jobs IN ACCESS SHARE MODE');
    const started = performance.now();
    try { await expect(runProduction44Expansion(pool)).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED'); }
    finally { await holder.query('ROLLBACK'); holder.release(); }
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(await checkpoint()).toBe(3);
    expect((await pool.query("SELECT convalidated FROM pg_constraint WHERE conrelid='generation_jobs'::regclass AND conname='generation_jobs_job_type_check'")).rows[0].convalidated).toBe(true);
    let constraintDdlMs = 0;
    const applied = await runProduction44Expansion({ connect: async () => {
      const session = await pool.connect();
      return { release: session.release.bind(session), query: async <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
        const start = performance.now();
        const result = await session.query<T>(sql, values === undefined ? undefined : [...values]);
        if (sql.includes('ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_job_type_check')) constraintDdlMs = performance.now() - start;
        return result;
      } };
    } });
    expect(constraintDdlMs).toBeGreaterThan(0);
    if (process.env.LYRA_EXPANSION_TEST_RECEIPT) await writeFile(process.env.LYRA_EXPANSION_TEST_RECEIPT, JSON.stringify({ artificialRows: 20000, migration043DdlMs: Math.round(constraintDdlMs), lockTimeoutRollbackVerified: true }));
    expect(applied).toHaveLength(5);
    expect(await checkpoint()).toBe(8);
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(52);
    expect((await pool.query("SELECT filename FROM schema_migrations WHERE filename LIKE '046%'")).rows).toEqual([]);
    expect(await runProduction44Expansion(pool)).toEqual([]);
    expect((await pool.query('SELECT * FROM schema_migration_locks')).rows).toEqual([]);
    expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pages' AND column_name='story_page_purpose'")).rows).toHaveLength(1);
  }, 30_000);
  it('旧coreへrollbackしてもlegacy列更新でpending revisionが進みvariant画像と新列を保持する', async () => {
    await pool.query("UPDATE entity_states SET name='variant',description='saved state',reference_image='{\"id\":\"saved\"}',updated_at='2099-01-01' WHERE id=$1", [stateId]);
    const before = await pool.query('SELECT updated_at, reference_image FROM entity_states WHERE id=$1', [stateId]);
    await pool.query("UPDATE entity_states SET costume_note='old writer after rollback',condition_note=NULL,hair_note=NULL,expression_default='neutral',extra_note=NULL,scene_id=NULL,costume_ref_id=NULL WHERE id=$1", [stateId]);
    const after = await pool.query('SELECT updated_at,reference_image,name,description FROM entity_states WHERE id=$1', [stateId]);
    expect(after.rows[0].updated_at.getTime() - before.rows[0].updated_at.getTime()).toBe(1);
    expect(after.rows[0]).toMatchObject({ reference_image: { id: 'saved' }, name: 'variant', description: 'saved state' });
    const staleSave = await pool.query("UPDATE entity_states SET name='stale' WHERE id=$1 AND updated_at=$2 RETURNING id", [stateId,before.rows[0].updated_at]);
    expect(staleSave.rowCount).toBe(0);
    await pool.query('UPDATE entity_states SET reference_image=NULL WHERE id=$1', [stateId]);
    const invariants = await checkDeploymentDataInvariants(pool);
    expect(invariants.violations).toEqual([]);
    expect(invariants.ok).toBe(true);
  });
  it('追加済schemaで固定旧Page/Job/Credit moduleへ戻して既存画像・retry・返還を維持する', async () => {
    const database = testDatabase(pool);
    const oldRoot = join(process.cwd(), 'tests/fixtures/production44-pg18/old-runtime/runtime');
    const load = async (file: string): Promise<unknown> => import(pathToFileURL(join(oldRoot, file)).href);
    // Selected modules are observed-image matches; full dependency image identity is not asserted.
    const OldPage = (await load('src/repositories/PageRepository.js') as { PostgresPageRepository: typeof PostgresPageRepository }).PostgresPageRepository;
    const OldJobs = (await load('src/repositories/GenerationJobRepository.js') as { PostgresGenerationJobRepository: typeof PostgresGenerationJobRepository }).PostgresGenerationJobRepository;
    const OldCredits = (await load('src/repositories/CreditRepository.js') as { PostgresCreditRepository: typeof PostgresCreditRepository }).PostgresCreditRepository;
    const OldCreditService = (await load('src/services/credit/CreditService.js') as { CreditService: typeof CreditService }).CreditService;
    const chapterId = randomUUID(), episodeId = randomUUID(), pageId = randomUUID(), jobId = randomUUID();
    await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId,workId]);
    await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId,chapterId]);
    await pool.query("INSERT INTO pages(id,episode_id,page_number,generated_image) VALUES($1,$2,1,'{\"s3_key\":\"test/saved.png\",\"cdn_url\":null,\"generation_mode\":null,\"generated_at\":null}')", [pageId,episodeId]);
    const pages = new OldPage(database);
    await pages.updatePageSettings(pageId,userId,{storyPagePurpose:'old core rollback'});
    expect((await pages.findPageByIdAndUserId(pageId,userId))?.generatedImage?.s3Key).toBe('test/saved.png');
    await pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params) VALUES($1,$2,'entity_generate','queued',12,'{}')", [jobId,userId]);
    await pool.query("INSERT INTO credit_balances(user_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,10,20,NOW()+INTERVAL '1 day')", [userId]);
    const credits = new OldCreditService(new OldCredits(database,database));
    await credits.consumeCredits({userId,cost:12,description:'local rollback debit',jobId});
    const jobs = new OldJobs(database);
    expect(await jobs.markFailed(jobId,'local rollback failure')).toBe(true);
    const refund = {userId,amount:12,description:'local rollback refund',jobId};
    await Promise.all([credits.refundCredits(refund),credits.refundCredits(refund)]);
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[userId])).rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect(await jobs.prepareRetry(jobId,2)).toBe(true);
    expect((await jobs.findByIdAndUserId(jobId,userId))?.retryCount).toBe(1);
    expect(await checkpoint()).toBe(8);
  });
  it('停止中にmigration leaseが交代した場合はDDLせず新ownerのロックを消さない', async () => {
    try {
      await expect(runProduction44Expansion({ connect: async () => {
        const session = await pool.connect();
        return { release: session.release.bind(session), query: async <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
          const result = await session.query<T>(sql, values === undefined ? undefined : [...values]);
          if (sql.startsWith('INSERT INTO schema_migration_locks(name)')) await pool.query("UPDATE schema_migration_locks SET locked_at=clock_timestamp()+INTERVAL '1 second' WHERE name='schema_migrations'");
          return result;
        } };
      } })).rejects.toThrow('CHECKPOINT_OR_MIGRATION_REJECTED');
      expect((await pool.query('SELECT * FROM schema_migration_locks')).rows).toHaveLength(1);
    } finally { await pool.query('DELETE FROM schema_migration_locks'); }
  });
});

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return { query: pool.query.bind(pool), transaction: async work => {
    const session = await pool.connect();
    try { await session.query('BEGIN'); const result = await work(session); await session.query('COMMIT'); return result; }
    catch (error) { await session.query('ROLLBACK'); throw error; }
    finally { session.release(); }
  } };
}
