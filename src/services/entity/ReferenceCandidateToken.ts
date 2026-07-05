import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../domain/errors/index.js';

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

export interface ReferenceCandidateTokenPayload {
  userId: string;
  entityId: string;
  s3Key: string;
}

interface EncodedReferenceCandidateTokenPayload extends ReferenceCandidateTokenPayload {
  version: number;
  expiresAt: number;
}

export interface ReferenceCandidateTokenOptions {
  secret: string;
  ttlSeconds?: number;
  now?: () => number;
}

export function createReferenceCandidateToken(
  payload: ReferenceCandidateTokenPayload,
  options: ReferenceCandidateTokenOptions,
): string {
  const now = options.now ?? Date.now;
  const encodedPayload: EncodedReferenceCandidateTokenPayload = {
    version: TOKEN_VERSION,
    userId: payload.userId,
    entityId: payload.entityId,
    s3Key: payload.s3Key,
    expiresAt: now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  };
  const body = base64UrlEncode(JSON.stringify(encodedPayload));
  const signature = signBody(body, options.secret);
  return `${body}.${signature}`;
}

export function parseReferenceCandidateToken(
  token: string,
  expected: Pick<ReferenceCandidateTokenPayload, 'userId' | 'entityId'>,
  options: ReferenceCandidateTokenOptions,
): string {
  const now = options.now ?? Date.now;
  const [body, signature, ...rest] = token.split('.');
  if (body === undefined || signature === undefined || rest.length > 0) {
    throw new ValidationError('Invalid reference candidate token');
  }

  const expectedSignature = signBody(body, options.secret);
  if (!safeEqual(signature, expectedSignature)) {
    throw new ValidationError('Invalid reference candidate token');
  }

  const decoded = parsePayload(body);
  if (
    decoded.version !== TOKEN_VERSION ||
    decoded.userId !== expected.userId ||
    decoded.entityId !== expected.entityId ||
    decoded.expiresAt <= now()
  ) {
    throw new ValidationError('Invalid reference candidate token');
  }

  return decoded.s3Key;
}

function parsePayload(body: string): EncodedReferenceCandidateTokenPayload {
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as EncodedReferenceCandidateTokenPayload).version !== 'number' ||
      typeof (value as EncodedReferenceCandidateTokenPayload).userId !== 'string' ||
      typeof (value as EncodedReferenceCandidateTokenPayload).entityId !== 'string' ||
      typeof (value as EncodedReferenceCandidateTokenPayload).s3Key !== 'string' ||
      typeof (value as EncodedReferenceCandidateTokenPayload).expiresAt !== 'number'
    ) {
      throw new Error('Invalid payload');
    }
    return value as EncodedReferenceCandidateTokenPayload;
  } catch {
    throw new ValidationError('Invalid reference candidate token');
  }
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
