import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError, ValidationError } from '../../../src/domain/errors/index.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createRequestContextMiddleware } from '../../../src/middleware/requestContext.js';
import type { AppEnv } from '../../../src/types/app.js';

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('hides 500-level AppError details in production responses', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => {
      throw new ConfigurationError('S3_BUCKET_IMAGES is required');
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('keeps 4xx AppError details visible in production responses', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => {
      throw new ValidationError('name is required');
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'name is required',
      },
    });
  });

  it('sanitizes public 4xx AppError response messages', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeToken = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJ1c2VyIn0xxxxxxxxxxxxxxxxxxxxxxxx',
      'signaturexxxxxxxxxxxxxxxxxxxxxxxx',
    ].join('.');
    const app = buildApp(() => {
      throw new ValidationError(`bad input Authorization: Bearer ${fakeToken} ${'x'.repeat(500)}`);
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toContain('Bearer [redacted]');
    expect(payload.error.message).not.toContain(fakeToken);
    expect(payload.error.message.length).toBeLessThanOrEqual(300);
  });

  it('hides unexpected error details in all responses', async () => {
    process.env.NODE_ENV = 'development';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fakeApiKey = ['sk', 'testsecret123'].join('-');
    const app = buildApp(() => {
      throw new Error(`provider failed Authorization: Bearer ${fakeApiKey}`);
    });

    const response = await app.request('/boom');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as { message: string };
    expect(logged.message).toContain('Bearer [redacted]');
    expect(logged.message).not.toContain(fakeApiKey);
  });
});

function buildApp(handler: () => never): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use('*', createRequestContextMiddleware());
  app.get('/boom', handler);
  return app;
}
