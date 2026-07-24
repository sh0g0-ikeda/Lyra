import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import {
  assertProductionRuntimeConfig,
  isDevAuthBypassRuntimeAllowed,
} from '../../../src/lib/runtimeGuards.js';

const safeProductionConfig = {
  APP_ENV: 'production' as const,
  DEV_AUTH_BYPASS: false,
  APP_PUBLIC_URL: 'https://app.lyra.test',
  DATABASE_URL: 'postgres://lyra:secret@lyra-db.abc123.ap-northeast-1.rds.amazonaws.com:5432/lyra',
  DATABASE_POOL_MAX: 10,
  DATABASE_SSL_MODE: 'require' as const,
  AUTH_PROVIDER: 'cognito' as const,
  AWS_REGION: 'ap-northeast-1',
  COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
  COGNITO_CLIENT_ID: 'client-123',
  COGNITO_TOKEN_USE: 'access' as const,
  COGNITO_REQUIRED_SCOPES: 'lyra/api',
  LLM_PAGE_PROMPT_COMPILER_ENABLED: true,
  LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED: true,
  LLM_PAGE_GENERATION_PLANNER_ENABLED: true,
  OPENAI_API_KEY: 'sk-proj-openai-key',
  OPENAI_IMAGE_MODEL: 'gpt-image-2',
  OPENAI_TIMEOUT_MS: 300_000,
  SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
  SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS: 1800,
  S3_BUCKET_IMAGES: 'lyra-images',
  IMAGES_CDN_BASE_URL: 'https://images.lyra.test',
  IMAGE_CDN_SIGNING_ENABLED: true,
  CLOUDFRONT_KEY_PAIR_ID: 'K1234567890',
  CLOUDFRONT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
  CLOUDFRONT_SIGNED_URL_TTL_SECONDS: 300,
  REFERENCE_CANDIDATE_TOKEN_SECRET: 'reference-candidate-token-secret-for-runtime-tests',
  ORIGIN_GUARD_HEADER_NAME: 'X-Lyra-Origin-Guard',
  ORIGIN_GUARD_HEADER_VALUE: 'secret-origin-token',
  STRIPE_SECRET_KEY: 'sk_live_secret123',
  STRIPE_WEBHOOK_SECRET: 'whsec_secret123',
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_standard',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium',
  STRIPE_PRICE_CREDITS_200: 'price_credits_200',
  STRIPE_PRICE_CREDITS_1000: 'price_credits_1000',
  STRIPE_PRICE_CREDITS_3000: 'price_credits_3000',
  STRIPE_CHECKOUT_SUCCESS_URL: 'https://lyra.test/billing/success',
  STRIPE_CHECKOUT_CANCEL_URL: 'https://lyra.test/billing/cancel',
  STRIPE_PORTAL_RETURN_URL: 'https://lyra.test/billing',
};

