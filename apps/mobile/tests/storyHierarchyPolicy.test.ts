import { describe, expect, it } from 'vitest';

import {
  buildNewChapterPayload,
  buildNewEpisodePayload,
  canMoveEpisodeInHierarchy,
  nextStoryOrder
} from '@/domain/storyHierarchyPolicy';

describe('story hierarchy policy', () => {
  it('既存の最大orderの次を新規orderにする', () => {
    expect(nextStoryOrder([{ order: 5 }, { order: 2 }])).toBe(6);
    expect(nextStoryOrder([])).toBe(1);
  });

  it('章と話の新規payloadは非表示項目を安全な初期値で作る', () => {
    expect(buildNewChapterPayload('第一章', [{ order: 3 }])).toEqual({
      order: 4,
      title: '第一章',
      purpose: null,
      starting_state: null,
      ending_state: null,
      emotion_curve: null,
      entities_involved: [],
      key_beats: []
    });
    expect(buildNewEpisodePayload('第一話', [])).toEqual({
      order: 1,
      title: '第一話',
      purpose: null,
      story_input_mode: 'full',
      story_full_draft: null,
      introduction: null,
      middle: null,
      climax: null,
      ending_hook: null,
      estimated_pages: 4,
      entities_involved: []
    });
  });

  it('章境界を含む全体の先頭と末尾だけ話移動不可にする', () => {
    expect(canMoveEpisodeInHierarchy({
      chapterIndex: 0,
      chapterCount: 2,
      episodeIndex: 0,
      episodeCount: 1,
      direction: 'up'
    })).toBe(false);
    expect(canMoveEpisodeInHierarchy({
      chapterIndex: 0,
      chapterCount: 2,
      episodeIndex: 0,
      episodeCount: 1,
      direction: 'down'
    })).toBe(true);
    expect(canMoveEpisodeInHierarchy({
      chapterIndex: 1,
      chapterCount: 2,
      episodeIndex: 0,
      episodeCount: 1,
      direction: 'down'
    })).toBe(false);
  });
});
