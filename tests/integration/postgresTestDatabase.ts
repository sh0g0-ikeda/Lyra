import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';

const LOCAL_ADMIN_PORTS = new Set(['15432', '15433', '15435']);
const CI_ADMIN_PORTS = new Set(['5432', '5433']);
const SYNTHETIC_DATABASE_NAME = /^lyra_(?:delupload|releasecompat)_[0-9]+_[a-f0-9]{32}$/u;

export interface SyntheticPostgresAdminTargetInput {
  appEnv?: string;
  databaseUrl: string;
  databaseName: string;
  ci?: string;
  githubActions?: string;
  ciAdminAllowed?: string;
}

export interface SyntheticPostgresAdminTarget {
  adminUrl: string;
  databaseUrl: string;
}

export function resolveSyntheticPostgresAdminTarget(
  input: SyntheticPostgresAdminTargetInput,
): SyntheticPostgresAdminTarget {
  if (input.appEnv !== 'test') {
    throw new Error('Synthetic database administration requires APP_ENV=test');
  }
  if (!SYNTHETIC_DATABASE_NAME.test(input.databaseName)) {
    throw new Error('Invalid synthetic database name');
  }

  const address = new URL(input.databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(address.protocol)) {
    throw new Error('Synthetic database administration requires a PostgreSQL URL');
  }
  if (address.search !== '' || address.hash !== '') {
    throw new Error('Synthetic database administration forbids URL query parameters and fragments');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(address.hostname)) {
    throw new Error('Synthetic database administration requires a loopback PostgreSQL host');
  }
  if (address.pathname !== '/lyra_test') {
    throw new Error('Synthetic database administration requires the lyra_test base database');
  }

  if (CI_ADMIN_PORTS.has(address.port)) {
    if (input.ci !== 'true' || input.githubActions !== 'true' || input.ciAdminAllowed !== 'true') {
      throw new Error('CI synthetic database administration is not explicitly allowed');
    }
  } else if (!LOCAL_ADMIN_PORTS.has(address.port)) {
    throw new Error('Synthetic database administration requires an approved local PostgreSQL port');
  }

  const adminAddress = new URL(address);
  adminAddress.pathname = '/postgres';
  const databaseAddress = new URL(address);
  databaseAddress.pathname = `/${input.databaseName}`;
  return { adminUrl: adminAddress.toString(), databaseUrl: databaseAddress.toString() };
}

export type SyntheticPostgresDatabasePrefix = 'delupload' | 'releasecompat';

export interface SyntheticPostgresDatabase {
  pool: Pool;
  database: DatabaseClient & TransactionRunner;
  close(): Promise<void>;
}

export async function createSyntheticPostgresDatabase(input: {
  databaseUrl: string;
  prefix: SyntheticPostgresDatabasePrefix;
  max?: number;
  statementTimeoutMs?: number;
}): Promise<SyntheticPostgresDatabase> {
  const databaseName = `lyra_${input.prefix}_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const target = resolveSyntheticPostgresAdminTarget({
    appEnv: process.env.APP_ENV,
    databaseUrl: input.databaseUrl,
    databaseName,
    ci: process.env.CI,
    githubActions: process.env.GITHUB_ACTIONS,
    ciAdminAllowed: process.env.LYRA_CI_TEST_DATABASE_ADMIN_ALLOWED,
  });
  const admin = new Pool({ connectionString: target.adminUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }

  const pool = new Pool({
    connectionString: target.databaseUrl,
    max: input.max ?? 4,
    options: `-c statement_timeout=${input.statementTimeoutMs ?? 30_000}`,
  });
  let closed = false;
  return {
    pool,
    database: bindPool(pool),
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await pool.end();
      try {
        if (!SYNTHETIC_DATABASE_NAME.test(databaseName)) {
          throw new Error('Invalid synthetic database name during cleanup');
        }
        await admin.query(`DROP DATABASE "${databaseName}"`);
      } finally {
        await admin.end();
      }
    },
  };
}

function bindPool(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(
            text: string,
            values?: readonly unknown[],
          ) => client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
