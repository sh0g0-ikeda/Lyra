import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/lib/env.js';

const originalNodeEnv = process.env.NODE_ENV;

describe('parseEnv', () => {
  it('persistence profile は未指定なら canonical を使い、未知の profile を拒否する', () => {
    expect(parseEnv({}).LYRA_PERSISTENCE_PROFILE).toBe('canonical');
    expect(() => parseEnv({ LYRA_PERSISTENCE_PROFILE: 'legacy_unknown' })).toThrow();
  });

  it('staging runtime と隔離metadataを解釈する', () => {
    const parsed = parseEnv({
      APP_ENV: 'staging',
      STAGING_SECRET_SOURCE_ID: 'lyra/staging/app',
      STAGING_RESOURCE_ISOLATION_ATTESTED: 'true',
      STAGING_PRODUCTION_RESOURCE_DENYLIST: 'prod-client,lyra/prod/app',
    });

    expect(parsed.APP_ENV).toBe('staging');
    expect(parsed.STAGING_SECRET_SOURCE_ID).toBe('lyra/staging/app');
    expect(parsed.STAGING_RESOURCE_ISOLATION_ATTESTED).toBe(true);
    expect(parsed.STAGING_PRODUCTION_RESOURCE_DENYLIST).toBe('prod-client,lyra/prod/app');
  });

  it('episode text profile remains legacy unless an exact supported profile is selected',()=>{
    expect(parseEnv({}).OPENAI_EPISODE_TEXT_PROFILE).toBe('legacy');
    expect(parseEnv({OPENAI_EPISODE_TEXT_PROFILE:'balanced_v1'}).OPENAI_EPISODE_TEXT_PROFILE).toBe('balanced_v1');
    expect(()=>parseEnv({OPENAI_EPISODE_TEXT_PROFILE:'other'})).toThrow();
  });
  it('mobile store billingは明示しない限り無効でprovider timeoutだけ安全な既定値を持つ', () => {
    const parsed = parseEnv({});

    expect(parsed.MOBILE_STORE_BILLING_ENABLED).toBe(false);
    expect(parsed.MOBILE_STORE_PROVIDER_TIMEOUT_MS).toBe(15_000);
    expect(parsed.APPLE_STORE_BUNDLE_ID).toBeUndefined();
    expect(parsed.GOOGLE_PLAY_PACKAGE_NAME).toBeUndefined();
  });

  it('episode exportは明示しない限り無効で専用queue設定を持たない', () => {
    const parsed = parseEnv({});

    expect(parsed.EPISODE_EXPORT_ENABLED).toBe(false);
    expect(parsed.SQS_QUEUE_URL_EXPORT).toBeUndefined();
    expect(parsed.SQS_EXPORT_MAX_NUMBER_OF_MESSAGES).toBe(1);
  });

  it('episode exportの専用queue値をboundedに解釈する', () => {
    const parsed = parseEnv({
      EPISODE_EXPORT_ENABLED: 'true',
      SQS_QUEUE_URL_EXPORT:
        'https://sqs.ap-northeast-1.amazonaws.com/123456789012/lyra-export',
      SQS_EXPORT_VISIBILITY_TIMEOUT_SECONDS: '1800',
      SQS_EXPORT_MAX_NUMBER_OF_MESSAGES: '2',
    });

    expect(parsed.EPISODE_EXPORT_ENABLED).toBe(true);
    expect(parsed.SQS_EXPORT_VISIBILITY_TIMEOUT_SECONDS).toBe(1800);
    expect(parsed.SQS_EXPORT_MAX_NUMBER_OF_MESSAGES).toBe(2);
  });
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
    expect(parsed.ENTITY_STATE_REFERENCE_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(true);
    expect(parsed.ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED).toBe(false);
  });

  it('個別 generation kill switch は false を明示できる', () => {
    const parsed = parseEnv({
      PAGE_GENERATION_ENABLED: 'false',
      ENTITY_GENERATION_ENABLED: 'false',
      ENTITY_STATE_REFERENCE_GENERATION_ENABLED: 'true',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'false',
      ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED: 'true',
    });

    expect(parsed.PAGE_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_STATE_REFERENCE_GENERATION_ENABLED).toBe(true);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(false);
    expect(parsed.ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED).toBe(true);
  });

  it('staging は5つの生成flagがすべて明示falseの場合だけkeyless起動条件を記録する', () => {
    const explicitlyDisabled = parseEnv({
      APP_ENV: 'staging',
      GENERATION_ENABLED: 'false',
      PAGE_GENERATION_ENABLED: 'false',
      ENTITY_GENERATION_ENABLED: 'false',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'false',
      ENTITY_STATE_REFERENCE_GENERATION_ENABLED: 'false',
    });
    const oneFlagMissing = parseEnv({
      APP_ENV: 'staging',
      GENERATION_ENABLED: 'false',
      PAGE_GENERATION_ENABLED: 'false',
      ENTITY_GENERATION_ENABLED: 'false',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'false',
    });

    expect(explicitlyDisabled.STAGING_GENERATION_FLAGS_EXPLICITLY_DISABLED).toBe(true);
    expect(oneFlagMissing.STAGING_GENERATION_FLAGS_EXPLICITLY_DISABLED).toBe(false);
    expect(parseEnv({ APP_ENV: 'production' }).STAGING_GENERATION_FLAGS_EXPLICITLY_DISABLED).toBe(false);
  });

  it('database timeout は安全な既定値を持つ', () => {
    const parsed = parseEnv({});

    expect(parsed.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(parsed.DATABASE_QUERY_TIMEOUT_MS).toBe(30_000);
  });

  it('episode continuity v3 は未設定時に有効になる', () => {
    const parsed = parseEnv({});

    expect(parsed.EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED).toBe(true);
  });

  it('episode continuity v3 は明示的に無効化できる', () => {
    const parsed = parseEnv({ EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED: 'false' });

    expect(parsed.EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED).toBe(false);
  });

  it('episode state autofill v1 は明示しない限りOFFで、trueだけを受理する', () => {
    expect(parseEnv({}).EPISODE_STATE_AUTOFILL_V1_ENABLED).toBe(false);
    expect(parseEnv({ EPISODE_STATE_AUTOFILL_V1_ENABLED: 'true' }).EPISODE_STATE_AUTOFILL_V1_ENABLED).toBe(true);
  });
});
