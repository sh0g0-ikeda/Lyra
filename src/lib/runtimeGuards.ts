import { ConfigurationError } from '../domain/errors/index.js';
import { MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS } from '../domain/constants/generation.js';

interface RuntimeGuardConfig {
  DEV_AUTH_BYPASS: boolean;
  DATABASE_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
  AUTO_RUN_MIGRATIONS?: boolean;
  AUTH_PROVIDER?: 'supabase' | 'cognito';
  SUPABASE_JWT_SECRET?: string;
  AWS_REGION?: string;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  COGNITO_ISSUER?: string;
  COGNITO_TOKEN_USE?: 'access' | 'id';
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
  'AWS_REGION',
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

const PRODUCTION_PUBLIC_URL_KEYS = [
  'IMAGES_CDN_BASE_URL',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
] as const;

const PRODUCTION_NON_PLACEHOLDER_KEYS = [
  'DATABASE_URL',
  'AWS_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'COGNITO_ISSUER',
  'OPENAI_API_KEY',
  'SQS_QUEUE_URL_GENERATION',
  'S3_BUCKET_IMAGES',
  'IMAGES_CDN_BASE_URL',
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
  const unsafeCorsOrigins = findUnsafeProductionCorsOrigins(config.CORS_ALLOWED_ORIGINS);
  if (unsafeCorsOrigins.length > 0) {
    violations.push(`CORS_ALLOWED_ORIGINS contains unsafe production origins: ${unsafeCorsOrigins.join(', ')}`);
  }

  if (isMissingConfigValue(config.DATABASE_URL)) {
    violations.push('DATABASE_URL is required');
  } else {
    const databaseUrl = config.DATABASE_URL;
    if (databaseUrl !== undefined && isLocalDatabaseUrl(databaseUrl)) {
      violations.push('DATABASE_URL must not point to a local database in production');
    }
  }

  if (config.AUTH_PROVIDER !== 'cognito') {
    violations.push('AUTH_PROVIDER must be cognito in production');
  } else {
    const cognitoTokenUse = config.COGNITO_TOKEN_USE ?? 'id';
    if (isMissingConfigValue(config.COGNITO_CLIENT_ID)) {
      violations.push('COGNITO_CLIENT_ID is required');
    }

    if (cognitoTokenUse === 'access' && isMissingConfigValue(config.COGNITO_REQUIRED_SCOPES)) {
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

  for (const key of PRODUCTION_NON_PLACEHOLDER_KEYS) {
    if (hasPlaceholderConfigValue(config[key])) {
      violations.push(`${key} must not use a placeholder value`);
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
  const placeholderStripeKeys = STRIPE_KEYS.filter((key) => hasPlaceholderConfigValue(config[key]));
  if (placeholderStripeKeys.length > 0) {
    violations.push(`Stripe config contains placeholder values: ${placeholderStripeKeys.join(', ')}`);
  }

  for (const key of PRODUCTION_PUBLIC_URL_KEYS) {
    const value = config[key];
    if (value !== undefined && !isSafeProductionHttpsUrl(value)) {
      violations.push(`${key} must use https and a non-local host in production`);
    }
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

function hasPlaceholderConfigValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return (
    normalizedValue.includes('replace-me') ||
    normalizedValue.includes('replace_me') ||
    normalizedValue.includes('replace me') ||
    normalizedValue.includes('placeholder') ||
    normalizedValue.includes('change-me') ||
    normalizedValue.includes('change_me') ||
    normalizedValue.includes('changeme') ||
    normalizedValue === 'dummy' ||
    normalizedValue.includes('-dummy') ||
    normalizedValue.includes('_dummy')
  );
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

function findUnsafeProductionCorsOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*' && !isSafeProductionHttpsUrl(origin));
}

function isLocalDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isLocalHostname(url.hostname);
  } catch {
    const normalizedValue = value.toLowerCase();
    return (
      normalizedValue.includes('@localhost') ||
      normalizedValue.includes('@127.0.0.1') ||
      normalizedValue.includes('@[::1]') ||
      normalizedValue.includes('host=localhost') ||
      normalizedValue.includes('host=127.0.0.1') ||
      normalizedValue.includes('host=::1')
    );
  }
}

function isSafeProductionHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1';
}
