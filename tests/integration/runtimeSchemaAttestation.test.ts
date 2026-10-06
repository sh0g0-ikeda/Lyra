import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import {
  attestCanonicalRuntimeSchema,
  describeRuntimeSchema,
  prepareCanonicalRuntimeSchema,
  readRuntimeSchemaCatalog,
} from '../../src/lib/runtimeSchemaAttestation.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined
  ? describe
  : describe.skip;

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

    const catalog = await readRuntimeSchemaCatalog(database);
    expect(describeRuntimeSchema(catalog)).toEqual({ kind: 'canonical_fresh_v1', failures: [] });
    const attested = await attestCanonicalRuntimeSchema(database);
    expect(attested).toBe('canonical_fresh_v1');
    const physical = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA() AND table_name = 'pages'
        AND column_name IN ('story_source_scene_ids','story_page_purpose','story_continuity_note')
    `);
    expect(physical.rows).toEqual([]);
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
