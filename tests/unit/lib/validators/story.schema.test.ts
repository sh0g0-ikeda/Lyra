import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import {
  createEpisodeBodySchema,
  updateEpisodeBodySchema,
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
});
