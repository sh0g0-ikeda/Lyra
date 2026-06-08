import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresRateLimitStore } from '../../../src/repositories/RateLimitStore.js';

class FakeRateLimitClient implements DatabaseClient {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public constructor(private readonly row: { count: number; reset_at: Date }) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    return {
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [this.row] as unknown as T[],
    };
  }
}

describe('PostgresRateLimitStore', () => {
  it('atomic upsert で shared bucket を消費する', async () => {
    const resetAt = new Date(Date.now() + 60_000);
    const client = new FakeRateLimitClient({ count: 2, reset_at: resetAt });
    const store = new PostgresRateLimitStore(client);

    const result = await store.consume('default:user-1', 3, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(result.resetAt).toEqual(resetAt);
    expect(client.values).toEqual(['default:user-1', 60]);
    expect(client.queries[0]).toContain('INSERT INTO rate_limit_buckets');
    expect(client.queries[0]).toContain('ON CONFLICT (bucket_key) DO UPDATE');
    expect(client.queries[0]).toContain('rate_limit_buckets.count + 1');
  });

  it('count が上限を超えたら拒否結果を返す', async () => {
    const resetAt = new Date(Date.now() + 30_000);
    const client = new FakeRateLimitClient({ count: 4, reset_at: resetAt });
    const store = new PostgresRateLimitStore(client);

    const result = await store.consume('default:user-1', 3, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.resetAt).toEqual(resetAt);
  });
});
