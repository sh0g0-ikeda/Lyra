import { describe, expect, it } from 'vitest';
import {
  createReferenceCandidateToken,
  createStateReferenceCandidateToken,
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
});
