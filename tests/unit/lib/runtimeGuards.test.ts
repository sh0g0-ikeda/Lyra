import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import { assertProductionRuntimeConfig } from '../../../src/lib/runtimeGuards.js';

const safeProductionConfig = {
  DEV_AUTH_BYPASS: false,
  AUTH_PROVIDER: 'supabase' as const,
  SUPABASE_JWT_SECRET: 'supabase-secret',
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

  it('Cognito production 設定は issuer/client/scope が揃っていれば許可する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          AUTH_PROVIDER: 'cognito',
          SUPABASE_JWT_SECRET: undefined,
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
          COGNITO_CLIENT_ID: 'client-123',
          COGNITO_REQUIRED_SCOPES: 'lyra/api',
        },
        'production',
      );
    }).not.toThrow();
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

  it('production で生成系必須設定が欠けている場合は拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          SUPABASE_JWT_SECRET: 'supabase-secret',
        },
        'production',
      );
    }).toThrow(/OPENAI_API_KEY is required/);
  });

  it('production では Stripe 設定一式が必須になる', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          SUPABASE_JWT_SECRET: 'supabase-secret',
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
          SUPABASE_JWT_SECRET: undefined,
          AWS_REGION: 'ap-northeast-1',
          COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
        },
        'production',
      );
    }).toThrow(/COGNITO_CLIENT_ID is required/);
  });

  it('Stripe 設定が一部だけ入っている場合は拒否する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: false,
          AUTH_PROVIDER: 'supabase',
          SUPABASE_JWT_SECRET: 'supabase-secret',
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

  it('production rejects blank required config values', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          ...safeProductionConfig,
          SUPABASE_JWT_SECRET: '  ',
          OPENAI_API_KEY: '',
          STRIPE_WEBHOOK_SECRET: ' ',
        },
        'production',
      );
    }).toThrow(/SUPABASE_JWT_SECRET is required.*OPENAI_API_KEY is required.*STRIPE_WEBHOOK_SECRET/);
  });
});
