import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseClient, TransactionRunner } from './db.js';

export interface MigrationRunnerPort extends DatabaseClient, TransactionRunner {}

export async function runPendingMigrations(
  db: MigrationRunnerPort,
  options?: {
    migrationsDir?: string;
  },
): Promise<string[]> {
  const migrationsDir = options?.migrationsDir ?? join(process.cwd(), 'migrations');

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedResult = await db.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const appliedFilenames = new Set(appliedResult.rows.map((row) => row.filename));
  const migrationFilenames = (await readdir(migrationsDir))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const appliedNow: string[] = [];

  for (const filename of migrationFilenames) {
    if (appliedFilenames.has(filename)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    });

    appliedNow.push(filename);
  }

  return appliedNow;
}
