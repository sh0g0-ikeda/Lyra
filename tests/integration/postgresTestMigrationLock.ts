import type { Pool } from 'pg';

const MIGRATION_LOCK_NAMESPACE = 1280922188;
const MIGRATION_LOCK_ID = 1;
const MIGRATION_LOCK_POLL_MS = 25;
const MIGRATION_LOCK_TIMEOUT_MS = 120_000;

export interface PostgresTestMigrationLockLease {
  release(): Promise<void>;
}

export async function acquirePostgresTestMigrationLock(
  pool: Pool,
  timeoutMs = MIGRATION_LOCK_TIMEOUT_MS,
): Promise<PostgresTestMigrationLockLease> {
  const client = await pool.connect();
  let acquired = false;

  try {
    const deadline = Date.now() + timeoutMs;
    while (!acquired && Date.now() < deadline) {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
        [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID],
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) {
        await new Promise<void>((resolve) => setTimeout(resolve, MIGRATION_LOCK_POLL_MS));
      }
    }

    if (!acquired) {
      throw new Error('Timed out waiting for the PostgreSQL integration migration lock');
    }

    let released = false;
    return { release: async (): Promise<void> => {
      if (released) return;
      released = true;
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1::int, $2::int)',
          [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID],
        );
        client.release();
      } catch (error) {
        client.release(true);
        throw error;
      }
    } };
  } catch (error) {
    client.release(true);
    throw error;
  }
}

export async function withPostgresTestMigrationLock<T>(
  pool: Pool,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquirePostgresTestMigrationLock(pool);
  try { return await operation(); }
  finally { await lease.release(); }
}
