import type { QueryResult, QueryResultRow } from 'pg';

/** Type-only dependency required to compile the exact historical repository fixture. */
export interface DatabaseClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface TransactionRunner {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
}
