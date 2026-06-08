import { ConfigurationError } from '../domain/errors/index.js';

interface RuntimeGuardConfig {
  DEV_AUTH_BYPASS: boolean;
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

  const authProvider = config.AUTH_PROVIDER ?? 'supabase';
  if (authProvider === 'supabase') {
    if (config.SUPABASE_JWT_SECRET === undefined) {
      violations.push('SUPABASE_JWT_SECRET is required');
    }
  } else {
    if (config.COGNITO_CLIENT_ID === undefined) {
      violations.push('COGNITO_CLIENT_ID is required');
    }

    if (config.COGNITO_REQUIRED_SCOPES === undefined) {
      violations.push('COGNITO_REQUIRED_SCOPES is required');
    }

    if (
      config.COGNITO_ISSUER === undefined &&
      (config.AWS_REGION === undefined || config.COGNITO_USER_POOL_ID === undefined)
    ) {
      violations.push('COGNITO_ISSUER or AWS_REGION + COGNITO_USER_POOL_ID is required');
    }
  }

  if (config.LOCAL_FILE_STORAGE_DIR !== undefined || config.LOCAL_ASSET_BASE_URL !== undefined) {
    violations.push('local asset storage must not be enabled');
  }

  if (config.LOCAL_IMAGE_FALLBACK_ENABLED === true) {
    violations.push('LOCAL_IMAGE_FALLBACK_ENABLED must be disabled');
  }

  for (const key of REQUIRED_PRODUCTION_GENERATION_KEYS) {
    if (config[key] === undefined) {
      violations.push(`${key} is required`);
    }
  }

  const configuredStripeKeys = STRIPE_KEYS.filter((key) => config[key] !== undefined);
  if (configuredStripeKeys.length > 0 && configuredStripeKeys.length < STRIPE_KEYS.length) {
    const missingStripeKeys = STRIPE_KEYS.filter((key) => config[key] === undefined);
    violations.push(`Stripe config is incomplete: ${missingStripeKeys.join(', ')}`);
  }

  if (violations.length > 0) {
    throw new ConfigurationError(`Production runtime config is unsafe: ${violations.join('; ')}`);
  }
}
