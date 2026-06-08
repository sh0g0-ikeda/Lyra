import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import { assertProductionRuntimeConfig } from '../../../src/lib/runtimeGuards.js';

const safeProductionConfig = {
  DEV_AUTH_BYPASS: false,
  DATABASE_URL: 'postgres://lyra:secret@lyra-db.abc123.ap-northeast-1.rds.amazonaws.com:5432/lyra',
  AUTH_PROVIDER: 'cognito' as const,
  AWS_REGION: 'ap-northeast-1',
  COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
  COGNITO_CLIENT_ID: 'client-123',
  COGNITO_TOKEN_USE: 'access' as const,
  COGNITO_REQUIRED_SCOPES: 'lyra/api',
  OPENAI_API_KEY: 'openai-key',
  SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
  S3_BUCKET_IMAGES: 'lyra-images',
  IMAGES_CDN_BASE_URL: 'https://images.lyra.test',
  STRIPE_SECRET_KEY: 'stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
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
          DEV_AUTH_BYPASS: true,
        },
        'development',
      );
    }).not.toThrow();
  });

  it('安全な production 設定を許可する', () => {
    expect(() => {
      assertProductionRuntimeConfig(safeProductionConfig, 'production');
    }).not.toThrow();
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
        },
        'production',
      );
    }).toThrow(
      /GENERATION_USER_ACTIVE_JOB_LIMIT must be <= 5.*GENERATION_GLOBAL_ACTIVE_JOB_LIMIT must be <= 50/,
    );
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
});
