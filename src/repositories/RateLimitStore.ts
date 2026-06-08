import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';
import type { RateLimitResult, RateLimitStore } from '../middleware/rateLimit.js';

interface RateLimitBucketRow extends QueryResultRow {
  count: number;
  reset_at: Date;
}

/**
 * Shared fixed-window rate limit store for multi-instance deployments.
 * The upsert is atomic, so concurrent API servers consume the same bucket.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  public constructor(private readonly client: DatabaseClient) {}

  public async consume(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const result = await this.client.query<RateLimitBucketRow>(
      `
      INSERT INTO rate_limit_buckets (bucket_key, count, reset_at, updated_at)
      VALUES ($1, 1, NOW() + ($2::int * INTERVAL '1 second'), NOW())
      ON CONFLICT (bucket_key) DO UPDATE
      SET count = CASE
            WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
            ELSE rate_limit_buckets.count + 1
          END,
          reset_at = CASE
            WHEN rate_limit_buckets.reset_at <= NOW() THEN NOW() + ($2::int * INTERVAL '1 second')
            ELSE rate_limit_buckets.reset_at
          END,
          updated_at = NOW()
      RETURNING count, reset_at
      `,
      [key, windowSeconds],
    );

    const row = result.rows[0];
    const count = Number(row?.count ?? maxRequests + 1);
    const resetAt = toDate(row?.reset_at);
    const allowed = count <= maxRequests;

    return {
      allowed,
      remaining: allowed ? Math.max(maxRequests - count, 0) : 0,
      retryAfterSeconds: calculateRetryAfterSeconds(resetAt),
      resetAt,
    };
  }
}

function toDate(value: Date | string | undefined): Date {
  return value instanceof Date ? value : new Date(value ?? Date.now());
}

function calculateRetryAfterSeconds(resetAt: Date): number {
  return Math.max(Math.ceil((resetAt.getTime() - Date.now()) / 1000), 1);
}
