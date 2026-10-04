import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import { parseEnv, type Env } from '../../../../src/lib/env.js';
import { createMobileStoreBillingIntegration } from '../../../../src/infrastructure/mobileStore/createMobileStoreBillingIntegration.js';

class CapturingDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = text.includes('FROM users')
      ? [{ id: '11111111-1111-4111-8111-111111111111', plan_code: 'free', account_deletion_started_at: null, account_deleted_at: null, legacy_account_deleted: false }]
      : [];
    return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows: rows as unknown as T[] };
  }
}

describe('createMobileStoreBillingIntegration persistence profile', () => {
  it('profile omitted factory は既存3引数で canonical user guard を実行する', async () => {
    const database = new CapturingDatabase();
    const integration = createMobileStoreBillingIntegration(mobileStoreEnv(), database, false);

    await integration?.mobileStorePurchaseService.getAccountBinding('11111111-1111-4111-8111-111111111111');

    const queries = database.queries.join('\n');
    expect(queries).toContain('account_deletion_started_at');
    expect(queries).toContain('account_deleted_at');
    expect(queries).not.toContain('legacy_account_deleted');
  });

  it('legacy profile factory は旧 account deletion request guard を実行する', async () => {
    const database = new CapturingDatabase();
    const integration = createMobileStoreBillingIntegration(
      mobileStoreEnv(),
      database,
      false,
      'legacy_2debe_v1',
    );

    await integration?.mobileStorePurchaseService.getAccountBinding('11111111-1111-4111-8111-111111111111');

    const queries = database.queries.join('\n');
    expect(queries).toContain('account_deletion_requests requests');
    expect(queries).toContain('legacy_account_deleted');
    expect(queries).not.toContain('account_deletion_started_at');
  });
});

function mobileStoreEnv(): Env {
  return parseEnv({
    MOBILE_STORE_BILLING_ENABLED: 'true',
    MOBILE_STORE_IDENTIFIER_HASH_SECRET: '01234567890123456789012345678901',
    APPLE_STORE_BUNDLE_ID: 'jp.lyra.app',
    APPLE_STORE_APP_APPLE_ID: '123456789',
    APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON: Buffer.from(JSON.stringify([Buffer.from('root').toString('base64')])).toString('base64'),
    APPLE_STORE_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.apple.standard.monthly',
    APPLE_STORE_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.apple.premium.monthly',
    APPLE_STORE_PRODUCT_CREDITS_200: 'jp.lyra.apple.credits.200',
    APPLE_STORE_PRODUCT_CREDITS_1000: 'jp.lyra.apple.credits.1000',
    APPLE_STORE_PRODUCT_CREDITS_3000: 'jp.lyra.apple.credits.3000',
    GOOGLE_PLAY_PACKAGE_NAME: 'jp.lyra.app',
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({
      client_email: 'play-api@lyra.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    })).toString('base64'),
    GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.lyra.example/api/webhooks/mobile-purchases/google',
    GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'pubsub@lyra.iam.gserviceaccount.com',
    GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.google.standard.monthly',
    GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.google.premium.monthly',
    GOOGLE_PLAY_PRODUCT_CREDITS_200: 'jp.lyra.google.credits.200',
    GOOGLE_PLAY_PRODUCT_CREDITS_1000: 'jp.lyra.google.credits.1000',
    GOOGLE_PLAY_PRODUCT_CREDITS_3000: 'jp.lyra.google.credits.3000',
  });
}
