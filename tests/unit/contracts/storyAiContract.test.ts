import { describe, expect, it } from 'vitest';
import {
  pageSkeletonResponseSchema,
  storyCollaborationEventSchema,
  storyEpisodeImprovementSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

describe('Story AI response contract', () => {
  it('現行の改善結果・同期/queue page skeleton・SSE eventを受理する', () => {
    expect(
      storyEpisodeImprovementSchema.safeParse({
        draft: {
          title: null,
          purpose: null,
          story_input_mode: 'structured',
          story_full_draft: null,
          introduction: null,
          middle: null,
          climax: null,
          ending_hook: null,
        },
        compiler_provider: 'fallback',
        compiler_model: null,
        compiler_prompt_version: null,
        compiler_error: null,
      }).success,
    ).toBe(true);
    expect(
      pageSkeletonResponseSchema.safeParse({
        pages_created: 0,
        panels_created: 0,
        replaced_existing: false,
        story_plan_applied: false,
        story_plan_job_id: null,
      }).success,
    ).toBe(true);
    expect(
      pageSkeletonResponseSchema.safeParse({
        job_id: 'job-1',
        queued: true,
        story_plan_applied: true,
      }).success,
    ).toBe(true);
    expect(
      storyCollaborationEventSchema.safeParse({
        event: 'chunk',
        data: { text: '改善案' },
      }).success,
    ).toBe(true);
    expect(
      storyCollaborationEventSchema.safeParse({ event: 'done', data: {} }).success,
    ).toBe(true);
    expect(
      storyCollaborationEventSchema.safeParse({
        event: 'error',
        data: { message: 'Story collaboration stream failed' },
      }).success,
    ).toBe(true);
  });

  it('未知provider・負の件数・空job ID・上限超過chunkを拒否する', () => {
    const improvement = {
      draft: {
        title: null,
        purpose: null,
        story_input_mode: 'structured',
        story_full_draft: null,
        introduction: null,
        middle: null,
        climax: null,
        ending_hook: null,
      },
      compiler_provider: 'legacy',
      compiler_model: null,
      compiler_prompt_version: null,
      compiler_error: null,
    };

    expect(storyEpisodeImprovementSchema.safeParse(improvement).success).toBe(false);
    expect(
      pageSkeletonResponseSchema.safeParse({
        pages_created: -1,
        panels_created: 0,
        replaced_existing: false,
        story_plan_applied: false,
        story_plan_job_id: null,
      }).success,
    ).toBe(false);
    expect(
      pageSkeletonResponseSchema.safeParse({
        job_id: '',
        queued: true,
        story_plan_applied: false,
      }).success,
    ).toBe(false);
    expect(
      storyCollaborationEventSchema.safeParse({
        event: 'chunk',
        data: { text: 'a'.repeat(25_001) },
      }).success,
    ).toBe(false);
  });
});