describe('assertProductionRuntimeConfig', () => {
  it('production 以外では未設定の外部サービスを許可する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          APP_ENV: 'development',
          DEV_AUTH_BYPASS: true,
        },
        'development',
      );
    }).not.toThrow();
  });

  it('dev auth bypass は明示的な development/test runtime でだけ許可する', () => {
    expect(isDevAuthBypassRuntimeAllowed('development', undefined)).toBe(true);
    expect(isDevAuthBypassRuntimeAllowed('test', undefined)).toBe(true);
    expect(isDevAuthBypassRuntimeAllowed(undefined, 'development')).toBe(true);
    expect(isDevAuthBypassRuntimeAllowed(undefined, 'test')).toBe(true);
    expect(isDevAuthBypassRuntimeAllowed(undefined, '')).toBe(false);
    expect(isDevAuthBypassRuntimeAllowed('production', 'development')).toBe(false);
    expect(isDevAuthBypassRuntimeAllowed('development', 'production')).toBe(false);
  });

  it('APP_ENV/NODE_ENV が不明な dev auth bypass を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: true,
        },
        '',
      );
    }).toThrow(/DEV_AUTH_BYPASS is only allowed/);
  });

  it('安全な production 設定を許可する', () => {
    expect(() => {
      assertProductionRuntimeConfig(safeProductionConfig, 'production');
    }).not.toThrow();
  });

  it('production では招待URLに使う公開URLの localhost 既定値を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          APP_PUBLIC_URL: 'http://localhost:5173',
        },
        'production',
      );
    }).toThrow(/APP_PUBLIC_URL must use https and a non-local host in production/);
  });

  it('production では Origin Guard 設定を要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          ORIGIN_GUARD_HEADER_NAME: undefined,
          ORIGIN_GUARD_HEADER_VALUE: undefined,
        },
        'production',
      );
    }).toThrow(/ORIGIN_GUARD_HEADER_NAME is required.*ORIGIN_GUARD_HEADER_VALUE is required/);
  });

  it('allows production image delivery through short-lived S3 presigned URLs without CloudFront config', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGE_DELIVERY_MODE: 's3_presigned',
          IMAGES_CDN_BASE_URL: 'replace-me-cloudfront-url',
          IMAGE_CDN_SIGNING_ENABLED: false,
          CLOUDFRONT_KEY_PAIR_ID: undefined,
          CLOUDFRONT_PRIVATE_KEY: undefined,
          S3_PRESIGNED_URL_TTL_SECONDS: 300,
        },
        'production',
      );
    }).not.toThrow();
  });

  it('rejects enabled mobile store billing when production sandbox settings are present', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          MOBILE_STORE_BILLING_ENABLED: true,
          APPLE_STORE_ALLOW_SANDBOX: true,
          GOOGLE_PLAY_ALLOW_TEST_PURCHASES: false,
        },
        'production',
      );
    }).toThrow(/Mobile store billing config is incomplete.*sandbox and test purchases must be disabled/);
  });

  it('rejects too-long S3 presigned URL TTL values in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGE_DELIVERY_MODE: 's3_presigned',
          IMAGES_CDN_BASE_URL: undefined,
          IMAGE_CDN_SIGNING_ENABLED: false,
          CLOUDFRONT_KEY_PAIR_ID: undefined,
          CLOUDFRONT_PRIVATE_KEY: undefined,
          S3_PRESIGNED_URL_TTL_SECONDS: 3_601,
        },
        'production',
      );
    }).toThrow(/S3_PRESIGNED_URL_TTL_SECONDS must be between 60 and 3600/);
  });

  it('requires NODE_ENV production when APP_ENV is production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
        },
        'development',
      );
    }).toThrow(/NODE_ENV must be production when APP_ENV is production/);
  });

  it('rejects APP_ENV values that conflict with NODE_ENV production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          APP_ENV: 'development',
        },
        'production',
      );
    }).toThrow(/APP_ENV must be production when NODE_ENV is production/);
  });

  it('Cognito production 設定の issuer/client/scope が揃っていれば許可する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
        },
        'production',
      );
    }).not.toThrow();
  });

  it('production では Supabase auth provider を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          AUTH_PROVIDER: 'supabase',
          SUPABASE_JWT_SECRET: 'supabase-secret',
        },
        'production',
      );
    }).toThrow(/AUTH_PROVIDER must be cognito/);
  });

  it('production の dev auth bypass と local asset storage を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DEV_AUTH_BYPASS: true,
          LOCAL_FILE_STORAGE_DIR: '.localdata/assets',
          LOCAL_ASSET_BASE_URL: 'http://127.0.0.1:3000/local-assets',
        },
        'production',
      );
    }).toThrow(ConfigurationError);
  });

  it('production では local image fallback を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          LOCAL_IMAGE_FALLBACK_ENABLED: true,
        },
        'production',
      );
    }).toThrow(/LOCAL_IMAGE_FALLBACK_ENABLED must be disabled/);
  });

  it('production では生成品質に必要な LLM 補助を有効化する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          LLM_PAGE_PROMPT_COMPILER_ENABLED: false,
          LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED: false,
          LLM_PAGE_GENERATION_PLANNER_ENABLED: false,
        },
        'production',
      );
    }).toThrow(
      /LLM_PAGE_PROMPT_COMPILER_ENABLED must be true.*LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED must be true.*LLM_PAGE_GENERATION_PLANNER_ENABLED must be true/,
    );
  });

  it('production では CORS のワイルドカード許可を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          CORS_ALLOWED_ORIGINS: 'https://app.lyra.test,*',
        },
        'production',
      );
    }).toThrow(/CORS_ALLOWED_ORIGINS must not include \*/);
  });

  it('production では起動時の自動 migration を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          AUTO_RUN_MIGRATIONS: true,
        },
        'production',
      );
    }).toThrow(/AUTO_RUN_MIGRATIONS must be disabled/);
  });

  it('production で生成系の必須設定が欠けている場合は拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          DATABASE_URL: safeProductionConfig.DATABASE_URL,
          AUTH_PROVIDER: 'cognito',
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
          COGNITO_CLIENT_ID: 'client-123',
          COGNITO_REQUIRED_SCOPES: 'lyra/api',
        },
        'production',
      );
    }).toThrow(/OPENAI_API_KEY is required/);
  });

  it('production では AWS_REGION が必須になる', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          AWS_REGION: undefined,
          COGNITO_ISSUER: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_pool',
        },
        'production',
      );
    }).toThrow(/AWS_REGION is required/);
  });

  it('production では過大な生成同時実行上限を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          GENERATION_USER_ACTIVE_JOB_LIMIT: 6,
          GENERATION_GLOBAL_ACTIVE_JOB_LIMIT: 51,
          EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT: 3,
          EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT: 21,
        },
        'production',
      );
    }).toThrow(
      /GENERATION_USER_ACTIVE_JOB_LIMIT must be <= 5.*GENERATION_GLOBAL_ACTIVE_JOB_LIMIT must be <= 50.*EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT must be <= 2.*EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT must be <= 20/,
    );
  });

  it('production では画像生成モデル名に image model を要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_IMAGE_MODEL: 'gpt-5.4-mini',
        },
        'production',
      );
    }).toThrow(/OPENAI_IMAGE_MODEL must be an OpenAI image generation model/);
  });

  it('production では OpenAI API key の形式を要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_API_KEY: 'openai-key',
        },
        'production',
      );
    }).toThrow(/OPENAI_API_KEY must start with sk-/);
  });

  it('production では Stripe 設定一式が必須になる', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          DATABASE_URL: safeProductionConfig.DATABASE_URL,
          AUTH_PROVIDER: 'cognito',
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
          COGNITO_CLIENT_ID: 'client-123',
          COGNITO_REQUIRED_SCOPES: 'lyra/api',
          OPENAI_API_KEY: 'openai-key',
          SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
          S3_BUCKET_IMAGES: 'lyra-images',
          IMAGES_CDN_BASE_URL: 'https://images.lyra.test',
        },
        'production',
      );
    }).toThrow(/Stripe config is incomplete/);
  });

  it('Cognito production 設定で client と scope が欠けている場合は拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          AUTH_PROVIDER: 'cognito',
          COGNITO_TOKEN_USE: 'access',
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
          COGNITO_CLIENT_ID: undefined,
          COGNITO_REQUIRED_SCOPES: undefined,
        },
        'production',
      );
    }).toThrow(/COGNITO_CLIENT_ID is required/);
  });

  it('Cognito id token 運用では production でも required scopes を必須にしない', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          COGNITO_TOKEN_USE: 'id',
          COGNITO_REQUIRED_SCOPES: undefined,
        },
        'production',
      );
    }).not.toThrow();
  });

  it('Stripe 設定が一部だけ入っている場合は拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          DATABASE_URL: safeProductionConfig.DATABASE_URL,
          AUTH_PROVIDER: 'cognito',
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
          COGNITO_CLIENT_ID: 'client-123',
          COGNITO_REQUIRED_SCOPES: 'lyra/api',
          OPENAI_API_KEY: 'openai-key',
          SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
          S3_BUCKET_IMAGES: 'lyra-images',
          IMAGES_CDN_BASE_URL: 'https://images.lyra.test',
          STRIPE_SECRET_KEY: 'stripe-secret',
        },
        'production',
      );
    }).toThrow(/Stripe config is incomplete/);
  });

  it('production では空白の必須設定を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          COGNITO_CLIENT_ID: '  ',
          OPENAI_API_KEY: '',
          STRIPE_WEBHOOK_SECRET: ' ',
        },
        'production',
      );
    }).toThrow(/COGNITO_CLIENT_ID is required.*OPENAI_API_KEY is required.*STRIPE_WEBHOOK_SECRET/);
  });

  it('production では local database URL を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/lyra',
        },
        'production',
      );
    }).toThrow(/DATABASE_URL must not point to a local database/);

    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/lyra',
        },
        'production',
      );
    }).toThrow(/DATABASE_URL must not point to a local database/);
  });

  it('production では database URL が必須になる', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_URL: undefined,
        },
        'production',
      );
    }).toThrow(/DATABASE_URL is required/);
  });

  it('production では public URL に HTTPS の非local hostを要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGES_CDN_BASE_URL: 'http://127.0.0.1:3000/local-assets',
          STRIPE_CHECKOUT_SUCCESS_URL: 'http://localhost:5173/billing/success',
          STRIPE_CHECKOUT_CANCEL_URL: 'http://localhost:5173/billing/cancel',
          STRIPE_PORTAL_RETURN_URL: 'http://localhost:5173/billing',
        },
        'production',
      );
    }).toThrow(
      /IMAGES_CDN_BASE_URL must use https.*STRIPE_CHECKOUT_SUCCESS_URL must use https.*STRIPE_CHECKOUT_CANCEL_URL must use https.*STRIPE_PORTAL_RETURN_URL must use https/,
    );
  });

  it('production では public URL の private/reserved host を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGES_CDN_BASE_URL: 'https://192.168.0.10/assets',
          STRIPE_CHECKOUT_SUCCESS_URL: 'https://10.0.0.5/billing/success',
          STRIPE_CHECKOUT_CANCEL_URL: 'https://172.16.0.5/billing/cancel',
          STRIPE_PORTAL_RETURN_URL: 'https://billing.internal/portal',
        },
        'production',
      );
    }).toThrow(
      /IMAGES_CDN_BASE_URL must use https.*STRIPE_CHECKOUT_SUCCESS_URL must use https.*STRIPE_CHECKOUT_CANCEL_URL must use https.*STRIPE_PORTAL_RETURN_URL must use https/,
    );
  });

  it('production では public URL の documentation/multicast IP host を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGES_CDN_BASE_URL: 'https://192.0.2.10/assets',
          STRIPE_CHECKOUT_SUCCESS_URL: 'https://198.51.100.10/billing/success',
          STRIPE_CHECKOUT_CANCEL_URL: 'https://203.0.113.10/billing/cancel',
          STRIPE_PORTAL_RETURN_URL: 'https://224.0.0.1/billing',
        },
        'production',
      );
    }).toThrow(
      /IMAGES_CDN_BASE_URL must use https.*STRIPE_CHECKOUT_SUCCESS_URL must use https.*STRIPE_CHECKOUT_CANCEL_URL must use https.*STRIPE_PORTAL_RETURN_URL must use https/,
    );
  });

  it('production では CORS origin に HTTPS の非local hostを要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          CORS_ALLOWED_ORIGINS: 'https://app.lyra.test,http://localhost:5173,not-a-url',
        },
        'production',
      );
    }).toThrow(/CORS_ALLOWED_ORIGINS contains unsafe production origins/);
  });

  it('production では placeholder のままの必須設定を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_API_KEY: 'replace-me',
          OPENAI_IMAGE_MODEL: 'placeholder',
          STRIPE_SECRET_KEY: 'changeme',
          STRIPE_PRICE_CREDITS_200: 'price_placeholder',
          COGNITO_CLIENT_ID: 'replace_me',
        },
        'production',
      );
    }).toThrow(
      /COGNITO_CLIENT_ID must not use a placeholder value.*OPENAI_API_KEY must not use a placeholder value.*OPENAI_IMAGE_MODEL must not use a placeholder value.*Stripe config contains placeholder values: STRIPE_SECRET_KEY, STRIPE_PRICE_CREDITS_200/,
    );
  });

  it('production では replace_with 形式の placeholder 設定を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_API_KEY: 'replace_with_openai_key',
          COGNITO_CLIENT_ID: 'your_cognito_client_id',
        },
        'production',
      );
    }).toThrow(
      /COGNITO_CLIENT_ID must not use a placeholder value.*OPENAI_API_KEY must not use a placeholder value/,
    );
  });

  it('production では外部サービスURLにHTTPSの非local hostを要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_BASE_URL: 'http://localhost:11434/v1',
          SQS_QUEUE_URL_GENERATION: 'http://127.0.0.1:4566/000000000000/lyra-generation',
          COGNITO_ISSUER: 'http://localhost:9229/user-pool',
          COGNITO_JWKS_URI: 'http://localhost:9229/.well-known/jwks.json',
        },
        'production',
      );
    }).toThrow(
      /OPENAI_BASE_URL must use https.*SQS_QUEUE_URL_GENERATION must use https.*COGNITO_ISSUER must use https.*COGNITO_JWKS_URI must use https/,
    );
  });

  it('production では外部サービスURLの private/link-local host を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_BASE_URL: 'https://10.0.0.5/v1',
          SQS_QUEUE_URL_GENERATION: 'https://169.254.169.254/metadata',
          COGNITO_ISSUER: 'https://auth.internal/user-pool',
          COGNITO_JWKS_URI: 'https://[fd00::1]/.well-known/jwks.json',
        },
        'production',
      );
    }).toThrow(
      /OPENAI_BASE_URL must use https.*SQS_QUEUE_URL_GENERATION must use https.*COGNITO_ISSUER must use https.*COGNITO_JWKS_URI must use https/,
    );
  });

  it('production では外部サービスURLの documentation/multicast IP host を拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_BASE_URL: 'https://192.0.2.10/v1',
          SQS_QUEUE_URL_GENERATION: 'https://198.51.100.10/queue',
          COGNITO_ISSUER: 'https://203.0.113.10/user-pool',
          COGNITO_JWKS_URI: 'https://[2001:db8::1]/.well-known/jwks.json',
        },
        'production',
      );
    }).toThrow(
      /OPENAI_BASE_URL must use https.*SQS_QUEUE_URL_GENERATION must use https.*COGNITO_ISSUER must use https.*COGNITO_JWKS_URI must use https/,
    );
  });

  it('production では Stripe live secret と webhook secret 形式を要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          STRIPE_SECRET_KEY: 'sk_test_secret123',
          STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
        },
        'production',
      );
    }).toThrow(/STRIPE_SECRET_KEY must use a live secret key.*STRIPE_WEBHOOK_SECRET must start with whsec_/);
  });

  it('production では Stripe price id 形式を要求する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          STRIPE_PRICE_STANDARD_MONTHLY: 'standard',
          STRIPE_PRICE_CREDITS_3000: 'prod_credit_pack',
        },
        'production',
      );
    }).toThrow(/Stripe price ids must start with price_: STRIPE_PRICE_STANDARD_MONTHLY, STRIPE_PRICE_CREDITS_3000/);
  });

  it('rejects disabled database SSL in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_SSL_MODE: 'disable',
        },
        'production',
      );
    }).toThrow(/DATABASE_SSL_MODE must be require in production/);

    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_URL: `${safeProductionConfig.DATABASE_URL}?sslmode=disable`,
        },
        'production',
      );
    }).toThrow(/DATABASE_URL must not disable SSL in production/);
  });

  it('rejects oversized database pool settings in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_POOL_MAX: 25,
        },
        'production',
      );
    }).toThrow(/DATABASE_POOL_MAX must be <= 10 in production/);
  });

  it('rejects unsafe database timeouts in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_STATEMENT_TIMEOUT_MS: 0,
        },
        'production',
      );
    }).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS must be between 1 and 60000/);

    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          DATABASE_QUERY_TIMEOUT_MS: 120_000,
        },
        'production',
      );
    }).toThrow(/DATABASE_QUERY_TIMEOUT_MS must be between 1 and 60000/);
  });

  it('requires explicit SQS visibility timeout settings in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS: undefined,
        },
        'production',
      );
    }).toThrow(/SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS is required/);
  });

  it('rejects SQS visibility timeout shorter than OpenAI timeout plus buffer in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          OPENAI_TIMEOUT_MS: 300_000,
          SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS: 1799,
        },
        'production',
      );
    }).toThrow(/SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS must be >= 1800/);
  });

  it('rejects direct S3 image URLs in production', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGES_CDN_BASE_URL: 'https://lyra-images.s3.ap-northeast-1.amazonaws.com',
        },
        'production',
      );
    }).toThrow(/IMAGES_CDN_BASE_URL must not point directly to S3/);

    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGES_CDN_BASE_URL: 'https://s3.ap-northeast-1.amazonaws.com/lyra-images',
        },
        'production',
      );
    }).toThrow(/IMAGES_CDN_BASE_URL must not point directly to S3/);
  });

  it('production では画像CDN署名設定を必須にする', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          IMAGE_CDN_SIGNING_ENABLED: false,
        },
        'production',
      );
    }).toThrow(/IMAGE_CDN_SIGNING_ENABLED must be true/);

    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          CLOUDFRONT_PRIVATE_KEY: undefined,
        },
        'production',
      );
    }).toThrow(/CLOUDFRONT_PRIVATE_KEY is required/);
  });
});
