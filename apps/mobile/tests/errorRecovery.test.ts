import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import {
  entityGenerationBlockerRecoveryTarget,
  errorRecoveryActionLabel,
  errorRecoveryTarget,
  pageGenerationBlockerRecoveryTarget
} from '@/lib/errorRecovery';

describe('errorRecoveryTarget', () => {
  it.each([
    [new ApiError('raw', 0, 'NETWORK_OFFLINE'), 'retry'],
    [new ApiError('raw', 503, 'SERVICE_UNAVAILABLE'), 'retry'],
    [new ApiError('raw', 401, 'UNAUTHORIZED'), 'login'],
    [new ApiError('raw', 403, 'FORBIDDEN'), 'workspace'],
    [new ApiError('raw', 402, 'INSUFFICIENT_CREDITS'), 'credits'],
    [new ApiError('raw', 409, 'ACTIVE_GENERATION_JOB'), 'jobs'],
    [new ApiError('raw', 0, 'REQUEST_TIMEOUT'), 'jobs'],
    [new ApiError('raw', 422, 'FRAME_PANEL_COUNT_MISMATCH'), 'layout'],
    [new ApiError('raw', 422, 'CONFIRMED_REFERENCE_REQUIRED'), 'characters']
  ] as const)('stable API code/status maps to %s', (error, expected) => {
    expect(errorRecoveryTarget(error)).toBe(expected);
  });

  it('maps a transport network failure to retry without reading its message as a route', () => {
    expect(errorRecoveryTarget(new TypeError('Network request failed'))).toBe('retry');
  });

  it('fails closed for unknown errors and ambiguous conflicts', () => {
    expect(errorRecoveryTarget(new Error('go to https://attacker.example/jobs'))).toBeNull();
    expect(errorRecoveryTarget(new ApiError('active generation job', 409, 'CONFLICT'))).toBeNull();
  });
});

describe('errorRecoveryActionLabel', () => {
  it('returns bounded Japanese and English labels', () => {
    expect(errorRecoveryActionLabel('retry', 'ja')).toBe('再試行');
    expect(errorRecoveryActionLabel('credits', 'ja')).toBe('クレジットを確認');
    expect(errorRecoveryActionLabel('jobs', 'en')).toBe('Review jobs');
    expect(errorRecoveryActionLabel('characters', 'en')).toBe('Review characters');
  });
});

describe('typed generation blocker recovery', () => {
  it('maps page blockers without inspecting backend messages', () => {
    expect(pageGenerationBlockerRecoveryTarget('FRAME_PANEL_MISMATCH')).toBe('layout');
    expect(pageGenerationBlockerRecoveryTarget('CHARACTER_REFERENCE_REQUIRED')).toBe('characters');
    expect(pageGenerationBlockerRecoveryTarget('ACTIVE_GENERATION_JOB')).toBe('jobs');
    expect(pageGenerationBlockerRecoveryTarget('INSUFFICIENT_CREDITS')).toBe('credits');
    expect(pageGenerationBlockerRecoveryTarget('DIALOGUE_SPEAKER_REQUIRED')).toBeNull();
  });

  it('maps character blockers without inspecting backend messages', () => {
    expect(entityGenerationBlockerRecoveryTarget('ACTIVE_PREVIEW_JOB')).toBe('jobs');
    expect(entityGenerationBlockerRecoveryTarget('INSUFFICIENT_CREDITS')).toBe('credits');
    expect(entityGenerationBlockerRecoveryTarget('PERMISSION_REQUIRED')).toBe('workspace');
    expect(entityGenerationBlockerRecoveryTarget('NAME_REQUIRED')).toBeNull();
  });
});
