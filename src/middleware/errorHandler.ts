import type { ErrorHandler } from 'hono';
import { AppError } from '../domain/errors/index.js';
import type { AppEnv } from '../types/app.js';

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const requestId = c.get('requestId');

  if (error instanceof AppError) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'app_error',
        request_id: requestId,
        code: error.code,
        message: error.message,
        method: c.req.method,
        path: c.req.path,
        status: error.statusCode,
      }),
    );

    const hideServerErrorDetails = process.env.NODE_ENV === 'production' && error.statusCode >= 500;
    const responseBody = hideServerErrorDetails
      ? { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }
      : { error: { code: error.code, message: error.message } };

    c.res.headers.set('x-request-id', requestId);
    return c.json(responseBody, error.statusCode);
  }

  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unexpected_error',
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      message: error instanceof Error ? error.message : 'Unexpected error',
    }),
  );
  c.res.headers.set('x-request-id', requestId);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    500,
  );
};
