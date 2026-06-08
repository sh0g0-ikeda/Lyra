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
          ...safeProductionConfig,
          STRIPE_SECRET_KEY: 'stripe-secret',
        },
        'production',
      );
    }).toThrow(/Stripe config is incomplete/);
  });
});
