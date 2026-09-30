import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../domain/errors/index.js';

const TOKEN_VERSION = 1;
const STATE_TOKEN_VERSION = 2;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

export interface ReferenceCandidateTokenPayload {
  userId: string;
  entityId: string;
  s3Key: string;
}

export interface StateReferenceCandidateTokenPayload extends ReferenceCandidateTokenPayload {
  organizationId: string | null;
  stateId: string;
  jobId: string;
}

interface EncodedStateReferenceCandidateTokenPayload extends StateReferenceCandidateTokenPayload {
  version: typeof STATE_TOKEN_VERSION;
  target: 'entity_state';
  expiresAt: number;
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

export function createStateReferenceCandidateToken(
  payload: StateReferenceCandidateTokenPayload,
  options: ReferenceCandidateTokenOptions,
): string {
  const now = options.now ?? Date.now;
  const encodedPayload: EncodedStateReferenceCandidateTokenPayload = {
    version: STATE_TOKEN_VERSION,
    target: 'entity_state',
    userId: payload.userId,
    organizationId: payload.organizationId,
    entityId: payload.entityId,
    stateId: payload.stateId,
    jobId: payload.jobId,
    s3Key: payload.s3Key,
    expiresAt: now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  };
  const body = base64UrlEncode(JSON.stringify(encodedPayload));
  return `${body}.${signBody(body, options.secret)}`;
}

export function parseStateReferenceCandidateToken(
  token: string,
  expected: Pick<StateReferenceCandidateTokenPayload, 'userId' | 'organizationId' | 'entityId' | 'stateId'>,
  options: ReferenceCandidateTokenOptions,
): Pick<StateReferenceCandidateTokenPayload, 'jobId' | 's3Key'> {
  const now = options.now ?? Date.now;
  const [body, signature, ...rest] = token.split('.');
  if (body === undefined || signature === undefined || rest.length > 0) {
    throw new ValidationError('Invalid reference candidate token');
  }
  if (!safeEqual(signature, signBody(body, options.secret))) {
    throw new ValidationError('Invalid reference candidate token');
  }

  const decoded = parsePayload(body);
  if (
    decoded.version !== STATE_TOKEN_VERSION
    || decoded.target !== 'entity_state'
    || decoded.userId !== expected.userId
    || decoded.organizationId !== expected.organizationId
    || decoded.entityId !== expected.entityId
    || decoded.stateId !== expected.stateId
    || typeof decoded.jobId !== 'string'
    || decoded.jobId.length === 0
    || decoded.expiresAt <= now()
  ) {
    throw new ValidationError('Invalid reference candidate token');
  }
  return { jobId: decoded.jobId, s3Key: decoded.s3Key };
}

function parsePayload(body: string): EncodedReferenceCandidateTokenPayload & Record<string, unknown> {
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
    return value as EncodedReferenceCandidateTokenPayload & Record<string, unknown>;
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
