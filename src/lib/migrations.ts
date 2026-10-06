import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigurationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from './db.js';
import { reconcileProductionLineage } from './migrationLineage.js';
import { createHash } from 'node:crypto';
import { readRuntimeSchemaCatalogInTransaction } from './runtimeSchemaAttestation.js';
import { describeProduction44ExpansionCheckpoint } from './production44ExpandedRuntimeSchemaAttestation.js';
import { PRODUCTION44_EXPANSION_MIGRATIONS } from './production44ExpandedRuntimeSchemaDescriptor.js';

export interface MigrationRunnerPort extends DatabaseClient, TransactionRunner {}

const MIGRATION_LOCK_NAME = 'schema_migrations';
const DEFAULT_MIGRATION_LOCK_STALE_SECONDS = 15 * 60;
const DEFAULT_MIGRATION_LOCK_POLL_MS = 250;
const DEFAULT_MIGRATION_LOCK_MAX_ATTEMPTS = 240;

export interface Production44ExpansionPool {
  connect(): Promise<DatabaseClient & { release(destroy?: boolean): void }>;
}

/** Spec 11 C0: explicit forward-only path; ordinary migration behavior is unchanged.
 * A pinned session owns the advisory lock across file transactions. The existing
 * migration row excludes ordinary runners too; it is refreshed every checkpoint.
 * Every SQL file and pre/post catalog is exact. A failed file rolls back atomically.
 */
export async function runProduction44Expansion(
  pool: Production44ExpansionPool,
  options: { migrationsDir?: string } = {},
): Promise<string[]> {
  const sqlFiles: string[] = [];
  try {
    for (const item of PRODUCTION44_EXPANSION_MIGRATIONS) {
      const sql = (await readFile(join(options.migrationsDir ?? join(process.cwd(), 'migrations'), item.filename), 'utf8')).replaceAll('\r\n', '\n');
      if (createHash('sha256').update(sql).digest('hex') !== item.sha256) throw new Error('mismatch');
      sqlFiles.push(sql);
    }
  } catch {
    throw new ConfigurationError('Production44 expansion failed: MIGRATION_FILE_MISMATCH');
  }
  let session: Awaited<ReturnType<Production44ExpansionPool['connect']>>;
  try { session = await pool.connect(); }
  catch { throw new ConfigurationError('Production44 expansion failed: CONNECTION_FAILED'); }
  let leaseToken: string | null = null;
  const applied: string[] = [];
  try {
    await session.query("SET statement_timeout='30s'; SET lock_timeout='1s'; SET idle_in_transaction_session_timeout='30s'");
    const lock = await session.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(1744048, 52) AS acquired');
    if (lock.rows[0]?.acquired !== true) throw new Error('busy');
    const readCheckpoint = async (): Promise<number> => {
      const catalog = await readRuntimeSchemaCatalogInTransaction(session, { includeFunctionBodies: true, includeLegacyAttributes: true });
      const checkpoint = describeProduction44ExpansionCheckpoint(catalog);
      if (checkpoint === null) throw new Error('unsupported');
      return checkpoint;
    };
    await session.query('BEGIN READ ONLY');
    await readCheckpoint();
    await session.query('COMMIT');
    const row = await session.query<{ token: string }>("INSERT INTO schema_migration_locks(name) VALUES($1) ON CONFLICT DO NOTHING RETURNING locked_at::text AS token", [MIGRATION_LOCK_NAME]);
    if (row.rowCount !== 1) throw new Error('busy');
    leaseToken = row.rows[0]!.token;
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (Date.now() >= deadline) throw new Error('deadline');
      await session.query('BEGIN');
      const owned = await session.query('SELECT name FROM schema_migration_locks WHERE name=$1 AND locked_at=$2::timestamptz FOR UPDATE', [MIGRATION_LOCK_NAME, leaseToken]);
      if (owned.rowCount !== 1) throw new Error('lease lost');
      const checkpoint = await readCheckpoint();
      if (checkpoint === PRODUCTION44_EXPANSION_MIGRATIONS.length) {
        await session.query('COMMIT');
        return applied;
      }
      const migration = PRODUCTION44_EXPANSION_MIGRATIONS[checkpoint]!;
      await session.query(sqlFiles[checkpoint]!);
      await session.query('INSERT INTO schema_migrations(filename) VALUES($1)', [migration.filename]);
      if (await readCheckpoint() !== checkpoint + 1) throw new Error('postcondition');
      const refreshed = await session.query<{ token: string }>('UPDATE schema_migration_locks SET locked_at=clock_timestamp() WHERE name=$1 RETURNING locked_at::text AS token', [MIGRATION_LOCK_NAME]);
      await session.query('COMMIT');
      leaseToken = refreshed.rows[0]!.token;
      applied.push(migration.filename);
    }
  } catch {
    throw new ConfigurationError('Production44 expansion failed: CHECKPOINT_OR_MIGRATION_REJECTED');
  } finally {
    try {
      await session.query('ROLLBACK');
      if (leaseToken !== null) await session.query('DELETE FROM schema_migration_locks WHERE name=$1 AND locked_at=$2::timestamptz', [MIGRATION_LOCK_NAME, leaseToken]);
    } catch {
      throw new ConfigurationError('Production44 expansion failed: CLEANUP_FAILED');
    } finally {
      // Destroying this dedicated session also releases its advisory lock even
      // after a connection/cleanup failure; never return altered GUCs to the pool.
      session.release(true);
    }
  }
}

