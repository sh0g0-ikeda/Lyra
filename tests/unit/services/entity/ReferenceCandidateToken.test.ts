import { describe, expect, it } from 'vitest';
import {
  bindDraftReferenceCandidateToken,
  createDraftReferenceCandidateToken,
  createReferenceCandidateToken,
  createStateReferenceCandidateToken,
  parseDraftReferenceCandidateToken,
  parseReferenceCandidateToken,
  parseStateReferenceCandidateToken,
} from '../../../../src/services/entity/ReferenceCandidateToken.js';

const options = { secret: 'test-only-secret', now: () => 1_800_000_000_000 };

describe('ReferenceCandidateToken', () => {
  it('旧base候補v1の場合に元のentity経路で検証できる', () => {
    const token = createReferenceCandidateToken({
      userId: 'user-1', entityId: 'entity-1', s3Key: 'session/user-1/entities/entity-1/base.png',
    }, options);

    expect(parseReferenceCandidateToken(token, {
      userId: 'user-1', entityId: 'entity-1',
    }, options)).toBe('session/user-1/entities/entity-1/base.png');
    expect(() => parseStateReferenceCandidateToken(token, {
      userId: 'user-1', organizationId: null, entityId: 'entity-1', stateId: 'state-1',
    }, options)).toThrow();
  });

  it('状態候補v2の場合にuser tenant entity state jobとkeyを束縛する', () => {
    const token = createStateReferenceCandidateToken({
      userId: 'actor-1', organizationId: 'org-1', entityId: 'entity-1',
      stateId: 'state-1', jobId: 'job-1', s3Key: 'session/actor-1/entities/entity-1/job-1-1.png',
    }, options);

    expect(parseStateReferenceCandidateToken(token, {
      userId: 'actor-1', organizationId: 'org-1', entityId: 'entity-1', stateId: 'state-1',
    }, options)).toEqual({
      jobId: 'job-1', s3Key: 'session/actor-1/entities/entity-1/job-1-1.png',
    });
    for (const changed of [
      { userId: 'actor-2' }, { organizationId: 'org-2' },
      { entityId: 'entity-2' }, { stateId: 'state-2' },
    ]) {
      expect(() => parseStateReferenceCandidateToken(token, {
        userId: 'actor-1', organizationId: 'org-1', entityId: 'entity-1', stateId: 'state-1',
        ...changed,
      }, options)).toThrow();
    }
    expect(() => parseReferenceCandidateToken(token, {
      userId: 'actor-1', entityId: 'entity-1',
    }, options)).toThrow();
  });

  it('期限切れ状態候補の場合に確定を拒否する', () => {
    const token = createStateReferenceCandidateToken({
      userId: 'user-1', organizationId: null, entityId: 'entity-1',
      stateId: 'state-1', jobId: 'job-1', s3Key: 'session/user-1/entities/entity-1/candidate.png',
    }, { ...options, ttlSeconds: 1 });
    expect(() => parseStateReferenceCandidateToken(token, {
      userId: 'user-1', organizationId: null, entityId: 'entity-1', stateId: 'state-1',
    }, { ...options, now: () => 1_800_000_001_000 })).toThrow();
  });

  it('新規entity候補はuserとorganizationとentity typeへ束縛し、既存token形式では読めない', () => {
    const token = createDraftReferenceCandidateToken({
      userId: 'user-1', organizationId: 'org-1', entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/draft.png',
    }, options);

    expect(parseDraftReferenceCandidateToken(token, {
      userId: 'user-1', organizationId: 'org-1',
    }, options)).toEqual({
      entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/draft.png',
      expiresAt: 1_800_086_400_000,
    });
    for (const changed of [
      { userId: 'user-2' },
      { organizationId: 'org-2' },
      { organizationId: null },
    ]) {
      expect(() => parseDraftReferenceCandidateToken(token, {
        userId: 'user-1', organizationId: 'org-1', ...changed,
      }, options)).toThrow();
    }
    expect(() => parseReferenceCandidateToken(token, {
      userId: 'user-1', entityId: 'entity-1',
    }, options)).toThrow();
  });

  it('新規entity候補を同じscopeとtypeのentityへbindし、期限を延長しない', () => {
    const token = createDraftReferenceCandidateToken({
      userId: 'user-1', organizationId: null, entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/draft.webp',
    }, { ...options, ttlSeconds: 30 });

    const bound = bindDraftReferenceCandidateToken(token, {
      userId: 'user-1', organizationId: null, entityId: 'entity-1', entityType: 'character',
    }, options);
    expect(bound.s3Key).toBe('tmp/user-1/entities/imports/draft.webp');
    expect(parseReferenceCandidateToken(bound.candidateToken, {
      userId: 'user-1', entityId: 'entity-1',
    }, { ...options, now: () => 1_800_000_029_999 })).toBe(bound.s3Key);
    expect(() => parseReferenceCandidateToken(bound.candidateToken, {
      userId: 'user-1', entityId: 'entity-1',
    }, { ...options, now: () => 1_800_000_030_000 })).toThrow();
    expect(() => parseReferenceCandidateToken(bound.candidateToken, {
      userId: 'user-1', entityId: 'entity-2',
    }, options)).toThrow();
    expect(() => bindDraftReferenceCandidateToken(token, {
      userId: 'user-1', organizationId: null, entityId: 'entity-1', entityType: 'object',
    }, options)).toThrow();
  });
});
