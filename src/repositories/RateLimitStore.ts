import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';
import type { RateLimitResult, RateLimitStore } from '../middleware/rateLimit.js';

interface RateLimitBucketRow extends QueryResultRow {
  count: number;
  reset_at: Date;
}

interface RateLimitBucketKeyRow extends QueryResultRow {
  bucket_key: string;
}

export interface PruneExpiredRateLimitBucketsInput {
  olderThanHours: number;
  maxDeletes: number;
  dryRun: boolean;
}

export interface PruneExpiredRateLimitBucketsResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  candidateKeys: string[];
  truncated: boolean;
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
            ELSE LEAST(rate_limit_buckets.count + 1, $3::int + 1)
          END,
          reset_at = CASE
            WHEN rate_limit_buckets.reset_at <= NOW() THEN NOW() + ($2::int * INTERVAL '1 second')
            ELSE rate_limit_buckets.reset_at
          END,
          updated_at = NOW()
      RETURNING count, reset_at
      `,
      [key, windowSeconds, maxRequests],
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

  public async pruneExpiredBuckets(
    input: PruneExpiredRateLimitBucketsInput,
  ): Promise<PruneExpiredRateLimitBucketsResult> {
    if (!Number.isSafeInteger(input.olderThanHours) || input.olderThanHours <= 0) {
      throw new Error('olderThanHours must be a positive safe integer');
    }
    if (!Number.isSafeInteger(input.maxDeletes) || input.maxDeletes <= 0) {
      throw new Error('maxDeletes must be a positive safe integer');
    }

    const candidateKeys = await this.findExpiredBucketKeys(input.olderThanHours, input.maxDeletes + 1);
    const truncated = candidateKeys.length > input.maxDeletes;
    const keysToDelete = candidateKeys.slice(0, input.maxDeletes);

    if (input.dryRun || keysToDelete.length === 0) {
      return {
        dryRun: input.dryRun,
        candidateCount: keysToDelete.length,
        deletedCount: 0,
        candidateKeys: keysToDelete,
        truncated,
      };
    }

    const deletedResult = await this.client.query<RateLimitBucketKeyRow>(
      `
      DELETE FROM rate_limit_buckets
      WHERE bucket_key = ANY($1::text[])
        AND reset_at < NOW() - ($2::int * INTERVAL '1 hour')
      RETURNING bucket_key
      `,
      [keysToDelete, input.olderThanHours],
    );

    return {
      dryRun: false,
      candidateCount: keysToDelete.length,
      deletedCount: deletedResult.rows.length,
      candidateKeys: deletedResult.rows.map((row) => row.bucket_key),
      truncated,
    };
  }

  private async findExpiredBucketKeys(olderThanHours: number, limit: number): Promise<string[]> {
    const result = await this.client.query<RateLimitBucketKeyRow>(
      `
      SELECT bucket_key
      FROM rate_limit_buckets
      WHERE reset_at < NOW() - ($1::int * INTERVAL '1 hour')
      ORDER BY reset_at ASC, bucket_key ASC
      LIMIT $2
      `,
      [olderThanHours, limit],
    );

    return result.rows.map((row) => row.bucket_key);
  }
}

function toDate(value: Date | string | undefined): Date {
  return value instanceof Date ? value : new Date(value ?? Date.now());
}

function calculateRetryAfterSeconds(resetAt: Date): number {
  return Math.max(Math.ceil((resetAt.getTime() - Date.now()) / 1000), 1);
}
