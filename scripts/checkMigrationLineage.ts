import { pathToFileURL } from 'node:url';
import type { DatabaseClient, TransactionRunner } from '../src/lib/db.js';
import {
  inspectMigrationLineage,
  type MigrationLineageOptions,
  type MigrationLineageReport,
} from '../src/lib/migrationLineage.js';

/** A repeatable, DB-enforced read-only view; never creates migration metadata. */
export async function checkMigrationLineage(
  database: DatabaseClient & TransactionRunner,
  options: MigrationLineageOptions = {},
): Promise<MigrationLineageReport> {
  return database.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return inspectMigrationLineage(client, options);
  });
}

async function main(): Promise<void> {
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();
  const { closeDatabasePool, db } = await import('../src/lib/db.js');
  const { env } = await import('../src/lib/env.js');
  try {
    const report = await checkMigrationLineage(db, {
      accountDeletionIdentityHashSecret: env.ACCOUNT_DELETION_IDENTITY_HASH_SECRET,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length > 0) process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Database errors may contain row values. This command is aggregate-only.
    console.error('Migration lineage inspection failed; no row details are emitted');
    process.exitCode = 1;
  });
}
