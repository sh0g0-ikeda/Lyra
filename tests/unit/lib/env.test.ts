import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/lib/env.js';

const originalNodeEnv = process.env.NODE_ENV;

describe('parseEnv', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('production では GENERATION_ENABLED 未設定時に生成を無効化する', () => {
    process.env.NODE_ENV = 'production';

    const parsed = parseEnv({});

    expect(parsed.GENERATION_ENABLED).toBe(false);
  });

  it('production でも GENERATION_ENABLED=true が明示されていれば生成を有効化する', () => {
    process.env.NODE_ENV = 'production';

    const parsed = parseEnv({ GENERATION_ENABLED: 'true' });

    expect(parsed.GENERATION_ENABLED).toBe(true);
  });

  it('development では GENERATION_ENABLED 未設定時に従来どおり生成を有効化する', () => {
    process.env.NODE_ENV = 'development';

    const parsed = parseEnv({});

    expect(parsed.GENERATION_ENABLED).toBe(true);
  });

  it('個別 generation kill switch は未設定時に有効になる', () => {
    const parsed = parseEnv({});

    expect(parsed.PAGE_GENERATION_ENABLED).toBe(true);
    expect(parsed.ENTITY_GENERATION_ENABLED).toBe(true);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(true);
  });

  it('個別 generation kill switch は false を明示できる', () => {
    const parsed = parseEnv({
      PAGE_GENERATION_ENABLED: 'false',
      ENTITY_GENERATION_ENABLED: 'false',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'false',
    });

    expect(parsed.PAGE_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(false);
  });

  it('database timeout は安全な既定値を持つ', () => {
    const parsed = parseEnv({});

    expect(parsed.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(parsed.DATABASE_QUERY_TIMEOUT_MS).toBe(30_000);
  });

  it('parses opt-in mobile store billing controls', () => {
    const disabled = parseEnv({});
    const enabled = parseEnv({
      MOBILE_STORE_BILLING_ENABLED: 'true',
      APPLE_STORE_ALLOW_SANDBOX: 'false',
      GOOGLE_PLAY_ALLOW_TEST_PURCHASES: 'true',
    });

    expect(disabled.MOBILE_STORE_BILLING_ENABLED).toBe(false);
    expect(enabled.MOBILE_STORE_BILLING_ENABLED).toBe(true);
    expect(enabled.APPLE_STORE_ALLOW_SANDBOX).toBe(false);
    expect(enabled.GOOGLE_PLAY_ALLOW_TEST_PURCHASES).toBe(true);
  });

  it('push notificationは既定で無効、明示時だけ鍵設定を読み込む', () => {
    const disabled = parseEnv({});
    const enabled = parseEnv({
      PUSH_NOTIFICATIONS_ENABLED: 'true',
      PUSH_TOKEN_ENCRYPTION_KEY_BASE64: encryptionKey,
      PUSH_TOKEN_HASH_KEY_BASE64: hashKey,
      PUSH_TOKEN_ENCRYPTION_KEY_ID: 'push-key-2026-07',
      PUSH_APNS_TEAM_ID: 'TEAM123456',
      PUSH_APNS_KEY_ID: 'KEY1234567',
      PUSH_APNS_PRIVATE_KEY_BASE64: 'YXBucy1rZXk=',
      PUSH_APNS_BUNDLE_ID: 'jp.lyra.mobile',
      PUSH_APNS_ENVIRONMENT: 'production',
      PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64: 'e30=',
      PUSH_PROVIDER_TIMEOUT_MS: '8000',
      PUSH_DELIVERY_INTERVAL_MS: '20000'
    });

    expect(disabled.PUSH_NOTIFICATIONS_ENABLED).toBe(false);
    expect(enabled.PUSH_NOTIFICATIONS_ENABLED).toBe(true);
    expect(enabled.PUSH_TOKEN_ENCRYPTION_KEY_BASE64).toBe(encryptionKey);
    expect(enabled.PUSH_TOKEN_HASH_KEY_BASE64).toBe(hashKey);
    expect(enabled.PUSH_TOKEN_ENCRYPTION_KEY_ID).toBe('push-key-2026-07');
    expect(enabled.PUSH_APNS_TEAM_ID).toBe('TEAM123456');
    expect(enabled.PUSH_APNS_ENVIRONMENT).toBe('production');
    expect(enabled.PUSH_PROVIDER_TIMEOUT_MS).toBe(8000);
    expect(enabled.PUSH_DELIVERY_INTERVAL_MS).toBe(20000);
  });
});

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const hashKey = Buffer.alloc(32, 11).toString('base64');
