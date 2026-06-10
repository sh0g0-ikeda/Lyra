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

class FakePruneRateLimitClient implements DatabaseClient {
  public readonly queries: Array<{ text: string; values?: readonly unknown[] }> = [];

  public constructor(private readonly rows: Array<{ bucket_key: string }>) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, values });

    return {
      command: text.includes('DELETE FROM rate_limit_buckets') ? 'DELETE' : 'SELECT',
      rowCount: this.rows.length,
      oid: 0,
      fields: [],
      rows: this.rows as unknown as T[],
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
    expect(client.values).toEqual(['default:user-1', 60, 3]);
    expect(client.queries[0]).toContain('INSERT INTO rate_limit_buckets');
    expect(client.queries[0]).toContain('ON CONFLICT (bucket_key) DO UPDATE');
    expect(client.queries[0]).toContain('LEAST(rate_limit_buckets.count + 1, $3::int + 1)');
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

  it('expired bucket pruning はdry-runで候補だけ返す', async () => {
    const client = new FakePruneRateLimitClient([
      { bucket_key: 'webhook:public:203.0.113.1' },
      { bucket_key: 'default:user-1' },
    ]);
    const store = new PostgresRateLimitStore(client);

    const result = await store.pruneExpiredBuckets({
      olderThanHours: 24,
      maxDeletes: 10,
      dryRun: true,
    });

    expect(result).toEqual({
      dryRun: true,
      candidateCount: 2,
      deletedCount: 0,
      candidateKeys: ['webhook:public:203.0.113.1', 'default:user-1'],
      truncated: false,
    });
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]?.text).toContain('SELECT bucket_key');
    expect(client.queries[0]?.values).toEqual([24, 11]);
  });

  it('expired bucket pruning は削除時にも期限切れ条件を再確認する', async () => {
    const client = new FakePruneRateLimitClient([
      { bucket_key: 'webhook:public:203.0.113.1' },
    ]);
    const store = new PostgresRateLimitStore(client);

    const result = await store.pruneExpiredBuckets({
      olderThanHours: 24,
      maxDeletes: 1,
      dryRun: false,
    });

    expect(result).toEqual({
      dryRun: false,
      candidateCount: 1,
      deletedCount: 1,
      candidateKeys: ['webhook:public:203.0.113.1'],
      truncated: false,
    });
    expect(client.queries).toHaveLength(2);
    expect(client.queries[1]?.text).toContain('DELETE FROM rate_limit_buckets');
    expect(client.queries[1]?.text).toContain('reset_at < NOW()');
    expect(client.queries[1]?.values).toEqual([
      ['webhook:public:203.0.113.1'],
      24,
    ]);
  });
});
