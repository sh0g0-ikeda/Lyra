import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createAccountDeletionRecoveryRuntime } from '../../../../src/infrastructure/account/AccountDeletionRuntime.js';
import { parseEnv } from '../../../../src/lib/env.js';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';

// The v2 port returns pending before any legacy provider can be called.
// The factory may construct clients but all I/O here uses this fake database.
describe('account deletion runtime fencing injection', () => {
  it('passes the optional port and shared request budget into recovered deletion', async () => {
    const queries: string[] = [];
    const database: DatabaseClient & TransactionRunner = {
      transaction: (work) => work(database),
      query: async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
        queries.push(sql);
        let rows: QueryResultRow[] = [];
        if (sql.includes('WITH candidate AS')) rows = [{
          user_id: '11111111-1111-4111-8111-111111111111', identity_id: 'synthetic-identity',
          status: 'processing', processing_token: '22222222-2222-4222-8222-222222222222',
          cancelled_subscription_ids: [], scheduled_asset_keys: [], data_anonymized_at: null,
          identity_disabled_at: null, identity_deleted_at: null,
        }];
        if (sql.includes('FROM state_reference_copy_attempts') && sql.includes('SELECT COUNT(*)::text AS count')) rows = [{ count: '1' }];
        return { rows: rows as R[], rowCount: 1, command: 'SELECT', fields: [], oid: 0 };
      },
    };
    const fencePersonalReferences = vi.fn(async (_user: string, _token: string, budget: { beforeRequest(): void; remainingTimeMs(): number }) => {
      expect(budget.remainingTimeMs()).toBeGreaterThan(0); expect(budget.remainingTimeMs()).toBeLessThanOrEqual(15_000);
      budget.beforeRequest(); return false;
    });
    const runtime = createAccountDeletionRecoveryRuntime(parseEnv({ NODE_ENV: 'test', ACCOUNT_DELETION_ENABLED: 'true',
      ACCOUNT_DELETION_IDENTITY_HASH_SECRET: 'account-deletion-local-test-secret-only', AUTH_PROVIDER: 'cognito',
      AWS_REGION: 'ap-northeast-1', COGNITO_USER_POOL_ID: 'ap-northeast-1_local', S3_BUCKET_IMAGES: 'local-only', STRIPE_SECRET_KEY: 'sk_test_synthetic',
    }), database, { fencePersonalReferences });
    expect(runtime).not.toBeNull();
    expect(await runtime!.service.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 0 });
    expect(fencePersonalReferences).toHaveBeenCalledTimes(1);
    expect(queries.some((sql) => sql.includes('UPDATE users'))).toBe(false);
  });
});
