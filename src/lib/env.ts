import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/lyra'),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
