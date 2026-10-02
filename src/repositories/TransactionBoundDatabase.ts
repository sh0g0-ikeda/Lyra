import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

/** Share the enclosing transaction; never issue a nested BEGIN/COMMIT or use the pool. */
export function bindTransaction(client: DatabaseClient): DatabaseClient & TransactionRunner {
  return {
    query: client.query.bind(client),
    transaction: async <T>(work: (transactionClient: DatabaseClient) => Promise<T>): Promise<T> => work(client),
  };
}
