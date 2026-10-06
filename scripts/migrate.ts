import { closeDatabasePool, db } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { runPendingMigrations } from '../src/lib/migrations.js';
import { parseMigrationOptions } from './migrationOptions.js';

try {
  const applied = await runPendingMigrations(db, {
    ...parseMigrationOptions(process.argv.slice(2)),
    accountDeletionIdentityHashSecret: env.ACCOUNT_DELETION_IDENTITY_HASH_SECRET,
  });
  for (const filename of applied) {
    console.log(`Applied migration ${filename}`);
  }
  console.log(applied.length === 0 ? 'No pending migrations' : 'Migrations complete');
} finally {
  await closeDatabasePool();
}
