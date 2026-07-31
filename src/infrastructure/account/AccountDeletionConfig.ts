import { ConfigurationError } from '../../domain/errors/index.js';
import type { Env } from '../../lib/env.js';

export interface AccountDeletionConfig {
  region: string;
  userPoolId: string;
  bucket: string;
  stripeSecretKey: string;
  identityHashSecret: string;
  recoveryIntervalMs: number;
  recoveryBatchSize: number;
}

export function resolveAccountDeletionConfig(
  env: Env,
): AccountDeletionConfig | null {
  if (!env.ACCOUNT_DELETION_ENABLED) {
    return null;
  }

  const required = {
    region: env.AWS_REGION,
    userPoolId: env.COGNITO_USER_POOL_ID,
    bucket: env.S3_BUCKET_IMAGES,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    identityHashSecret: env.ACCOUNT_DELETION_IDENTITY_HASH_SECRET,
  };
  if (
    env.AUTH_PROVIDER !== 'cognito'
    || Object.values(required).some(
      (value) => value === undefined || value.length === 0,
    )
  ) {
    throw new ConfigurationError(
      'ACCOUNT_DELETION_ENABLED=true requires AUTH_PROVIDER=cognito, AWS_REGION, COGNITO_USER_POOL_ID, S3_BUCKET_IMAGES, STRIPE_SECRET_KEY, and ACCOUNT_DELETION_IDENTITY_HASH_SECRET',
    );
  }

  return {
    region: requireValue(required.region),
    userPoolId: requireValue(required.userPoolId),
    bucket: requireValue(required.bucket),
    stripeSecretKey: requireValue(required.stripeSecretKey),
    identityHashSecret: requireValue(required.identityHashSecret),
    recoveryIntervalMs: env.ACCOUNT_DELETION_RECOVERY_INTERVAL_MS,
    recoveryBatchSize: env.ACCOUNT_DELETION_RECOVERY_BATCH_SIZE,
  };
}

function requireValue(value: string | undefined): string {
  if (value === undefined) {
    throw new ConfigurationError('Account deletion configuration is incomplete');
  }
  return value;
}
