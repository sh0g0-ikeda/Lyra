import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../domain/errors/index.js';
import type { EntityType } from '../../domain/types/entity.js';

const TOKEN_VERSION = 1;
const STATE_TOKEN_VERSION = 2;
const DRAFT_TOKEN_VERSION = 3;
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

export interface DraftReferenceCandidateTokenPayload {
  userId: string;
  organizationId: string | null;
  entityType: EntityType;
  s3Key: string;
}

interface EncodedStateReferenceCandidateTokenPayload extends StateReferenceCandidateTokenPayload {
  version: typeof STATE_TOKEN_VERSION;
  target: 'entity_state';
  expiresAt: number;
}

interface EncodedReferenceCandidateTokenPayload extends ReferenceCandidateTokenPayload {
  version: typeof TOKEN_VERSION;
  expiresAt: number;
}

interface EncodedDraftReferenceCandidateTokenPayload extends DraftReferenceCandidateTokenPayload {
  version: typeof DRAFT_TOKEN_VERSION;
  target: 'entity_draft';
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
  return createReferenceCandidateTokenWithExpiry(payload, now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000, options.secret);
}

function createReferenceCandidateTokenWithExpiry(
  payload: ReferenceCandidateTokenPayload,
  expiresAt: number,
  secret: string,
): string {
  const encodedPayload: EncodedReferenceCandidateTokenPayload = {
    version: TOKEN_VERSION,
    userId: payload.userId,
    entityId: payload.entityId,
    s3Key: payload.s3Key,
    expiresAt,
  };
  const body = base64UrlEncode(JSON.stringify(encodedPayload));
  const signature = signBody(body, secret);
  return `${body}.${signature}`;
}

export function parseReferenceCandidateToken(
  token: string,
  expected: Pick<ReferenceCandidateTokenPayload, 'userId' | 'entityId'>,
  options: ReferenceCandidateTokenOptions,
): string {
  return parseReferenceCandidateTokenDetails(token, expected, options).s3Key;
}

export function parseReferenceCandidateTokenDetails(
  token: string,
  expected: Pick<ReferenceCandidateTokenPayload, 'userId' | 'entityId'>,
  options: ReferenceCandidateTokenOptions,
): { s3Key: string; expiresAt: number } {
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
    typeof decoded.userId !== 'string' ||
    typeof decoded.entityId !== 'string' ||
    typeof decoded.s3Key !== 'string' ||
    typeof decoded.expiresAt !== 'number' ||
    decoded.userId !== expected.userId ||
    decoded.entityId !== expected.entityId ||
    decoded.expiresAt <= now()
  ) {
    throw new ValidationError('Invalid reference candidate token');
  }

  return { s3Key: decoded.s3Key, expiresAt: decoded.expiresAt };
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

export function createDraftReferenceCandidateToken(
  payload: DraftReferenceCandidateTokenPayload,
  options: ReferenceCandidateTokenOptions,
): string {
  const now = options.now ?? Date.now;
  const encodedPayload: EncodedDraftReferenceCandidateTokenPayload = {
    version: DRAFT_TOKEN_VERSION,
    target: 'entity_draft',
    userId: payload.userId,
    organizationId: payload.organizationId,
    entityType: payload.entityType,
    s3Key: payload.s3Key,
    expiresAt: now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  };
  const body = base64UrlEncode(JSON.stringify(encodedPayload));
  return `${body}.${signBody(body, options.secret)}`;
}

export function parseDraftReferenceCandidateToken(
  token: string,
  expected: Pick<DraftReferenceCandidateTokenPayload, 'userId' | 'organizationId'>,
  options: ReferenceCandidateTokenOptions,
): Pick<DraftReferenceCandidateTokenPayload, 'entityType' | 's3Key'> & { expiresAt: number } {
  const decoded = verifyAndParseToken(token, options.secret);
  const now = options.now ?? Date.now;
  if (
    decoded.version !== DRAFT_TOKEN_VERSION
    || decoded.target !== 'entity_draft'
    || decoded.userId !== expected.userId
    || decoded.organizationId !== expected.organizationId
    || !isEntityType(decoded.entityType)
    || typeof decoded.s3Key !== 'string'
    || typeof decoded.expiresAt !== 'number'
    || decoded.expiresAt <= now()
  ) {
    throw new ValidationError('Invalid reference candidate token');
  }
  return {
    entityType: decoded.entityType,
    s3Key: decoded.s3Key,
    expiresAt: decoded.expiresAt,
  };
}

export function bindDraftReferenceCandidateToken(
  token: string,
  expected: Pick<DraftReferenceCandidateTokenPayload, 'userId' | 'organizationId' | 'entityType'> & { entityId: string },
  options: ReferenceCandidateTokenOptions,
): { candidateToken: string; s3Key: string } {
  const draft = parseDraftReferenceCandidateToken(token, expected, options);
  if (draft.entityType !== expected.entityType) {
    throw new ValidationError('Invalid reference candidate token');
  }
  return {
    candidateToken: createReferenceCandidateTokenWithExpiry({
      userId: expected.userId,
      entityId: expected.entityId,
      s3Key: draft.s3Key,
    }, draft.expiresAt, options.secret),
    s3Key: draft.s3Key,
  };
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
    || typeof decoded.userId !== 'string'
    || (decoded.organizationId !== null && typeof decoded.organizationId !== 'string')
    || typeof decoded.entityId !== 'string'
    || typeof decoded.stateId !== 'string'
    || typeof decoded.s3Key !== 'string'
    || typeof decoded.expiresAt !== 'number'
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

function verifyAndParseToken(token: string, secret: string): Record<string, unknown> {
  const [body, signature, ...rest] = token.split('.');
  if (body === undefined || signature === undefined || rest.length > 0) {
    throw new ValidationError('Invalid reference candidate token');
  }
  if (!safeEqual(signature, signBody(body, secret))) {
    throw new ValidationError('Invalid reference candidate token');
  }
  return parsePayload(body);
}

function parsePayload(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error('Invalid payload');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ValidationError('Invalid reference candidate token');
  }
}

function isEntityType(value: unknown): value is EntityType {
  return value === 'character' || value === 'nonhuman' || value === 'object';
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
