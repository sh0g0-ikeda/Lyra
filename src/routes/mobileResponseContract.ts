import type { ZodType } from 'zod';
import { ConfigurationError } from '../domain/errors/index.js';

export function assertMobileResponseContract<T>(schema: ZodType, payload: T): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ConfigurationError('Mobile response contract validation failed');
  }

  return payload;
}
