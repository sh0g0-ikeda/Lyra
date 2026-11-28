import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations, runProduction44Expansion } from '../../src/lib/migrations.js';
import {
  attestCanonicalRuntimeSchema,
  attestRuntimeSchema,
  describeRuntimeSchema,
  prepareCanonicalRuntimeSchema,
  readRuntimeSchemaCatalog,
  WORK_BOOTSTRAP_RUNTIME_MIGRATIONS,
} from '../../src/lib/runtimeSchemaAttestation.js';
import { assertAttestedRuntimeCapabilities } from '../../src/lib/runtimeGuards.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined
  ? describe
  : describe.skip;
// Register the PG18-only historical profile without callback-context skips,
// preserving both Vitest and the repository's Bun test entrypoint.
const postgresVersion = process.env.APP_ENV === 'test' && databaseUrl !== undefined
  ? await (async (): Promise<number> => {
    const probe = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
    try {
      const result = await probe.query<{ version: string }>("SELECT current_setting('server_version_num') AS version");
      return Number(result.rows[0]?.version);
    } finally { await probe.end(); }
  })() : 0;

describePostgres('runtime schema attestation PostgreSQL boundary', () => {
  let admin: Pool;
  const pools: Pool[] = [];
  const schemas: string[] = [];

  beforeAll(() => { admin = new Pool({ connectionString: databaseUrl }); });
  afterAll(async () => {
    for (const pool of pools) await pool.end();
    for (const schema of schemas) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it('055の前後で旧機能を起動でき一括生成は正確な追加schemaがある場合のみ許可する', async () => {
    const { database, pool } = await isolatedDatabase('batch55');
    const directory = await mkdtemp(join(tmpdir(), 'lyra-pre-batch-'));
    try {
      for (const filename of await readdir(join(process.cwd(), 'migrations'))) {
        if (/^0(?:0[1-9]|[1-4][0-9]|5[0-4])_.+\.sql$/u.test(filename)) await copyFile(join(process.cwd(), 'migrations', filename), join(directory, filename));
      }
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const before = await attestRuntimeSchema(database);
      expect(() => assertAttestedRuntimeCapabilities(before, {})).not.toThrow();
      expect(() => assertAttestedRuntimeCapabilities(before, { GENERATION_BATCHES_ENABLED: true })).toThrow('055');
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
      const after = await attestRuntimeSchema(database);
      expect(after.capabilities.generationBatches).toBe(true);
      expect(() => assertAttestedRuntimeCapabilities(after, {})).not.toThrow();
      expect(() => assertAttestedRuntimeCapabilities(after, { GENERATION_BATCHES_ENABLED: true })).not.toThrow();
      await pool.query('DROP INDEX generation_batches_request_key');
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 120_000);

  it('056から058までの完全な追加footprintだけを読み切りbootstrap capabilityとして認定する', async () => {
    const { database, pool } = await isolatedDatabase('work_bootstrap_58');
    const directory = await mkdtemp(join(tmpdir(), 'lyra-pre-work-bootstrap-'));
    try {
      for (const filename of await readdir(join(process.cwd(), 'migrations'))) {
        if (/^0(?:0[1-9]|[1-4][0-9]|5[0-5])_.+\.sql$/u.test(filename)) {
          await copyFile(join(process.cwd(), 'migrations', filename), join(directory, filename));
        }
      }
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const before = await attestRuntimeSchema(database);
      expect(before.capabilities.workBootstrap).toBeUndefined();

      await copyFile(
        join(process.cwd(), 'migrations', '056_add_work_creation_metadata.sql'),
        join(directory, '056_add_work_creation_metadata.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');

      await copyFile(
        join(process.cwd(), 'migrations', '057_add_work_bootstrap_request_ledger.sql'),
        join(directory, '057_add_work_bootstrap_request_ledger.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');

      await copyFile(
        join(process.cwd(), 'migrations', '058_preserve_work_bootstrap_request_scope.sql'),
        join(directory, '058_preserve_work_bootstrap_request_scope.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const after = await attestRuntimeSchema(database);
      expect(after.capabilities.workBootstrap).toBe(true);
      expect(WORK_BOOTSTRAP_RUNTIME_MIGRATIONS.at(-1)).toBe('058_preserve_work_bootstrap_request_scope.sql');

      await pool.query('DROP INDEX idx_work_creation_metadata_scope');
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('fresh canonical schemaはactive jobが存在しても許可し物理story metadata列を要求しない', async () => {
    const { pool, database } = await isolatedDatabase('canonical');
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    const userId = randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [
      userId,
      `runtime-schema-${userId}`,
      `${userId}@example.invalid`,
    ]);
    await pool.query(
      "INSERT INTO generation_jobs(user_id,job_type,status,credit_cost,params) VALUES($1,'page_generate','queued',0,'{}')",
      [userId],
    );

    const catalog = await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true });
    expect(describeRuntimeSchema(catalog)).toEqual({ kind: 'canonical_fresh_v1', failures: [] });
    const attested = await attestCanonicalRuntimeSchema(database);
    const attestedSecurityRuntime = await attestRuntimeSchema(database);
    expect(attested).toBe('canonical_fresh_v1');
    const physical = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA() AND table_name = 'pages'
        AND column_name IN ('story_source_scene_ids','story_page_purpose','story_continuity_note')
    `);
    expect(physical.rows).toEqual([]);
    expect(() => assertAttestedRuntimeCapabilities(attestedSecurityRuntime, {})).not.toThrow();
  }, 120_000);

  (postgresVersion >= 180000 ? it : it.skip)('旧配信のproduction44拡張schemaでも055追加後に既存writerと一括生成を許可する', async () => {
    const { database, pool } = await isolatedDatabase('expanded_batch55');
    const directory = await mkdtemp(join(tmpdir(), 'lyra-batch-only-'));
    try {
      await withPostgresTestMigrationLock(admin, async () => {
        await runPendingMigrations(database, { migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18') });
        await runProduction44Expansion(pool);
      });
      for (const filename of await readdir(join(process.cwd(), 'migrations'))) {
        if (/^05[1-4]_.+\.sql$/u.test(filename)) await copyFile(join(process.cwd(), 'migrations', filename), join(directory, filename));
      }
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const before = await attestRuntimeSchema(database);
      expect(before.repositoryProfile).toBe('production44_expanded_pg18_v1');
      expect(() => assertAttestedRuntimeCapabilities(before, {})).not.toThrow();
      const filename = '055_add_generation_batches.sql';
      await copyFile(join(process.cwd(), 'migrations', filename), join(directory, filename));
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const after = await attestRuntimeSchema(database);
      expect(after.repositoryProfile).toBe(before.repositoryProfile);
      expect(after.capabilities.generationBatches).toBe(true);
      expect(() => assertAttestedRuntimeCapabilities(after, {})).not.toThrow();
      expect(() => assertAttestedRuntimeCapabilities(after, { GENERATION_BATCHES_ENABLED: true })).not.toThrow();

      await copyFile(
        join(process.cwd(), 'migrations', '056_add_work_creation_metadata.sql'),
        join(directory, '056_add_work_creation_metadata.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');
      await copyFile(
        join(process.cwd(), 'migrations', '057_add_work_bootstrap_request_ledger.sql'),
        join(directory, '057_add_work_bootstrap_request_ledger.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');
      await copyFile(
        join(process.cwd(), 'migrations', '058_preserve_work_bootstrap_request_scope.sql'),
        join(directory, '058_preserve_work_bootstrap_request_scope.sql'),
      );
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const afterWorkBootstrap = await attestRuntimeSchema(database);
      expect(afterWorkBootstrap.repositoryProfile).toBe(before.repositoryProfile);
      expect(afterWorkBootstrap.capabilities.workBootstrap).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 120_000);

  it('049までの別schemaは履歴として認識するが050なしでは起動を拒否する', async () => {
    const { database } = await isolatedDatabase('historical49');
    const directory = await mkdtemp(join(tmpdir(), 'lyra-migrations-'));
    try {
      for (const filename of await readdir(join(process.cwd(), 'migrations'))) {
        if (/^0(?:0[1-9]|[1-4][0-9])_.+\.sql$/u.test(filename)) await copyFile(join(process.cwd(), 'migrations', filename), join(directory, filename));
      }
      await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: directory }));
      const historicalRuntime = await attestRuntimeSchema(database);
      expect(() => assertAttestedRuntimeCapabilities(historicalRuntime, {})).toThrow('050');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 120_000);

  it('2debe production lineage schemaをread-onlyで拒否しmigration receiptを変えない', async () => {
    const { pool, database } = await isolatedDatabase('legacy');
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: join(process.cwd(), 'tests/fixtures/production-lineage-2debe'),
    }));
    const before = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');

    let failure: unknown;
    try {
      await attestCanonicalRuntimeSchema(database);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Runtime schema attestation failed: SCHEMA_UNSUPPORTED',
    );
    const after = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(after.rows).toEqual(before.rows);
    expect((await pool.query("SELECT to_regclass(format('%I.%I',CURRENT_SCHEMA(),'export_jobs')) AS relation")).rows[0]?.relation).toBe('export_jobs');
    expect((await pool.query("SELECT to_regclass(format('%I.%I',CURRENT_SCHEMA(),'episode_export_jobs')) AS relation")).rows[0]?.relation).toBeNull();
  }, 120_000);

  it('tableがない途中DDL schemaでもAUTO migrationを開始しない', async () => {
    const { pool, database } = await isolatedDatabase('partial');
    await pool.query('CREATE SEQUENCE partial_runtime_sequence');
    await pool.query("CREATE TYPE partial_runtime_state AS ENUM ('partial')");
    await pool.query('CREATE DOMAIN partial_runtime_identifier AS text');
    await pool.query(`
      CREATE FUNCTION partial_runtime_guard() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$
    `);
    const catalog = await readRuntimeSchemaCatalog(database);
    expect(catalog.relations).toContainEqual({ name: 'partial_runtime_sequence', kind: 'S' });
    expect(catalog.namespaceArtifacts).toEqual(expect.arrayContaining([
      { kind: 'function', name: 'partial_runtime_guard()' },
      { kind: 'type', name: 'partial_runtime_identifier' },
      { kind: 'type', name: 'partial_runtime_state' },
    ]));
    let migrationCalls = 0;
    let failure: unknown;
    try {
      await prepareCanonicalRuntimeSchema({
        database,
        autoRunMigrations: true,
        runMigrations: async () => {
          migrationCalls += 1;
          return [];
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Runtime schema attestation failed: SCHEMA_UNSUPPORTED',
    );
    expect(migrationCalls).toBe(0);
  });

  it('migration lock tableと同名のsequenceでもempty扱いせずAUTO migrationを開始しない', async () => {
    const { pool, database } = await isolatedDatabase('relation_kind');
    await pool.query('CREATE SEQUENCE schema_migration_locks');
    let migrationCalls = 0;
    let failure: unknown;
    try {
      await prepareCanonicalRuntimeSchema({
        database,
        autoRunMigrations: true,
        runMigrations: async () => {
          migrationCalls += 1;
          return [];
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Runtime schema attestation failed: SCHEMA_UNSUPPORTED',
    );
    expect(migrationCalls).toBe(0);
  });

  async function isolatedDatabase(label: string): Promise<{ pool: Pool; database: DatabaseClient & TransactionRunner }> {
    const schema = `runtime_attest_${label}_${randomUUID().replaceAll('-', '')}`;
    schemas.push(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 4,
    });
    pools.push(pool);
    return { pool, database: adapter(pool) };
  }
});

function adapter(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) =>
      pool.query<T>(sql, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const value = await work({
          query: <R extends QueryResultRow>(sql: string, values?: readonly unknown[]) =>
            connection.query<R>(sql, values === undefined ? undefined : [...values]),
        });
        await connection.query('COMMIT');
        return value;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
