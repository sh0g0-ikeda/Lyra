import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import {
  createEpisodeBodySchema,
  updateEpisodeBodySchema,
  updateWorkBodySchema,
  updateChapterBodySchema,
} from '../../../../src/lib/validators/story.schema.js';

describe('story schema', () => {
  it('episode estimated_pages は skeleton 生成上限を超えられない', () => {
    expect(
      createEpisodeBodySchema.safeParse({
        order: 1,
        title: 'episode',
        estimated_pages: STORY_AI_LIMITS.maxSkeletonPages + 1,
      }).success,
    ).toBe(false);

    expect(
      updateEpisodeBodySchema.safeParse({
        estimated_pages: STORY_AI_LIMITS.maxSkeletonPages + 1,
      }).success,
    ).toBe(false);
  });

  it('開始状態はentity重複を拒否し、明示空配列は許可する', () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const stateId = '22222222-2222-4222-8222-222222222222';

    expect(updateEpisodeBodySchema.safeParse({
      starting_entity_states: [
        { entity_id: entityId, state_id: stateId },
        { entity_id: entityId, state_id: null },
      ],
    }).success).toBe(false);
    expect(updateEpisodeBodySchema.safeParse({ starting_entity_states: [] }).success).toBe(true);
    expect(updateEpisodeBodySchema.safeParse({ starting_entity_states: null }).success).toBe(false);
  });
});

// Design: preserve both shipped timestamp-CAS clients and legacy partial updates.
describe.each([updateWorkBodySchema, updateChapterBodySchema, updateEpisodeBodySchema])('story timestamp revision compatibility', (schema) => {
  it('更新内容と有効なtimestampを受け入れ、省略クライアントも維持する', () => {
    expect(schema.safeParse({ title: 'saved', expected_updated_at: '2026-10-01T12:00:00.123Z' }).success).toBe(true);
    expect(schema.safeParse({ title: 'saved', expected_updated_at: '2026-10-01T21:00:00.123+09:00' }).success).toBe(true);
    expect(schema.safeParse({ title: 'saved' }).success).toBe(true);
  });
  it('timestampのみ、無効timestamp、未知fieldは拒否する', () => {
    expect(schema.safeParse({ expected_updated_at: '2026-10-01T12:00:00.123Z' }).success).toBe(false);
    expect(schema.safeParse({ title: 'saved', expected_updated_at: 'yesterday' }).success).toBe(false);
    expect(schema.safeParse({ title: 'saved', expected_updated_at: null }).success).toBe(false);
    expect(schema.safeParse({ title: 'saved', unknown: true }).success).toBe(false);
  });
});
