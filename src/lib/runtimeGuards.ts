import { ConfigurationError } from '../domain/errors/index.js';
import {
  MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS,
  MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS,
} from '../domain/constants/generation.js';
import { assertMobileStoreBillingRuntimeConfig } from '../infrastructure/mobileStore/MobileStoreBillingConfig.js';
import { resolvePushNotificationRuntimeConfig } from '../infrastructure/push/PushNotificationRuntime.js';

interface RuntimeGuardConfig {
  APP_ENV?: 'development' | 'test' | 'production';
  DEV_AUTH_BYPASS: boolean;
  DATABASE_URL?: string;
  DATABASE_POOL_MAX?: number;
  DATABASE_SSL_MODE?: 'disable' | 'require';
  DATABASE_STATEMENT_TIMEOUT_MS?: number;
  DATABASE_QUERY_TIMEOUT_MS?: number;
  CORS_ALLOWED_ORIGINS?: string;
  AUTO_RUN_MIGRATIONS?: boolean;
  APP_PUBLIC_URL?: string;
  AUTH_PROVIDER?: 'supabase' | 'cognito';
  SUPABASE_JWT_SECRET?: string;
  AWS_REGION?: string;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  COGNITO_ALLOWED_CLIENT_IDS?: string;
  COGNITO_ISSUER?: string;
  COGNITO_JWKS_URI?: string;
  COGNITO_TOKEN_USE?: 'access' | 'id';
  COGNITO_REQUIRED_SCOPES?: string;
  LOCAL_FILE_STORAGE_DIR?: string;
  LOCAL_ASSET_BASE_URL?: string;
  LOCAL_IMAGE_FALLBACK_ENABLED?: boolean;
  LLM_PAGE_PROMPT_COMPILER_ENABLED?: boolean;
  LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED?: boolean;
  LLM_PAGE_GENERATION_PLANNER_ENABLED?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_TIMEOUT_MS?: number;
  SQS_QUEUE_URL_GENERATION?: string;
  SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS?: number;
  S3_BUCKET_IMAGES?: string;
  IMAGE_DELIVERY_MODE?: 'cloudfront_signed' | 's3_presigned';
  IMAGES_CDN_BASE_URL?: string;
  IMAGE_CDN_SIGNING_ENABLED?: boolean;
  CLOUDFRONT_KEY_PAIR_ID?: string;
  CLOUDFRONT_PRIVATE_KEY?: string;
  CLOUDFRONT_SIGNED_URL_TTL_SECONDS?: number;
  REFERENCE_CANDIDATE_TOKEN_SECRET?: string;
  ORIGIN_GUARD_HEADER_NAME?: string;
  ORIGIN_GUARD_HEADER_VALUE?: string;
  S3_PRESIGNED_URL_TTL_SECONDS?: number;
  GENERATION_USER_ACTIVE_JOB_LIMIT?: number;
  GENERATION_GLOBAL_ACTIVE_JOB_LIMIT?: number;
  EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT?: number;
  EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT?: number;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STANDARD_MONTHLY?: string;
  STRIPE_PRICE_PREMIUM_MONTHLY?: string;
  STRIPE_PRICE_ENTERPRISE_A_MONTHLY?: string;
  STRIPE_PRICE_ENTERPRISE_B_MONTHLY?: string;
  STRIPE_PRICE_ENTERPRISE_C_MONTHLY?: string;
  STRIPE_PRICE_CREDITS_200?: string;
  STRIPE_PRICE_CREDITS_1000?: string;
  STRIPE_PRICE_CREDITS_3000?: string;
  STRIPE_CHECKOUT_SUCCESS_URL?: string;
  STRIPE_CHECKOUT_CANCEL_URL?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
  MOBILE_STORE_BILLING_ENABLED?: boolean;
  MOBILE_STORE_IDENTIFIER_HASH_SECRET?: string;
  APPLE_STORE_BUNDLE_ID?: string;
  APPLE_STORE_APP_APPLE_ID?: number;
  APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON?: string;
  APPLE_STORE_ALLOW_SANDBOX?: boolean;
  APPLE_STORE_PRODUCT_STANDARD_MONTHLY?: string;
  APPLE_STORE_PRODUCT_PREMIUM_MONTHLY?: string;
  APPLE_STORE_PRODUCT_CREDITS_200?: string;
  APPLE_STORE_PRODUCT_CREDITS_1000?: string;
  APPLE_STORE_PRODUCT_CREDITS_3000?: string;
  GOOGLE_PLAY_PACKAGE_NAME?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?: string;
  GOOGLE_PLAY_PUBSUB_AUDIENCE?: string;
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PLAY_ALLOW_TEST_PURCHASES?: boolean;
  GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY?: string;
  GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_200?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_1000?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_3000?: string;
  PUSH_NOTIFICATIONS_ENABLED?: boolean;
  PUSH_TOKEN_ENCRYPTION_KEY_BASE64?: string;
  PUSH_TOKEN_HASH_KEY_BASE64?: string;
  PUSH_TOKEN_ENCRYPTION_KEY_ID?: string;
  PUSH_APNS_TEAM_ID?: string;
  PUSH_APNS_KEY_ID?: string;
  PUSH_APNS_PRIVATE_KEY_BASE64?: string;
  PUSH_APNS_BUNDLE_ID?: string;
  PUSH_APNS_ENVIRONMENT?: 'sandbox' | 'production';
  PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64?: string;
  PUSH_PROVIDER_TIMEOUT_MS?: number;
  PUSH_DELIVERY_INTERVAL_MS?: number;
}

