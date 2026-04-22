import { Pool, type QueryResult, type QueryResultRow } from 'pg';
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

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

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
