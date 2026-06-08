import { ConfigurationError } from '../domain/errors/index.js';
import { MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS } from '../domain/constants/generation.js';

interface RuntimeGuardConfig {
  DEV_AUTH_BYPASS: boolean;
  CORS_ALLOWED_ORIGINS?: string;
  AUTO_RUN_MIGRATIONS?: boolean;
  AUTH_PROVIDER?: 'supabase' | 'cognito';
  SUPABASE_JWT_SECRET?: string;
  AWS_REGION?: string;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  COGNITO_ISSUER?: string;
  COGNITO_REQUIRED_SCOPES?: string;
  LOCAL_FILE_STORAGE_DIR?: string;
  LOCAL_ASSET_BASE_URL?: string;
  LOCAL_IMAGE_FALLBACK_ENABLED?: boolean;
  OPENAI_API_KEY?: string;
  SQS_QUEUE_URL_GENERATION?: string;
  S3_BUCKET_IMAGES?: string;
  IMAGES_CDN_BASE_URL?: string;
  GENERATION_USER_ACTIVE_JOB_LIMIT?: number;
  GENERATION_GLOBAL_ACTIVE_JOB_LIMIT?: number;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STANDARD_MONTHLY?: string;
  STRIPE_PRICE_PREMIUM_MONTHLY?: string;
  STRIPE_PRICE_CREDITS_200?: string;
  STRIPE_PRICE_CREDITS_1000?: string;
  STRIPE_PRICE_CREDITS_3000?: string;
  STRIPE_CHECKOUT_SUCCESS_URL?: string;
  STRIPE_CHECKOUT_CANCEL_URL?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
}

const REQUIRED_PRODUCTION_GENERATION_KEYS = [
  'OPENAI_API_KEY',
  'SQS_QUEUE_URL_GENERATION',
  'S3_BUCKET_IMAGES',
  'IMAGES_CDN_BASE_URL',
] as const;

const STRIPE_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STANDARD_MONTHLY',
  'STRIPE_PRICE_PREMIUM_MONTHLY',
  'STRIPE_PRICE_CREDITS_200',
  'STRIPE_PRICE_CREDITS_1000',
  'STRIPE_PRICE_CREDITS_3000',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
] as const;

export function assertProductionRuntimeConfig(
  config: RuntimeGuardConfig,
  nodeEnv = process.env.NODE_ENV,
): void {
  if (nodeEnv !== 'production') {
    return;
  }

  const violations: string[] = [];

  if (config.DEV_AUTH_BYPASS) {
    violations.push('DEV_AUTH_BYPASS must be disabled');
  }

  if (config.AUTO_RUN_MIGRATIONS === true) {
    violations.push('AUTO_RUN_MIGRATIONS must be disabled in production');
  }

  if (productionCorsAllowsWildcard(config.CORS_ALLOWED_ORIGINS)) {
    violations.push('CORS_ALLOWED_ORIGINS must not include * in production');
  }

  if (config.AUTH_PROVIDER !== 'cognito') {
    violations.push('AUTH_PROVIDER must be cognito in production');
  } else {
    if (isMissingConfigValue(config.COGNITO_CLIENT_ID)) {
      violations.push('COGNITO_CLIENT_ID is required');
    }

    if (isMissingConfigValue(config.COGNITO_REQUIRED_SCOPES)) {
      violations.push('COGNITO_REQUIRED_SCOPES is required');
    }

    if (
      isMissingConfigValue(config.COGNITO_ISSUER) &&
      (isMissingConfigValue(config.AWS_REGION) || isMissingConfigValue(config.COGNITO_USER_POOL_ID))
    ) {
      violations.push('COGNITO_ISSUER or AWS_REGION + COGNITO_USER_POOL_ID is required');
    }
  }

  if (hasConfigValue(config.LOCAL_FILE_STORAGE_DIR) || hasConfigValue(config.LOCAL_ASSET_BASE_URL)) {
    violations.push('local asset storage must not be enabled');
  }

  if (config.LOCAL_IMAGE_FALLBACK_ENABLED === true) {
    violations.push('LOCAL_IMAGE_FALLBACK_ENABLED must be disabled');
  }

  for (const key of REQUIRED_PRODUCTION_GENERATION_KEYS) {
    if (isMissingConfigValue(config[key])) {
      violations.push(`${key} is required`);
    }
  }

  if (
    config.GENERATION_USER_ACTIVE_JOB_LIMIT !== undefined &&
    config.GENERATION_USER_ACTIVE_JOB_LIMIT > MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS.PER_USER
  ) {
    violations.push(
      `GENERATION_USER_ACTIVE_JOB_LIMIT must be <= ${MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS.PER_USER}`,
    );
  }

  if (
    config.GENERATION_GLOBAL_ACTIVE_JOB_LIMIT !== undefined &&
    config.GENERATION_GLOBAL_ACTIVE_JOB_LIMIT > MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS.GLOBAL
  ) {
    violations.push(
      `GENERATION_GLOBAL_ACTIVE_JOB_LIMIT must be <= ${MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS.GLOBAL}`,
    );
  }

  const missingStripeKeys = STRIPE_KEYS.filter((key) => isMissingConfigValue(config[key]));
  if (missingStripeKeys.length > 0) {
    violations.push(`Stripe config is incomplete: ${missingStripeKeys.join(', ')}`);
  }

  if (violations.length > 0) {
    throw new ConfigurationError(`Production runtime config is unsafe: ${violations.join('; ')}`);
  }
}

function isMissingConfigValue(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function hasConfigValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function productionCorsAllowsWildcard(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .some((origin) => origin === '*');
}
