import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env.js';

export interface DatabaseClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface TransactionRunner {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
}

export type DatabaseSslMode = 'disable' | 'require';

export interface DatabasePoolConfigInput {
  connectionString: string;
  max: number;
  sslMode: DatabaseSslMode;
}

export function buildDatabasePoolConfig(input: DatabasePoolConfigInput): PoolConfig {
  const config: PoolConfig = {
    connectionString: input.connectionString,
    max: input.max,
  };

  if (input.sslMode === 'require') {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

const pool = new Pool(
  buildDatabasePoolConfig({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    sslMode: env.DATABASE_SSL_MODE,
  }),
);

export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}

export const db: DatabaseClient & TransactionRunner = {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return pool.query<T>(text, values === undefined ? undefined : [...values]);
  },

  async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<R>> => client.query<R>(text, values === undefined ? undefined : [...values]),
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
