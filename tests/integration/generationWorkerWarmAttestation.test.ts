import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations, runProduction44Expansion } from '../../src/lib/migrations.js';
import { attestRuntimeSchema, describeRuntimeSchema, readRuntimeSchemaCatalog } from '../../src/lib/runtimeSchemaAttestation.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const url = process.env.DATABASE_URL;
const migration = '052_add_generation_worker_warm_control.sql';
function isSyntheticTarget(): boolean {
  if (process.env.APP_ENV !== 'test' || url === undefined) return false;
  const address = new URL(url);
  return ['postgres:', 'postgresql:'].includes(address.protocol)
    && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(address.hostname)
    && address.pathname === '/lyra_test' && address.search === '' && address.hash === ''
    && (['15432', '15433', '15435'].includes(address.port)
      || (process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && ['5432', '5433'].includes(address.port)));
}

const suite = isSyntheticTarget() ? describe : describe.skip;
for (const profile of ['canonical', 'expanded'] as const) suite(`generation worker warm attestation ${profile}`, () => {
  const schema = 'warm_attest_' + randomUUID().replaceAll('-', '');
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let database: DatabaseClient & TransactionRunner;
  let unsupportedVersion = false;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    const version = await admin.query<{ version: string }>("SELECT current_setting('server_version_num') AS version");
    unsupportedVersion = profile === 'expanded' && Number(version.rows[0]?.version) < 180000;
    if (unsupportedVersion) return;
    await admin.query('CREATE SCHEMA ' + schema);
    const schemaPool = new Pool({ connectionString: url, options: '-c search_path=' + schema + ',public', max: 3 });
    pool = schemaPool;
    database = {
      query: schemaPool.query.bind(schemaPool),
      transaction: async <T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> => {
        const client = await schemaPool.connect();
        try {
          await client.query('BEGIN');
          const result = await operation({ query: client.query.bind(client) });
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    };
    await withPostgresTestMigrationLock(admin, async () => {
      await runPendingMigrations(database, profile === 'canonical' ? undefined : { migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18') });
      if (profile === 'expanded') {
        await runProduction44Expansion(schemaPool);
        for (const filename of ['051_add_google_link_recovery.sql', migration]) {
          await database.transaction(async client => {
            await client.query(await readFile(join(process.cwd(), 'migrations', filename), 'utf8'));
            await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
          });
        }
      }
    });
  }, 180_000);

  beforeEach(context => { if (unsupportedVersion) context.skip(); });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      if (!unsupportedVersion) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  });

  async function withChangedSchema(sql: string, operation: (runner: TransactionRunner) => Promise<void>): Promise<void> {
    if (pool === undefined) throw new Error('Test schema is not initialized');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await operation({ transaction: work => work({ query: client.query.bind(client) }) });
    } finally { await client.query('ROLLBACK'); client.release(); }
  }

  it('実DDLの052を追加した場合に既存profileと全capabilityを維持する', async () => {
    const expanded = await attestRuntimeSchema(database);
    expect(expanded.repositoryProfile).toBe(profile === 'canonical' ? 'canonical' : 'production44_expanded_pg18_v1');
    expect(expanded.capabilities).toEqual({ entityStateMonotonicRevision: true, stripeCreditRecovery: true, workDeletion: true, googleIdentityRecovery: true });
    await withChangedSchema(`DROP TABLE generation_worker_warm_controls; DELETE FROM schema_migrations WHERE filename='${migration}'`, async runner => {
      expect(await attestRuntimeSchema(runner)).toEqual(expanded);
    });
  });

  it('カタログを複製して同一transactionのversion証跡を失った場合に拒否する', async () => {
    const catalog = await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true });
    expect(describeRuntimeSchema({ ...catalog })).toEqual({ kind: 'unsupported', failures: ['GENERATION_WORKER_WARM_SCHEMA_MISMATCH'] });
  });

  it.each([
    ['table欠落', 'DROP TABLE generation_worker_warm_controls'],
    ['別名table', 'ALTER TABLE generation_worker_warm_controls RENAME TO other_warm_controls'],
    ['view偽装', 'DROP TABLE generation_worker_warm_controls; CREATE VIEW generation_worker_warm_controls AS SELECT NULL::text AS resource_id'],
    ['列欠落', 'ALTER TABLE generation_worker_warm_controls DROP COLUMN lease_until'],
    ['追加列', 'ALTER TABLE generation_worker_warm_controls ADD COLUMN unexpected text'],
    ['列型変更', 'ALTER TABLE generation_worker_warm_controls ALTER COLUMN resource_id TYPE varchar(200)'],
    ['domain型偽装', 'CREATE DOMAIN warm_resource_domain AS text; ALTER TABLE generation_worker_warm_controls ALTER COLUMN resource_id TYPE warm_resource_domain'],
    ['default変更', 'ALTER TABLE generation_worker_warm_controls ALTER COLUMN updated_at SET DEFAULT now()'],
    ['NULL許可', 'ALTER TABLE generation_worker_warm_controls ALTER COLUMN updated_at DROP NOT NULL'],
    ['CHECK欠落', 'ALTER TABLE generation_worker_warm_controls DROP CONSTRAINT generation_worker_warm_controls_resource_id_check'],
    ['CHECK変更', 'ALTER TABLE generation_worker_warm_controls DROP CONSTRAINT generation_worker_warm_controls_last_applied_floor_check; ALTER TABLE generation_worker_warm_controls ADD CONSTRAINT generation_worker_warm_controls_last_applied_floor_check CHECK(last_applied_floor IN (0,1,2))'],
    ['CHECK未検証', 'ALTER TABLE generation_worker_warm_controls DROP CONSTRAINT generation_worker_warm_controls_resource_id_check; ALTER TABLE generation_worker_warm_controls ADD CONSTRAINT generation_worker_warm_controls_resource_id_check CHECK(length(resource_id) BETWEEN 1 AND 200) NOT VALID'],
    ['PK欠落', 'ALTER TABLE generation_worker_warm_controls DROP CONSTRAINT generation_worker_warm_controls_pkey'],
    ['追加index', 'CREATE INDEX warm_extra_index ON generation_worker_warm_controls(lease_until)'],
    ['PK INCLUDE変更', 'ALTER TABLE generation_worker_warm_controls DROP CONSTRAINT generation_worker_warm_controls_pkey; ALTER TABLE generation_worker_warm_controls ADD PRIMARY KEY(resource_id) INCLUDE(lease_until)'],
    ['追加trigger', 'CREATE TRIGGER unexpected_warm_trigger BEFORE UPDATE ON generation_worker_warm_controls FOR EACH ROW EXECUTE FUNCTION lyra_advance_entity_state_revision()'],
    ['RLS変更', 'ALTER TABLE generation_worker_warm_controls ENABLE ROW LEVEL SECURITY'],
    ['追加policy', 'CREATE POLICY unexpected_warm_policy ON generation_worker_warm_controls USING(true)'],
    ['追加rule', 'CREATE RULE unexpected_warm_rule AS ON DELETE TO generation_worker_warm_controls DO INSTEAD NOTHING'],
    ['UNLOGGED変更', 'ALTER TABLE generation_worker_warm_controls SET UNLOGGED'],
    ['履歴欠落', `DELETE FROM schema_migrations WHERE filename='${migration}'`],
    ['履歴重複', `ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_pkey; INSERT INTO schema_migrations(filename) VALUES('${migration}')`],
    ['051履歴欠落', "DELETE FROM schema_migrations WHERE filename='051_add_google_link_recovery.sql'"],
    ['追加warm名前空間artifact', "CREATE TYPE generation_worker_warm_controls_extra AS ENUM ('invalid')"],
    ['既存guard変更', 'ALTER TABLE entity_states DISABLE TRIGGER entity_states_monotonic_revision'],
  ])('%sの場合に認定を拒否する', async (contextName, sql) => {
    await withChangedSchema(sql, async runner => {
      await expect(attestRuntimeSchema(runner), contextName).rejects.toThrow('SCHEMA_UNSUPPORTED');
    });
  });
});
