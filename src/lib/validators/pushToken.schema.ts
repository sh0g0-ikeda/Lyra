import { z } from 'zod';
import {
  PUSH_PLATFORMS,
  PUSH_TOKEN_LIMITS,
} from '../../domain/pushToken.js';

export const pushTokenInstallationIdSchema = z.string().uuid();

export const pushTokenRegistrationBodySchema = z.object({
  platform: z.enum(PUSH_PLATFORMS),
  installation_id: pushTokenInstallationIdSchema,
  device_token: z
    .string()
    .trim()
    .min(PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MIN_LENGTH)
    .max(PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MAX_LENGTH)
    .regex(/^\S+$/u, 'device_token must not contain whitespace'),
  locale: z.enum(['ja', 'en']).default('ja'),
}).strict();
