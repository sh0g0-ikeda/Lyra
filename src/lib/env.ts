import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/lyra'),
  AWS_REGION: z.string().min(1).optional(),
  SQS_QUEUE_URL_GENERATION: z.string().url().optional(),
  S3_BUCKET_IMAGES: z.string().min(1).optional(),
  IMAGES_CDN_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_API_VERSION: z.string().min(1).default('2023-06-01'),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
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
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
