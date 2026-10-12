import { describe, expect, it } from 'vitest';

import type { GenerationJob } from '../../../../src/domain/types/job.js';
import { toJobPresentation } from '../../../../src/services/job/JobPresentation.js';

const now = new Date('2026-10-12T04:42:00.000Z');
const job: GenerationJob = {
  id: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', organizationId: null,
  jobType: 'episode_story_autofill', status: 'failed', generationMode: 'standard', creditCost: 0, params: {}, result: null,
  sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 0, createdAt: now, startedAt: now,
  completedAt: now, expiresAt: null, cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null,
};

describe('JobPresentation provider quality errors', () => {
  // The provider audit compiler's exact known quality failure is retryable without exposing its raw diagnostic.
  it('OpenAI audit compilerの既知source coverage不良は一時的provider障害として提示する', () => {
    const presentation = toJobPresentation({ ...job, errorMessage: 'OpenAI episode plan audit compiler returned invalid source coverage' }, false);

    expect(presentation).toMatchObject({ error_code: 'GENERATION_TEMPORARILY_UNAVAILABLE', message_key: 'job.error.temporarilyUnavailable', retryable: true });
    expect(JSON.stringify(presentation)).not.toContain('source coverage');
  });

  it('実際の入力不備はretry不可のinput invalidのままにする', () => {
    expect(toJobPresentation({ ...job, errorMessage: 'Invalid input: unsupported input field' }, false)).toMatchObject({ error_code: 'GENERATION_INPUT_INVALID', message_key: 'job.error.inputInvalid', retryable: false });
  });

  it('未知の失敗は既存のgeneric presentationを維持する', () => {
    expect(toJobPresentation({ ...job, errorMessage: 'unrecognized compiler failure' }, false)).toMatchObject({ error_code: 'GENERATION_FAILED', message_key: 'job.error.failed', retryable: true });
  });
});
