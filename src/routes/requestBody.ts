import type { Context } from 'hono';
import { PayloadTooLargeError, ValidationError } from '../domain/errors/index.js';
import type { AppEnv } from '../types/app.js';

export const REQUEST_BODY_LIMITS = {
  DEFAULT_JSON_BYTES: 256 * 1024,
  SMALL_JSON_BYTES: 32 * 1024,
  SAVE_AND_GENERATE_JSON_BYTES: 512 * 1024,
  STORY_JSON_BYTES: 256 * 1024,
  ENTITY_IMPORT_JSON_BYTES: 8 * 1024 * 1024,
  STRIPE_WEBHOOK_BYTES: 256 * 1024,
} as const;

export interface LimitedBodyOptions {
  maxBytes: number;
  description: string;
}

export interface JsonBodyOptions {
  maxBytes?: number;
  description?: string;
}

export async function readJsonBody(
  c: Context<AppEnv>,
  options: JsonBodyOptions = {},
): Promise<unknown> {
  const rawBody = await readLimitedTextBody(c, {
    maxBytes: options.maxBytes ?? REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
    description: options.description ?? 'JSON request',
  });

  if (rawBody.trim().length === 0) {
    throw new ValidationError('Request body must be valid JSON');
  }

  return parseJsonBody(rawBody);
}

export async function readOptionalJsonBody(
  c: Context<AppEnv>,
  options: JsonBodyOptions = {},
): Promise<unknown> {
  const rawBody = await readLimitedTextBody(c, {
    maxBytes: options.maxBytes ?? REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
    description: options.description ?? 'JSON request',
  });

  if (rawBody.trim().length === 0) {
    return {};
  }

  return parseJsonBody(rawBody);
}

export async function readLimitedRawBody(
  request: Request,
  contentLengthHeader: string | undefined,
  options: LimitedBodyOptions,
): Promise<Buffer> {
  const contentLength = parseContentLength(contentLengthHeader);
  if (contentLength !== null && contentLength > options.maxBytes) {
    throw new PayloadTooLargeError(`${options.description} payload is too large`);
  }

  if (request.body === null) {
    return Buffer.alloc(0);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > options.maxBytes) {
      throw new PayloadTooLargeError(`${options.description} payload is too large`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

async function readLimitedTextBody(
  c: Context<AppEnv>,
  options: LimitedBodyOptions,
): Promise<string> {
  const rawBody = await readLimitedRawBody(c.req.raw, c.req.header('Content-Length'), options);
  return rawBody.toString('utf8');
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new ValidationError('Content-Length must be a non-negative integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ValidationError('Content-Length must be a non-negative integer');
  }

  return parsed;
}