const MAX_PRODUCTION_DATABASE_POOL_MAX = 10;
const MAX_PRODUCTION_DATABASE_TIMEOUT_MS = 60_000;
const SQS_VISIBILITY_TIMEOUT_BUFFER_SECONDS = 120;
const MIN_PRODUCTION_SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS = 1800;

const REQUIRED_PRODUCTION_GENERATION_KEYS = [
  'AWS_REGION',
  'OPENAI_API_KEY',
  'OPENAI_IMAGE_MODEL',
  'SQS_QUEUE_URL_GENERATION',
  'S3_BUCKET_IMAGES',
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

const STRIPE_PRICE_KEYS = [
  'STRIPE_PRICE_STANDARD_MONTHLY',
  'STRIPE_PRICE_PREMIUM_MONTHLY',
  'STRIPE_PRICE_ENTERPRISE_A_MONTHLY',
  'STRIPE_PRICE_ENTERPRISE_B_MONTHLY',
  'STRIPE_PRICE_ENTERPRISE_C_MONTHLY',
  'STRIPE_PRICE_CREDITS_200',
  'STRIPE_PRICE_CREDITS_1000',
  'STRIPE_PRICE_CREDITS_3000',
] as const;

const OPTIONAL_STRIPE_PRICE_KEYS = [
  'STRIPE_PRICE_ENTERPRISE_A_MONTHLY',
  'STRIPE_PRICE_ENTERPRISE_B_MONTHLY',
  'STRIPE_PRICE_ENTERPRISE_C_MONTHLY',
] as const;

const PRODUCTION_PUBLIC_URL_KEYS = [
  'APP_PUBLIC_URL',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
] as const;

const PRODUCTION_EXTERNAL_URL_KEYS = [
  'OPENAI_BASE_URL',
  'SQS_QUEUE_URL_GENERATION',
  'COGNITO_ISSUER',
  'COGNITO_JWKS_URI',
] as const;

const PRODUCTION_NON_PLACEHOLDER_KEYS = [
  'DATABASE_URL',
  'AWS_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'COGNITO_ALLOWED_CLIENT_IDS',
  'COGNITO_ISSUER',
  'COGNITO_JWKS_URI',
  'REFERENCE_CANDIDATE_TOKEN_SECRET',
  'OPENAI_API_KEY',
  'OPENAI_IMAGE_MODEL',
  'OPENAI_BASE_URL',
  'SQS_QUEUE_URL_GENERATION',
  'S3_BUCKET_IMAGES',
] as const;

export function assertProductionRuntimeConfig(
  config: RuntimeGuardConfig,
  nodeEnv = process.env.NODE_ENV,
): void {
  const appEnv = config.APP_ENV;
  const isProductionRuntime = nodeEnv === 'production' || appEnv === 'production';
  const violations: string[] = [];

  if (config.DEV_AUTH_BYPASS && !isDevAuthBypassRuntimeAllowed(appEnv, nodeEnv)) {
    violations.push('DEV_AUTH_BYPASS is only allowed in explicit development or test runtimes');
  }

  if (!isProductionRuntime) {
    if (violations.length > 0) {
      throw new ConfigurationError(`Runtime config is unsafe: ${violations.join('; ')}`);
    }
    return;
  }

  if (appEnv === 'production' && nodeEnv !== 'production') {
    violations.push('NODE_ENV must be production when APP_ENV is production');
  }

  if (nodeEnv === 'production' && appEnv !== undefined && appEnv !== 'production') {
    violations.push('APP_ENV must be production when NODE_ENV is production');
  }

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
    if (databaseUrl !== undefined && databaseUrlDisablesSsl(databaseUrl)) {
      violations.push('DATABASE_URL must not disable SSL in production');
    }
  }

  if (config.DATABASE_SSL_MODE !== undefined && config.DATABASE_SSL_MODE !== 'require') {
    violations.push('DATABASE_SSL_MODE must be require in production');
  }

  if (
    config.DATABASE_STATEMENT_TIMEOUT_MS !== undefined &&
    (config.DATABASE_STATEMENT_TIMEOUT_MS < 1 ||
      config.DATABASE_STATEMENT_TIMEOUT_MS > MAX_PRODUCTION_DATABASE_TIMEOUT_MS)
  ) {
    violations.push(`DATABASE_STATEMENT_TIMEOUT_MS must be between 1 and ${MAX_PRODUCTION_DATABASE_TIMEOUT_MS} in production`);
  }

  if (
    config.DATABASE_QUERY_TIMEOUT_MS !== undefined &&
    (config.DATABASE_QUERY_TIMEOUT_MS < 1 ||
      config.DATABASE_QUERY_TIMEOUT_MS > MAX_PRODUCTION_DATABASE_TIMEOUT_MS)
  ) {
    violations.push(`DATABASE_QUERY_TIMEOUT_MS must be between 1 and ${MAX_PRODUCTION_DATABASE_TIMEOUT_MS} in production`);
  }

  if (
    config.DATABASE_POOL_MAX !== undefined &&
    (config.DATABASE_POOL_MAX < 1 || config.DATABASE_POOL_MAX > MAX_PRODUCTION_DATABASE_POOL_MAX)
  ) {
    violations.push(`DATABASE_POOL_MAX must be <= ${MAX_PRODUCTION_DATABASE_POOL_MAX} in production`);
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

  if (config.LLM_PAGE_PROMPT_COMPILER_ENABLED !== true) {
    violations.push('LLM_PAGE_PROMPT_COMPILER_ENABLED must be true in production');
  }

  if (config.LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED !== true) {
    violations.push('LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED must be true in production');
  }

  if (config.LLM_PAGE_GENERATION_PLANNER_ENABLED !== true) {
    violations.push('LLM_PAGE_GENERATION_PLANNER_ENABLED must be true in production');
  }

  const imageDeliveryMode = config.IMAGE_DELIVERY_MODE ?? 'cloudfront_signed';
  if (isMissingConfigValue(config.ORIGIN_GUARD_HEADER_NAME)) {
    violations.push('ORIGIN_GUARD_HEADER_NAME is required');
  }
  if (isMissingConfigValue(config.ORIGIN_GUARD_HEADER_VALUE)) {
    violations.push('ORIGIN_GUARD_HEADER_VALUE is required');
  }

  for (const key of REQUIRED_PRODUCTION_GENERATION_KEYS) {
    if (isMissingConfigValue(config[key])) {
      violations.push(`${key} is required`);
    }
  }

  if (hasConfigValue(config.SQS_QUEUE_URL_GENERATION)) {
    if (config.SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS === undefined) {
      violations.push('SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS is required when SQS generation is enabled');
    } else {
      const openAiTimeoutMs = config.OPENAI_TIMEOUT_MS ?? 300_000;
      const minimumVisibilityTimeoutSeconds =
        Math.max(
          MIN_PRODUCTION_SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS,
          Math.ceil(openAiTimeoutMs / 1000) + SQS_VISIBILITY_TIMEOUT_BUFFER_SECONDS,
        );
      if (config.SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS < minimumVisibilityTimeoutSeconds) {
        violations.push(`SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS must be >= ${minimumVisibilityTimeoutSeconds}`);
      }
    }
  }

  for (const key of PRODUCTION_NON_PLACEHOLDER_KEYS) {
    if (hasPlaceholderConfigValue(config[key])) {
      violations.push(`${key} must not use a placeholder value`);
    }
  }

  if (
    config.REFERENCE_CANDIDATE_TOKEN_SECRET !== undefined &&
    config.REFERENCE_CANDIDATE_TOKEN_SECRET.trim().length < 32
  ) {
    violations.push('REFERENCE_CANDIDATE_TOKEN_SECRET must be at least 32 characters');
  }

  if (imageDeliveryMode === 'cloudfront_signed') {
    const imagesCdnBaseUrl = config.IMAGES_CDN_BASE_URL;
    if (imagesCdnBaseUrl === undefined || imagesCdnBaseUrl.trim().length === 0) {
      violations.push('IMAGES_CDN_BASE_URL is required');
    } else {
      if (hasPlaceholderConfigValue(imagesCdnBaseUrl)) {
        violations.push('IMAGES_CDN_BASE_URL must not use a placeholder value');
      }
      if (!isSafeProductionHttpsUrl(imagesCdnBaseUrl)) {
        violations.push('IMAGES_CDN_BASE_URL must use https and a non-local host in production');
      }
      if (isDirectS3Url(imagesCdnBaseUrl)) {
        violations.push('IMAGES_CDN_BASE_URL must not point directly to S3 in production');
      }
    }

    if (config.IMAGE_CDN_SIGNING_ENABLED !== true) {
      violations.push('IMAGE_CDN_SIGNING_ENABLED must be true in production');
    } else {
      if (isMissingConfigValue(config.CLOUDFRONT_KEY_PAIR_ID)) {
        violations.push('CLOUDFRONT_KEY_PAIR_ID is required when image CDN signing is enabled');
      }
      if (isMissingConfigValue(config.CLOUDFRONT_PRIVATE_KEY)) {
        violations.push('CLOUDFRONT_PRIVATE_KEY is required when image CDN signing is enabled');
      }
    }

    if (
      config.CLOUDFRONT_SIGNED_URL_TTL_SECONDS !== undefined &&
      (config.CLOUDFRONT_SIGNED_URL_TTL_SECONDS < 60 || config.CLOUDFRONT_SIGNED_URL_TTL_SECONDS > 86_400)
    ) {
      violations.push('CLOUDFRONT_SIGNED_URL_TTL_SECONDS must be between 60 and 86400');
    }
  } else if (
    config.S3_PRESIGNED_URL_TTL_SECONDS !== undefined &&
    (config.S3_PRESIGNED_URL_TTL_SECONDS < 60 || config.S3_PRESIGNED_URL_TTL_SECONDS > 3_600)
  ) {
    violations.push('S3_PRESIGNED_URL_TTL_SECONDS must be between 60 and 3600');
  }

  const openAiImageModel = config.OPENAI_IMAGE_MODEL;
  if (hasConfigValue(openAiImageModel) && !isOpenAiImageModel(openAiImageModel)) {
    violations.push('OPENAI_IMAGE_MODEL must be an OpenAI image generation model');
  }

  const openAiApiKey = config.OPENAI_API_KEY;
  if (hasConfigValue(openAiApiKey) && !openAiApiKey.trim().startsWith('sk-')) {
    violations.push('OPENAI_API_KEY must start with sk-');
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

  if (
    config.EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT !== undefined &&
    config.EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT >
      MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.PER_USER
  ) {
    violations.push(
      `EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT must be <= ${MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.PER_USER}`,
    );
  }

  if (
    config.EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT !== undefined &&
    config.EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT >
      MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.GLOBAL
  ) {
    violations.push(
      `EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT must be <= ${MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.GLOBAL}`,
    );
  }

  const missingStripeKeys = STRIPE_KEYS.filter((key) => isMissingConfigValue(config[key]));
  if (missingStripeKeys.length > 0) {
    violations.push(`Stripe config is incomplete: ${missingStripeKeys.join(', ')}`);
  }
  const placeholderStripeKeys: string[] = STRIPE_KEYS.filter((key) => hasPlaceholderConfigValue(config[key]));
  const placeholderOptionalStripePriceKeys = OPTIONAL_STRIPE_PRICE_KEYS.filter((key) =>
    hasPlaceholderConfigValue(config[key]),
  );
  placeholderStripeKeys.push(...placeholderOptionalStripePriceKeys);
  if (placeholderStripeKeys.length > 0) {
    violations.push(`Stripe config contains placeholder values: ${placeholderStripeKeys.join(', ')}`);
  }
  const stripeSecretKey = config.STRIPE_SECRET_KEY;
  if (stripeSecretKey !== undefined && hasConfigValue(stripeSecretKey) && !stripeSecretKey.trim().startsWith('sk_live_')) {
    violations.push('STRIPE_SECRET_KEY must use a live secret key in production');
  }
  const stripeWebhookSecret = config.STRIPE_WEBHOOK_SECRET;
  if (
    stripeWebhookSecret !== undefined &&
    hasConfigValue(stripeWebhookSecret) &&
    !stripeWebhookSecret.trim().startsWith('whsec_')
  ) {
    violations.push('STRIPE_WEBHOOK_SECRET must start with whsec_');
  }
  const invalidStripePriceKeys = STRIPE_PRICE_KEYS.filter((key) => {
    const value = config[key];
    return value !== undefined && hasConfigValue(value) && !value.trim().startsWith('price_');
  });
  if (invalidStripePriceKeys.length > 0) {
    violations.push(`Stripe price ids must start with price_: ${invalidStripePriceKeys.join(', ')}`);
  }

  for (const key of PRODUCTION_PUBLIC_URL_KEYS) {
    const value = config[key];
    if (value !== undefined && !isSafeProductionHttpsUrl(value)) {
      violations.push(`${key} must use https and a non-local host in production`);
    }
  }

  for (const key of PRODUCTION_EXTERNAL_URL_KEYS) {
    const value = config[key];
    if (value !== undefined && !isSafeProductionHttpsUrl(value)) {
      violations.push(`${key} must use https and a non-local host in production`);
    }
  }

  try {
    assertMobileStoreBillingRuntimeConfig(config, true);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      violations.push(error.message);
    } else {
      violations.push('Mobile store billing configuration is invalid');
    }
  }

  try {
    resolvePushNotificationRuntimeConfig({
      ...config,
      PUSH_NOTIFICATIONS_ENABLED: config.PUSH_NOTIFICATIONS_ENABLED === true,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      violations.push(error.message);
    } else {
      violations.push('Push notification configuration is invalid');
    }
  }

  if (violations.length > 0) {
    throw new ConfigurationError(`Production runtime config is unsafe: ${violations.join('; ')}`);
  }
}

export function isDevAuthBypassRuntimeAllowed(
  appEnv: RuntimeGuardConfig['APP_ENV'],
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (appEnv === 'production' || nodeEnv === 'production') {
    return false;
  }

  return appEnv === 'development' || appEnv === 'test' || nodeEnv === 'development' || nodeEnv === 'test';
}

function isMissingConfigValue(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function hasConfigValue(value: string | undefined): value is string {
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
    normalizedValue.includes('replace-with') ||
    normalizedValue.includes('replace_with') ||
    normalizedValue.includes('replace me') ||
    normalizedValue.includes('replace with') ||
    normalizedValue.includes('placeholder') ||
    normalizedValue.includes('change-me') ||
    normalizedValue.includes('change_me') ||
    normalizedValue.includes('changeme') ||
    normalizedValue.includes('your-') ||
    normalizedValue.includes('your_') ||
    normalizedValue.includes('your ') ||
    normalizedValue === 'dummy' ||
    normalizedValue.includes('-dummy') ||
    normalizedValue.includes('_dummy')
  );
}

function isOpenAiImageModel(value: string): boolean {
  return value.trim().toLowerCase().startsWith('gpt-image-');
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

function databaseUrlDisablesSsl(value: string): boolean {
  try {
    const url = new URL(value);
    return isDisabledSslValue(url.searchParams.get('sslmode')) || isDisabledSslValue(url.searchParams.get('ssl'));
  } catch {
    const normalizedValue = value.toLowerCase();
    return (
      normalizedValue.includes('sslmode=disable') ||
      normalizedValue.includes('sslmode=disabled') ||
      normalizedValue.includes('ssl=false') ||
      normalizedValue.includes('ssl=0')
    );
  }
}

function isDisabledSslValue(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return (
    normalizedValue === 'disable' ||
    normalizedValue === 'disabled' ||
    normalizedValue === 'false' ||
    normalizedValue === '0'
  );
}

function isSafeProductionHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isUnsafeProductionHostname(url.hostname);
  } catch {
    return false;
  }
}

function isDirectS3Url(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 's3.amazonaws.com' ||
      hostname.startsWith('s3.') ||
      hostname.startsWith('s3-') ||
      hostname.includes('.s3.') ||
      hostname.includes('.s3-') ||
      hostname.includes('.s3-website')
    );
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const ipv4Address = parseIpv4Address(normalizedHostname);

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '::1' ||
    normalizedHostname === '::' ||
    ipv4Address?.[0] === 127 ||
    normalizedHostname === '0.0.0.0'
  );
}

function isUnsafeProductionHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (
    isLocalHostname(normalizedHostname) ||
    normalizedHostname.endsWith('.local') ||
    normalizedHostname.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4Address = parseIpv4Address(normalizedHostname);
  if (ipv4Address !== null) {
    return isPrivateOrReservedIpv4Address(ipv4Address);
  }

  return isPrivateOrLinkLocalIpv6Hostname(normalizedHostname);
}

function parseIpv4Address(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^[0-9]+$/u.test(part)) {
      return null;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });

  if (octets.some((octet) => octet === null)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isPrivateOrReservedIpv4Address([first, second, third]: [number, number, number, number]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateOrLinkLocalIpv6Hostname(hostname: string): boolean {
  if (!hostname.includes(':')) {
    return false;
  }

  return (
    hostname === '::' ||
    hostname === '::1' ||
    hostname === '2001:db8::' ||
    hostname.startsWith('2001:db8:') ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('ff') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd')
  );
}
