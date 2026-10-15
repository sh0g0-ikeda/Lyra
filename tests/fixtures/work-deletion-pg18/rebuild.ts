// Explicit artificial PG18 fixture rebuild; never a production migration entrypoint.
import { mkdir, writeFile } from 'node:fs/promises';
import { createSyntheticPostgresDatabase } from '../../integration/postgresTestDatabase.js';
import { runPendingMigrations } from '../../../src/lib/migrations.js';
import { readRuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';

if (process.env.APP_ENV !== 'test' || process.env.DATABASE_URL !== 'postgresql://postgres@127.0.0.1:15433/lyra_test') {
  throw new Error('ARTIFICIAL_LOCAL_DATABASE_REQUIRED');
}

const database = await createSyntheticPostgresDatabase({
  databaseUrl: process.env.DATABASE_URL,
  prefix: 'releasecompat',
});

try {
  await runPendingMigrations(database.database);
  const catalog = await readRuntimeSchemaCatalog(database.database, {
    includeFunctionBodies: true,
    includeLegacyAttributes: true,
  });
  const ownsRelation = (relation: string): boolean =>
    relation.startsWith('work_deletion_')
    || relation === 'work_storage_operations'
    || relation === 'work_resource_ownership';
  const required = {
    relations: catalog.relations.filter((row) => ownsRelation(row.name)),
    columns: catalog.columns.filter((row) => ownsRelation(row.relation) || (row.relation === 'works' && row.name === 'deletion_started_at')),
    constraints: catalog.constraints.filter((row) => ownsRelation(row.relation) || row.relation === 'state_reference_copy_attempts'),
    indexes: catalog.indexes.filter((row) => ownsRelation(row.relation)),
    triggers: catalog.triggers.filter((row) => row.name === 'work_deletion_write_guard' || row.name === 'work_resource_ownership'),
    functions: catalog.functions?.filter((row) =>
      row.name.startsWith('lyra_work_')
      || row.name === 'lyra_resource_work_id'
      || row.name === 'lyra_guard_work_deletion'
      || row.name === 'lyra_guard_state_copy_v2_journal'
      || row.name === 'lyra_record_work_resource_ownership') ?? [],
  };
  await mkdir('tests/fixtures/work-deletion-pg18', { recursive: true });
  await writeFile('tests/fixtures/work-deletion-pg18/canonical-catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(
    'src/lib/workDeletionSchemaDescriptor.ts',
    `// Generated from isolated PostgreSQL 18.3 with migration 050; never copied from production.\nexport const WORK_DELETION_SCHEMA = ${JSON.stringify(required, null, 2)} as const;\n`,
  );
  console.log(JSON.stringify({ artificialOnly: true, tables: required.relations.length, functions: required.functions.length }));
} finally {
  await database.close();
}
