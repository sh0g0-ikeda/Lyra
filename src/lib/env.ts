import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_GENERATION_ACTIVE_JOB_LIMITS } from '../domain/constants/generation.js';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/lyra'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_SSL_MODE: z.enum(['disable', 'require']).default(process.env.NODE_ENV === 'production' ? 'require' : 'disable'),
  CORS_ALLOWED_ORIGINS: z.string().min(1).optional(),
  AUTO_RUN_MIGRATIONS: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? process.env.NODE_ENV !== 'production' : value === 'true')),
  AWS_REGION: z.string().min(1).optional(),
  SQS_QUEUE_URL_GENERATION: z.string().url().optional(),
  SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(43_200).optional(),
  S3_BUCKET_IMAGES: z.string().min(1).optional(),
  IMAGES_CDN_BASE_URL: z.string().url().optional(),
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
  GENERATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? process.env.NODE_ENV !== 'production' : value === 'true')),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_STANDARD_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PREMIUM_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_200: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_1000: z.string().min(1).optional(),
  STRIPE_PRICE_CREDITS_3000: z.string().min(1).optional(),
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),
  AUTH_PROVIDER: z.enum(['supabase', 'cognito']).default('supabase'),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_JWKS_URI: z.string().url().optional(),
  COGNITO_TOKEN_USE: z.enum(['access', 'id']).default('id'),
  COGNITO_REQUIRED_SCOPES: z.string().min(1).optional(),
  COGNITO_REQUIRED_GROUPS: z.string().min(1).optional(),
  ENTERPRISE_STYLE_REFERENCES_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  DEV_AUTH_BYPASS: z.string().optional().transform((value) => value === 'true'),
  DEV_AUTH_BYPASS_SUPABASE_ID: z.string().min(1).optional(),
  DEV_AUTH_BYPASS_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);
