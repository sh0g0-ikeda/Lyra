import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import {
  readRuntimeSchemaCatalog,
  describeRuntimeSchema,
  type RuntimeSchemaCatalog,
} from '../../src/lib/runtimeSchemaAttestation.js';
import { attestLegacyRuntimeSchema, describeLegacyRuntimeSchema } from '../../src/lib/legacyRuntimeSchemaAttestation.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;

/** Reference is artificial committed old38 only; it does not prove production lineage or unlock runtime. */
describePostgres('旧38 runtime descriptor PostgreSQL boundary', () => {
  let admin: Pool;
  const pools: Pool[] = [];
  const schemas: string[] = [];
  beforeAll(() => { admin = new Pool({ connectionString: databaseUrl }); });
  afterAll(async () => {
    for (const pool of pools) await pool.end();
    for (const schema of schemas) {
      if (!/^legacy_runtime_attest_[a-f0-9]{32}$/u.test(schema)) throw new Error('Invalid owned test schema');
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    }
    await admin.end();
  }, 120_000);

  it('旧38をread-only照合する場合にactive jobを理由に拒否せずDDLやrowを変えない', async () => {
    const { pool, database } = await isolatedDatabase();
    const userId = randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, 'legacy-attest-' + userId, userId + '@example.invalid']);
    await pool.query("INSERT INTO generation_jobs(user_id,job_type,status,credit_cost,params) VALUES($1,'page_generate','queued',0,'{}')", [userId]);
    const beforeCatalog = await readLegacyCatalog(database);
    const beforeRows = await pool.query('SELECT id,status,params FROM generation_jobs ORDER BY id');
    expect(describeLegacyRuntimeSchema(beforeCatalog)).toEqual({ kind: 'legacy_2debe_v1', failures: [] });
    expect(await attestLegacyRuntimeSchema(database)).toBe('legacy_2debe_v1');
    expect(await readLegacyCatalog(database)).toEqual(beforeCatalog);
    expect((await pool.query('SELECT id,status,params FROM generation_jobs ORDER BY id')).rows).toEqual(beforeRows.rows);
    expect(describeRuntimeSchema(beforeCatalog).kind).toBe('unsupported');
  }, 120_000);

  it('同名返還functionでも本文が違う場合に照合で拒否しrowを変更しない', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('CREATE OR REPLACE FUNCTION refund_late_canceled_generation_job_consume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
    const before = await readLegacyCatalog(database);
    expect(describeLegacyRuntimeSchema(before).failures).toContain('LEGACY_FUNCTIONS_MISMATCH');
    let failure: unknown;
    try { await attestLegacyRuntimeSchema(database); } catch (error) { failure = error; }
    expect((failure as Error).message).toBe('Runtime legacy schema attestation failed: SCHEMA_UNSUPPORTED');
    expect(await readLegacyCatalog(database)).toEqual(before);
  }, 120_000);

  it('late refund triggerが無効なら旧38履歴が正しくても拒否する', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('ALTER TABLE credit_ledger DISABLE TRIGGER generation_job_late_consume_refund');
    expect(describeLegacyRuntimeSchema(await readLegacyCatalog(database)).failures).toContain('LEGACY_TRIGGERS_MISMATCH');
  }, 120_000);

  it('旧DBに新quote relationが混ざった場合にmigration履歴だけで許可しない', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('CREATE TABLE generation_quotes (id uuid PRIMARY KEY)');
    expect(describeLegacyRuntimeSchema(await readLegacyCatalog(database)).kind).toBe('unsupported');
  }, 120_000);

  it('physical page metadata列を失った場合に旧runtime候補として拒否する', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('ALTER TABLE pages DROP COLUMN story_page_purpose');
    expect(describeLegacyRuntimeSchema(await readLegacyCatalog(database)).failures).toContain('LEGACY_COLUMNS_MISMATCH');
  }, 120_000);

  it('users.id default欠落はwriter開始前に拒否する', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('ALTER TABLE users ALTER COLUMN id DROP DEFAULT');

    expect(await refuseBeforeWriter(database)).toBe(0);
  }, 120_000);

  it('同じ本文のrefund functionでもIMMUTABLEならwriter開始前に拒否する', async () => {
    const { pool, database } = await isolatedDatabase();
    const before = await readLegacyCatalog(database);
    const beforeFunction = before.functions?.find(
      row => row.name === 'refund_late_canceled_generation_job_consume',
    );
    await pool.query(
      'ALTER FUNCTION refund_late_canceled_generation_job_consume() IMMUTABLE',
    );
    const after = await readLegacyCatalog(database);
    expect(after.functions?.find(
      row => row.name === 'refund_late_canceled_generation_job_consume',
    )?.bodySha256).toBe(beforeFunction?.bodySha256);

    expect(await refuseBeforeWriter(database)).toBe(0);
  }, 120_000);

  it.each([
    'ENABLE ROW LEVEL SECURITY',
    'FORCE ROW LEVEL SECURITY',
  ])('users relationの %s はwriter開始前に拒否する', async (command) => {
    const { pool, database } = await isolatedDatabase();
    await pool.query(`ALTER TABLE users ${command}`);

    expect(await refuseBeforeWriter(database)).toBe(0);
  }, 120_000);

  it('procedureの関数情報もnullではなく明示したreturn typeで読む', async () => {
    const { pool, database } = await isolatedDatabase();
    await pool.query('CREATE PROCEDURE legacy_attestation_probe() LANGUAGE plpgsql AS $$ BEGIN NULL; END $$');
    const catalog = await readLegacyCatalog(database);
    expect(catalog.functions?.find(row => row.name === 'legacy_attestation_probe')?.returnType).toBe('procedure');
    expect(describeLegacyRuntimeSchema(catalog).kind).toBe('unsupported');
  }, 120_000);

  async function isolatedDatabase(): Promise<{ pool: Pool; database: DatabaseClient & TransactionRunner }> {
    const schema = 'legacy_runtime_attest_' + randomUUID().replaceAll('-', '');
    if (!/^legacy_runtime_attest_[a-f0-9]{32}$/u.test(schema)) throw new Error('Invalid owned test schema');
    schemas.push(schema); await admin.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema + ',public' }); pools.push(pool);
    const database: DatabaseClient & TransactionRunner = {
      query: async <R extends QueryResultRow>(sql: string, params?: unknown[]) => pool.query<R>(sql, params),
      transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const value = await work({ query: async <R extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<R>(sql, params) }); await client.query('COMMIT'); return value; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    };
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: join(process.cwd(), 'tests/fixtures/production-lineage-2debe') }));
    return { pool, database };
  }

  async function refuseBeforeWriter(database: TransactionRunner): Promise<number> {
    let writerStarts = 0;
    let failure: unknown;
    try {
      await attestLegacyRuntimeSchema(database);
      writerStarts += 1;
    } catch (error) {
      failure = error;
    }
    expect((failure as Error | undefined)?.message).toBe(
      'Runtime legacy schema attestation failed: SCHEMA_UNSUPPORTED',
    );
    return writerStarts;
  }

  function readLegacyCatalog(database: TransactionRunner): Promise<RuntimeSchemaCatalog> {
    return readRuntimeSchemaCatalog(database, {
      includeFunctionBodies: true,
      includeLegacyAttributes: true,
    });
  }
});
