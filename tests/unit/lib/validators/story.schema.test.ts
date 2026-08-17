import { describe, expect, it } from 'vitest';
import {
  createEpisodeBodySchema,
  updateChapterBodySchema,
  updateEpisodeBodySchema,
  updateWorkBodySchema,
} from '../../../../src/lib/validators/story.schema.js';

describe('story schema', () => {
  it('episode estimated_pages は24ページを受理し25ページを拒否する', () => {
    expect(
      createEpisodeBodySchema.safeParse({
        order: 1,
        title: 'episode',
        estimated_pages: 24,
      }).success,
    ).toBe(true);

    expect(
      updateEpisodeBodySchema.safeParse({
        estimated_pages: 24,
        expected_updated_at: '2026-08-17T00:00:00.000Z',
      }).success,
    ).toBe(true);

    expect(
      createEpisodeBodySchema.safeParse({
        order: 1,
        title: 'episode',
        estimated_pages: 25,
      }).success,
    ).toBe(false);

    expect(
      updateEpisodeBodySchema.safeParse({
        estimated_pages: 25,
        expected_updated_at: '2026-08-17T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('work/chapter/episode update は current revision を必須にする', () => {
    const expectedUpdatedAt = '2026-07-25T00:00:00.000Z';

    expect(updateWorkBodySchema.safeParse({ title: 'work' }).success).toBe(false);
    expect(updateChapterBodySchema.safeParse({ title: 'chapter' }).success).toBe(false);
    expect(updateEpisodeBodySchema.safeParse({ title: 'episode' }).success).toBe(false);

    expect(
      updateWorkBodySchema.safeParse({ title: 'work', expected_updated_at: expectedUpdatedAt }).success,
    ).toBe(true);
    expect(
      updateChapterBodySchema.safeParse({ title: 'chapter', expected_updated_at: expectedUpdatedAt }).success,
    ).toBe(true);
    expect(
      updateEpisodeBodySchema.safeParse({ title: 'episode', expected_updated_at: expectedUpdatedAt }).success,
    ).toBe(true);
  });
});
