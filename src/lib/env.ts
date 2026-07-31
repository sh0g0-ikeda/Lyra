import 'dotenv/config';
import { z } from 'zod';
import {
  DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS,
  DEFAULT_GENERATION_ACTIVE_JOB_LIMITS,
} from '../domain/constants/generation.js';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/lyra'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_SSL_MODE: z.enum(['disable', 'require']).default(process.env.NODE_ENV === 'production' ? 'require' : 'disable'),
  DATABASE_SSL_CA_FILE: z.string().min(1).optional(),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),
  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),
  CORS_ALLOWED_ORIGINS: z.string().min(1).optional(),
  WEB_STATIC_DIR: z.string().min(1).optional(),
  AUTO_RUN_MIGRATIONS: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? process.env.NODE_ENV !== 'production' : value === 'true')),
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_PROVIDER: z.enum(['disabled', 'ses']).default('disabled'),
  INVITATION_EMAIL_ENABLED: z.string().optional().transform((value) => value === 'true'),
  SES_FROM_EMAIL: z.string().email().optional(),
  SES_CONFIGURATION_SET: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  SQS_QUEUE_URL_GENERATION: z.string().url().optional(),
  SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(43_200).optional(),
  SQS_GENERATION_MAX_NUMBER_OF_MESSAGES: z.coerce.number().int().min(1).max(10).default(1),
  EPISODE_EXPORT_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  SQS_QUEUE_URL_EXPORT: z.string().url().optional(),
  SQS_EXPORT_VISIBILITY_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(43_200)
    .optional(),
  SQS_EXPORT_MAX_NUMBER_OF_MESSAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1),
  S3_BUCKET_IMAGES: z.string().min(1).optional(),
  IMAGE_DELIVERY_MODE: z.enum(['cloudfront_signed', 's3_presigned']).default('cloudfront_signed'),
  IMAGES_CDN_BASE_URL: z.string().optional(),
  IMAGE_CDN_SIGNING_ENABLED: z.string().optional().transform((value) => value === 'true'),
  CLOUDFRONT_KEY_PAIR_ID: z.string().min(1).optional(),
  CLOUDFRONT_PRIVATE_KEY: z.string().min(1).optional(),
  CLOUDFRONT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(300),
  ORIGIN_GUARD_HEADER_NAME: z.string().min(1).optional(),
  ORIGIN_GUARD_HEADER_VALUE: z.string().min(1).optional(),
  S3_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  REFERENCE_CANDIDATE_TOKEN_SECRET: z.string().min(32).optional(),
  LOCAL_FILE_STORAGE_DIR: z.string().min(1).optional(),
  LOCAL_ASSET_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).default('gpt-image-2'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
  LOCAL_IMAGE_FALLBACK_ENABLED: z.string().optional().transform((value) => value === 'true'),
  LLM_PAGE_PROMPT_COMPILER_ENABLED: z.string().optional().transform((value) => value === 'true'),
  LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED: z.string().optional().transform((value) => value === 'true'),
  LLM_PAGE_GENERATION_PLANNER_ENABLED: z.string().optional().transform((value) => value === 'true'),
  EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  EPISODE_PAGE_PLAN_ADAPTIVE_PACKING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  EPISODE_PLAN_INLINE_REPAIR_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  EPISODE_STORY_AUTOFILL_CANCELLATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  GENERATION_JOB_CANCELLATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  GENERATION_USER_ACTIVE_JOB_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_GENERATION_ACTIVE_JOB_LIMITS.PER_USER),
  GENERATION_GLOBAL_ACTIVE_JOB_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_GENERATION_ACTIVE_JOB_LIMITS.GLOBAL),
  EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.PER_USER),
  EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS.GLOBAL),
  GENERATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? process.env.NODE_ENV !== 'production' : value === 'true')),
  PAGE_GENERATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  ENTITY_GENERATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  ENTITY_IMPORT_ANALYSIS_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_STANDARD_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PREMIUM_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE_A_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE_B_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE_C_MONTHLY: z.string().min(1).optional(),
  STRIPE_ENTERPRISE_A_PRICE_ID: z.string().min(1).optional(),
  STRIPE_ENTERPRISE_B_PRICE_ID: z.string().min(1).optional(),
  STRIPE_ENTERPRISE_C_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_200: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_1000: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_3000: z.string().min(1).optional(),
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),
  MOBILE_STORE_BILLING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  ACCOUNT_DELETION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  ACCOUNT_DELETION_IDENTITY_HASH_SECRET: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
  ACCOUNT_DELETION_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(3_600_000)
    .default(30_000),
  ACCOUNT_DELETION_RECOVERY_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  MOBILE_STORE_IDENTIFIER_HASH_SECRET: z.string().min(1).optional(),
  MOBILE_STORE_PROVIDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),
  APPLE_STORE_BUNDLE_ID: z.string().min(1).optional(),
  APPLE_STORE_APP_APPLE_ID: z.coerce.number().int().positive().optional(),
  APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON: z.string().min(1).optional(),
  APPLE_STORE_ALLOW_SANDBOX: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  APPLE_STORE_PRODUCT_STANDARD_MONTHLY: z.string().min(1).max(255).optional(),
  APPLE_STORE_PRODUCT_PREMIUM_MONTHLY: z.string().min(1).max(255).optional(),
  APPLE_STORE_PRODUCT_CREDITS_200: z.string().min(1).max(255).optional(),
  APPLE_STORE_PRODUCT_CREDITS_1000: z.string().min(1).max(255).optional(),
  APPLE_STORE_PRODUCT_CREDITS_3000: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: z.string().min(1).optional(),
  GOOGLE_PLAY_PUBSUB_AUDIENCE: z.string().url().optional(),
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PLAY_ALLOW_TEST_PURCHASES: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_PRODUCT_CREDITS_200: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_PRODUCT_CREDITS_1000: z.string().min(1).max(255).optional(),
  GOOGLE_PLAY_PRODUCT_CREDITS_3000: z.string().min(1).max(255).optional(),
  AUTH_PROVIDER: z.enum(['supabase', 'cognito']).default('supabase'),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  COGNITO_ALLOWED_CLIENT_IDS: z.string().min(1).optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_JWKS_URI: z.string().url().optional(),
  COGNITO_TOKEN_USE: z.enum(['access', 'id']).default('id'),
  COGNITO_REQUIRED_SCOPES: z.string().min(1).optional(),
  COGNITO_REQUIRED_GROUPS: z.string().min(1).optional(),
  ENTERPRISE_STYLE_REFERENCES_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  ENTERPRISE_FEATURES_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  ADMIN_USER_EMAILS: z.string().optional().default(''),
  DEV_AUTH_BYPASS: z.string().optional().transform((value) => value === 'true'),
  DEV_AUTH_BYPASS_SUPABASE_ID: z.string().min(1).optional(),
  DEV_AUTH_BYPASS_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);
