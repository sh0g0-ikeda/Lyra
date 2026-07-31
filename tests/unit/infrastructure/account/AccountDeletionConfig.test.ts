import { describe, expect, it } from 'vitest';
import { resolveAccountDeletionConfig } from '../../../../src/infrastructure/account/AccountDeletionConfig.js';
import { parseEnv } from '../../../../src/lib/env.js';

describe('AccountDeletionConfig', () => {
  it('feature無効時の空secretは未設定として扱う', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ACCOUNT_DELETION_ENABLED: 'false',
      ACCOUNT_DELETION_IDENTITY_HASH_SECRET: '',
    });

    expect(env.ACCOUNT_DELETION_IDENTITY_HASH_SECRET).toBeUndefined();
    expect(resolveAccountDeletionConfig(env)).toBeNull();
  });

  it('flag未指定は既定OFFで既存runtimeに追加設定を要求しない', () => {
    const env = parseEnv({ NODE_ENV: 'test' });

    expect(resolveAccountDeletionConfig(env)).toBeNull();
  });

  it('enabled時はCognito・S3・Stripe・専用secretをfail closedで要求する', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ACCOUNT_DELETION_ENABLED: 'true',
    });

    expect(() => resolveAccountDeletionConfig(env)).toThrow(
      'ACCOUNT_DELETION_ENABLED=true requires',
    );
  });

  it('必要設定が揃えばbounded recovery設定を返す', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ACCOUNT_DELETION_ENABLED: 'true',
      ACCOUNT_DELETION_IDENTITY_HASH_SECRET:
        'account-deletion-secret-with-32-bytes',
      AUTH_PROVIDER: 'cognito',
      AWS_REGION: 'ap-northeast-1',
      COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
      S3_BUCKET_IMAGES: 'private-images',
      STRIPE_SECRET_KEY: 'sk_test_example',
      ACCOUNT_DELETION_RECOVERY_INTERVAL_MS: '45000',
      ACCOUNT_DELETION_RECOVERY_BATCH_SIZE: '12',
    });

    expect(resolveAccountDeletionConfig(env)).toEqual({
      region: 'ap-northeast-1',
      userPoolId: 'ap-northeast-1_pool',
      bucket: 'private-images',
      stripeSecretKey: 'sk_test_example',
      identityHashSecret: 'account-deletion-secret-with-32-bytes',
      recoveryIntervalMs: 45000,
      recoveryBatchSize: 12,
    });
  });
});
