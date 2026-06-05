import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import { assertProductionRuntimeConfig } from '../../../src/lib/runtimeGuards.js';

const safeProductionConfig = {
  DEV_AUTH_BYPASS: false,
  SUPABASE_JWT_SECRET: 'supabase-secret',
  OPENAI_API_KEY: 'openai-key',
  SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123/lyra-generation',
  S3_BUCKET_IMAGES: 'lyra-images',
  IMAGES_CDN_BASE_URL: 'https://images.lyra.test',
};

describe('assertProductionRuntimeConfig', () => {
  it('production 以外では未設定の外部サービスを許容する', () => {
    expect(() => {
      assertProductionRuntimeConfig(
        {
          DEV_AUTH_BYPASS: true,
        },
        'development',
      );
    }).not.toThrow();
  });

  it('安全な production 設定は許容する', () => {
    expect(() => {
      assertProductionRuntimeConfig(safeProductionConfig, 'production');
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
