import { z } from 'zod';
import { MOBILE_PUSH_PLATFORMS, MOBILE_PUSH_TOKEN_LIMITS } from '../../domain/constants/mobilePush.js';
export const pushTokenInstallationIdSchema = z.string().uuid();
export const pushTokenRegistrationBodySchema = z.object({
  platform: z.enum(MOBILE_PUSH_PLATFORMS), installation_id: pushTokenInstallationIdSchema,
  device_token: z.string().trim().min(MOBILE_PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MIN_LENGTH)
    .max(MOBILE_PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MAX_LENGTH).regex(/^\S+$/u),
  locale: z.enum(['ja', 'en']).default('ja'),
}).strict();
