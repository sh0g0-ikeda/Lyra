import { describe, expect, it } from 'vitest';
import {
  generationJobHistoryResponseSchema,
  generationJobResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const baseJob = {
  id: 'job-1',
  status: 'queued',
  generation_mode: null,
  credit_cost: 0,
  error_message: null,
  retry_count: 0,
  created_at: '2026-07-30T00:00:00.000Z',
  started_at: null,
  completed_at: null,
  expires_at: null,
  cancel_requested_at: null,
  cancelled_at: null,
  commit_started_at: null,
};

describe('Generation job response contract', () => {
  it('strictな履歴一覧とnullable next cursorを受理する', () => {
    const pageJob = {
      ...baseJob,
      job_type: 'page_generate',
      params: { page_id: 'page-1' },
      result: null,
    };

    expect(
      generationJobHistoryResponseSchema.safeParse({
        jobs: [pageJob],
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      generationJobHistoryResponseSchema.safeParse({
        jobs: [pageJob],
        next_cursor: 'a'.repeat(513),
      }).success,
    ).toBe(false);
    expect(
      generationJobHistoryResponseSchema.safeParse({
        jobs: [{ ...pageJob, provider_secret: 'internal' }],
        next_cursor: null,
      }).success,
    ).toBe(false);
    expect(
      generationJobHistoryResponseSchema.safeParse({
        jobs: [],
        next_cursor: null,
        internal_count: 1,
      }).success,
    ).toBe(false);
  });

  it('4 job typeのnull・部分・完了resultを受理する', () => {
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'page_generate',
        params: {
          page_id: 'page-1',
          request_kind: 'initial',
          generation_mode: 'standard',
          quality: 'medium',
          requires_planner: false,
        },
        result: null,
      }).success,
    ).toBe(true);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'entity_generate',
        params: { entity_id: 'entity-1', entity_type: 'character' },
        result: {
          provider_result: true,
          candidates: [{ candidate_token: 'token-1' }],
        },
      }).success,
    ).toBe(true);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'episode_story_autofill',
        params: { episode_id: 'episode-1', language: 'ja' },
        result: {
          progress_stage: 'processing',
          progress_message: null,
          progress_current_chunk: 1,
          progress_total_chunks: null,
          progress_started_at: null,
          progress_updated_at: '2026-07-30T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'episode_page_skeleton',
        params: {
          episode_id: 'episode-1',
          overwrite_existing: false,
          apply_story_plan: true,
          language: 'en',
        },
        result: {
          pages_created: 2,
          panels_created: 8,
          replaced_existing: false,
          story_plan_applied: true,
          story_plan_result: {
            updated_page_count: 2,
            updated_panel_count: 8,
            updated_assignment_count: 4,
            filled_field_count: 12,
            compiler_used: true,
            compiler_provider: 'openai',
            compiler_model: 'model',
            compiler_prompt_version: 'v1',
            compiler_error: null,
          },
          progress_stage: 'completed',
          progress_updated_at: '2026-07-30T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
  });

  it('root・params・result・候補・story plan resultの内部fieldを拒否する', () => {
    const pageJob = {
      ...baseJob,
      job_type: 'page_generate',
      params: { page_id: 'page-1' },
      result: {},
    };
    expect(generationJobResponseSchema.safeParse({ ...pageJob, user_id: 'user-1' }).success).toBe(false);
    expect(
      generationJobResponseSchema.safeParse({
        ...pageJob,
        params: { page_id: 'page-1', draft_prompt: 'internal' },
      }).success,
    ).toBe(false);
    expect(
      generationJobResponseSchema.safeParse({
        ...pageJob,
        result: { s3_key: 'saved/private.png' },
      }).success,
    ).toBe(false);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'entity_generate',
        params: {},
        result: {
          provider_result: false,
          candidates: [{ candidate_token: 'token-1', s3_key: 'saved/private.png' }],
        },
      }).success,
    ).toBe(false);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'episode_page_skeleton',
        params: {},
        result: {
          story_plan_result: {
            compiler_used: true,
            compiled_prompt: 'internal',
          },
        },
      }).success,
    ).toBe(false);
    expect(
      generationJobResponseSchema.safeParse({
        ...baseJob,
        job_type: 'unknown_job',
        params: {},
        result: null,
      }).success,
    ).toBe(false);
  });
});
