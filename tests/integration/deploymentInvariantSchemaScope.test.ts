import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { checkDeploymentDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
function isSyntheticTarget(): boolean {
  if (process.env.APP_ENV !== 'test' || databaseUrl === undefined) return false;
  try {
    const address = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(address.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(address.hostname)
      && address.pathname === '/lyra_test'
      && address.search === ''
      && address.hash === ''
      && (['15432', '15433', '15435'].includes(address.port)
        || (process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && ['5432', '5433'].includes(address.port)));
  } catch {
    return false;
  }
}

const suite = isSyntheticTarget() ? describe : describe.skip;

suite('deployment invariant schema scope', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const appSchema = `invariant_app_${suffix}`;
  const foreignSchema = `invariant_foreign_${suffix}`;
  let admin: Pool;
  let appPool: Pool;
  let database: DatabaseClient & TransactionRunner;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${appSchema}`);
    await admin.query(`CREATE SCHEMA ${foreignSchema}`);
    appPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${appSchema},public`,
      max: 4,
    });
    database = adapter(appPool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${appSchema} CASCADE`);
      await admin.query(`DROP SCHEMA ${foreignSchema} CASCADE`);
      await admin.end();
    }
  });

  it('別schemaのinvalid indexは混入させず現行app schemaのinvalid indexだけを拒否する', async () => {
    const foreignIndex = `foreign_invalid_${suffix}`;
    await leaveInvalidUniqueIndex(admin, foreignSchema, foreignIndex);
    await expectInvalidIndex(admin, foreignSchema, foreignIndex);

    const cleanReport = await checkDeploymentDataInvariants(database);
    expect(cleanReport.violations.find(({ name }) => name === 'database.invalid_indexes')).toBeUndefined();

    const appIndex = `app_invalid_${suffix}`;
    await leaveInvalidUniqueIndex(appPool, appSchema, appIndex);
    await expectInvalidIndex(admin, appSchema, appIndex);

    const invalidReport = await checkDeploymentDataInvariants(database);
    expect(invalidReport.violations).toContainEqual({
      name: 'database.invalid_indexes',
      sampleIds: [appIndex],
    });
  }, 120_000);
});

async function leaveInvalidUniqueIndex(pool: Pool, schema: string, index: string): Promise<void> {
  await pool.query(`CREATE TABLE ${schema}.invalid_index_probe(value integer NOT NULL)`);
  await pool.query(`INSERT INTO ${schema}.invalid_index_probe(value) VALUES (1), (1)`);
  await expect(pool.query(`CREATE UNIQUE INDEX CONCURRENTLY ${index} ON ${schema}.invalid_index_probe(value)`))
    .rejects.toThrow();
}

async function expectInvalidIndex(pool: Pool, schema: string, index: string): Promise<void> {
  const result = await pool.query<{ valid: boolean }>(`
    SELECT schema_index.indisvalid AS valid
    FROM pg_index schema_index
    INNER JOIN pg_class index_relation ON index_relation.oid = schema_index.indexrelid
    INNER JOIN pg_namespace namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = $1 AND index_relation.relname = $2
  `, [schema, index]);
  expect(result.rows).toEqual([{ valid: false }]);
}

function adapter(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) =>
      pool.query<T>(sql, values === undefined ? undefined : [...values]),
    transaction: async <T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const value = await operation({
          query: <R extends QueryResultRow>(sql: string, values?: readonly unknown[]) =>
            connection.query<R>(sql, values === undefined ? undefined : [...values]),
        });
        await connection.query('COMMIT');
        return value;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
