import { db } from '../src/lib/db.js';
import { runPendingMigrations } from '../src/lib/migrations.js';

const applied = await runPendingMigrations(db);

for (const filename of applied) {
  console.log(`Applied migration ${filename}`);
}

console.log(applied.length === 0 ? 'No pending migrations' : 'Migrations complete');
