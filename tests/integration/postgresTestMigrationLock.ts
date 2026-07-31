import type { Pool } from 'pg';

const MIGRATION_LOCK_NAMESPACE = 1280922188;
const MIGRATION_LOCK_ID = 1;
const MIGRATION_LOCK_POLL_MS = 25;
const MIGRATION_LOCK_TIMEOUT_MS = 120_000;

export async function withPostgresTestMigrationLock<T>(
  pool: Pool,
  operation: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let acquired = false;

  try {
    const deadline = Date.now() + MIGRATION_LOCK_TIMEOUT_MS;
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

    return await operation();
  } finally {
    if (acquired) {
      await client.query(
        'SELECT pg_advisory_unlock($1::int, $2::int)',
        [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID],
      );
    }
    client.release();
  }
}