export async function runPendingMigrations(
  db: MigrationRunnerPort,
  options?: {
    migrationsDir?: string;
    migrationLockPollMs?: number;
    migrationLockMaxAttempts?: number;
    migrationLockStaleSeconds?: number;
    allowProductionLineageBridge?: boolean;
    accountDeletionIdentityHashSecret?: string;
  },
): Promise<string[]> {
  const migrationsDir = options?.migrationsDir ?? join(process.cwd(), 'migrations');

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migration_locks (
      name TEXT PRIMARY KEY,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await acquireMigrationLock(db, {
    pollMs: options?.migrationLockPollMs ?? DEFAULT_MIGRATION_LOCK_POLL_MS,
    maxAttempts: options?.migrationLockMaxAttempts ?? DEFAULT_MIGRATION_LOCK_MAX_ATTEMPTS,
    staleSeconds: options?.migrationLockStaleSeconds ?? DEFAULT_MIGRATION_LOCK_STALE_SECONDS,
  });

  try {
    return await runPendingMigrationsWithLock(db, migrationsDir, options);
  } finally {
    await releaseMigrationLock(db);
  }
}

async function runPendingMigrationsWithLock(
  db: MigrationRunnerPort,
  migrationsDir: string,
  lineageOptions?: { allowProductionLineageBridge?: boolean; accountDeletionIdentityHashSecret?: string },
): Promise<string[]> {
  const appliedResult = await db.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const appliedFilenames = new Set(appliedResult.rows.map((row) => row.filename));
  const migrationFilenames = (await readdir(migrationsDir))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const appliedNow = await reconcileProductionLineage(
    db, { ...lineageOptions, migrationsDir }, appliedFilenames, new Set(migrationFilenames),
  );

  for (const filename of migrationFilenames) {
    if (appliedFilenames.has(filename)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    if (shouldRunWithoutTransaction(sql)) {
      // PostgreSQL rejects CREATE INDEX CONCURRENTLY when several commands are
      // sent as one query string, even outside our explicit transaction helper.
      for (const statement of splitSqlStatements(sql)) {
        await db.query(statement);
      }
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    } else {
      await db.transaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      });
    }

    appliedNow.push(filename);
  }

  return appliedNow;
}

async function acquireMigrationLock(
  db: DatabaseClient,
  options: {
    pollMs: number;
    maxAttempts: number;
    staleSeconds: number;
  },
): Promise<void> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const result = await db.query<{ acquired: boolean | string }>(
      `
      WITH stale_lock AS (
        DELETE FROM schema_migration_locks
        WHERE name = $1
          AND locked_at < NOW() - ($2::int * INTERVAL '1 second')
        RETURNING name
      ),
      inserted AS (
        INSERT INTO schema_migration_locks (name, locked_at)
        VALUES ($1, NOW())
        ON CONFLICT DO NOTHING
        RETURNING name
      )
      SELECT EXISTS(SELECT 1 FROM inserted) AS acquired
      `,
      [MIGRATION_LOCK_NAME, options.staleSeconds],
    );

    const acquired = result.rows[0]?.acquired;
    if (acquired === true || acquired === 'true') {
      return;
    }

    await sleep(options.pollMs);
  }

  throw new ConfigurationError('Timed out waiting for schema migration lock');
}

async function releaseMigrationLock(db: DatabaseClient): Promise<void> {
  await db.query('DELETE FROM schema_migration_locks WHERE name = $1', [MIGRATION_LOCK_NAME]);
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function shouldRunWithoutTransaction(sql: string): boolean {
  return sql
    .split('\n')
    .slice(0, 5)
    .some((line) => line.trim() === '-- lyra:migration no-transaction');
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let statementStart = 0;
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  while (index < sql.length) {
    const char = sql[index];
    const nextChar = sql[index + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarQuoteTag !== null) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
        index += 2;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      index += 1;
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }

    if (char === '$') {
      const tag = readDollarQuoteTag(sql, index);
      if (tag !== null) {
        dollarQuoteTag = tag;
        index += tag.length;
        continue;
      }
    }

    if (char === ';') {
      const statement = sql.slice(statementStart, index).trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      statementStart = index + 1;
    }

    index += 1;
  }

  const finalStatement = sql.slice(statementStart).trim();
  if (finalStatement.length > 0) {
    statements.push(finalStatement);
  }

  return statements;
}

function readDollarQuoteTag(sql: string, startIndex: number): string | null {
  let index = startIndex + 1;

  while (index < sql.length && /[A-Za-z0-9_]/u.test(sql[index] ?? '')) {
    index += 1;
  }

  if (sql[index] !== '$') {
    return null;
  }

  return sql.slice(startIndex, index + 1);
}
