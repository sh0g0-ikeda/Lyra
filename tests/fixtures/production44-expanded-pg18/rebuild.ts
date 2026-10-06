// Explicit artificial PG18 fixture rebuild; never a production migration entrypoint.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { readRuntimeSchemaCatalogInTransaction, type RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';
import { describeProduction44RuntimeSchema } from '../../../src/lib/production44RuntimeSchemaAttestation.js';
import { runPendingMigrations } from '../../../src/lib/migrations.js';
if (process.env.APP_ENV !== 'test' || process.env.DATABASE_URL !== 'postgresql://postgres@127.0.0.1:15436/postgres') throw new Error('ARTIFICIAL_LOCAL_DATABASE_REQUIRED');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const session = await pool.connect();
const schema = 'expanded_fixture_' + randomUUID().replaceAll('-', '');
const filenames = ['040_add_entity_state_variants.sql', '041_add_episode_starting_entity_states.sql', '042_add_generation_quotes.sql', '043_add_quoted_import_analysis_jobs.sql', '044_add_google_identity_link_challenges.sql', '045_add_mobile_subscription_scheduled_plan_compatibility.sql', '047_add_state_reference_copy_attempts.sql', '048_advance_entity_state_revision_for_legacy_writers.sql'];
const checkpoints: Array<Record<string, string>> = [];
const migrations: Array<{ filename: string; sha256: string }> = [];
const timings: Array<{ filename: string; milliseconds: number }> = [];
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') { const r = value as Record<string, unknown>; return Object.fromEntries(Object.keys(r).sort().map(k => [k, normalize(r[k])])); }
  return value;
}
function signatures(catalog: RuntimeSchemaCatalog): Record<string, string> {
  return Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, createHash('sha256').update(JSON.stringify((rows as unknown[]).map(row => JSON.stringify(normalize(row))).sort())).digest('hex')]));
}
try {
  await session.query('CREATE SCHEMA ' + schema);
  await session.query('SET search_path TO ' + schema + ',public');
  await session.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE schema_migration_locks(name TEXT PRIMARY KEY,locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/production44-pg18/manifest.json'), 'utf8')) as { migrations: Array<{ filename: string; sha256: string }> };
  for (const item of manifest.migrations) {
    const sql = await readFile(join(process.cwd(), 'tests/fixtures/production44-pg18', item.filename));
    if (createHash('sha256').update(sql).digest('hex') !== item.sha256) throw new Error('IMMUTABLE_FIXTURE_MISMATCH');
  }
  await runPendingMigrations({ query: session.query.bind(session), transaction: async work => {
    await session.query('BEGIN');
    try { const result = await work(session); await session.query('COMMIT'); return result; }
    catch (error) { await session.query('ROLLBACK'); throw error; }
  } }, { migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18') });
  let catalog = await readRuntimeSchemaCatalogInTransaction(session, { includeFunctionBodies: true, includeLegacyAttributes: true });
  if (describeProduction44RuntimeSchema(catalog).kind !== 'production44_pg18_v1') throw new Error('ACTUAL44_BASE_MISMATCH');
  checkpoints.push(signatures(catalog));
  for (const filename of filenames) {
    const sql = (await readFile(join(process.cwd(), 'migrations', filename), 'utf8')).replaceAll('\r\n', '\n');
    migrations.push({ filename, sha256: createHash('sha256').update(sql).digest('hex') });
    const started = performance.now();
    await session.query('BEGIN');
    await session.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='30s'");
    await session.query(sql);
    await session.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
    catalog = await readRuntimeSchemaCatalogInTransaction(session, { includeFunctionBodies: true, includeLegacyAttributes: true });
    checkpoints.push(signatures(catalog));
    await session.query('COMMIT');
    timings.push({ filename, milliseconds: Math.round(performance.now() - started) });
  }
  const fixtureRoot = join(process.cwd(), 'tests/fixtures/production44-expanded-pg18');
  await writeFile(join(fixtureRoot, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(join(fixtureRoot, 'checkpoints.json'), JSON.stringify({ migrations, checkpoints }, null, 2) + '\n');
  await writeFile(join(process.cwd(), 'src/lib/production44ExpandedRuntimeSchemaDescriptor.ts'), '// Exact PG18 actual44 + forward additions; local-only fixture rebuild.\nexport const PRODUCTION44_EXPANSION_MIGRATIONS = ' + JSON.stringify(migrations, null, 2) + ' as const;\nexport const PRODUCTION44_EXPANSION_CHECKPOINTS = ' + JSON.stringify(checkpoints, null, 2) + ' as const;\n');
  console.log(JSON.stringify({ artificialOnly: true, migrationCount: catalog.migrationFilenames.length, timings }));
} finally {
  await session.query('ROLLBACK');
  await session.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  session.release();
  await pool.end();
}
