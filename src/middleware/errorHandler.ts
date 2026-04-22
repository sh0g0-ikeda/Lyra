import type { ErrorHandler } from 'hono';
import { AppError } from '../domain/errors/index.js';
import type { AppEnv } from '../types/app.js';

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.statusCode);
  }

  console.error('Unexpected error:', error);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500,
  );
};
