import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/lyra'),
  AWS_REGION: z.string().min(1).optional(),
  S3_BUCKET_IMAGES: z.string().min(1).optional(),
  IMAGES_CDN_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
