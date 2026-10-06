import { Pool } from 'pg';
import { buildDatabasePoolConfig, closeDatabasePool, readDatabaseSslCaFile } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { runProduction44Expansion } from '../src/lib/migrations.js';

// Explicit operator command only. This never changes runtime feature admission.
if (process.argv.slice(2).join(' ') !== '--apply-attested-production44-expansion') {
  throw new Error('Explicit production44 expansion argument required');
}
const pool = new Pool(buildDatabasePoolConfig({
  connectionString: env.DATABASE_URL, max: 1, sslMode: env.DATABASE_SSL_MODE,
  sslCa: readDatabaseSslCaFile(env.DATABASE_SSL_CA_FILE), statementTimeoutMs: 30_000, queryTimeoutMs: 35_000,
}));
try {
  const applied = await runProduction44Expansion(pool);
  console.log(JSON.stringify({ expandedSchemaVerified: true, appliedMigrationCount: applied.length, runtimeActivation: false }));
} catch {
  console.error('Production44 expansion failed; inspect the exact checkpoint before retrying');
  process.exitCode = 1;
} finally {
  await pool.end();
  await closeDatabasePool();
}
