import { describe, expect, it } from 'vitest';

import {
  getAppendOrder,
  parseExpandedNodeIds,
  resolveEpisodeMove,
  sortStoryItems,
} from '../../../apps/web/src/lib/storyHierarchy.js';

describe('story hierarchy helpers', () => {
  const chapters = [
    { id: 'chapter-2', order: 2 },
    { id: 'chapter-1', order: 1 },
    { id: 'chapter-3', order: 3 },
  ];

  it('章末の話を下へ動かす場合に次章先頭への移動として判定する', () => {
    expect(resolveEpisodeMove(chapters, 'chapter-1', 1, 2, 'down')).toEqual({
      allowed: true,
      crossesChapter: true,
      destinationChapterId: 'chapter-2',
    });
  });

  it('章先頭の話を上へ動かす場合に前章末尾への移動として判定する', () => {
    expect(resolveEpisodeMove(chapters, 'chapter-2', 0, 2, 'up')).toEqual({
      allowed: true,
      crossesChapter: true,
      destinationChapterId: 'chapter-1',
    });
  });

  it('作品全体の先頭と末尾では外側への移動を許可しない', () => {
    expect(resolveEpisodeMove(chapters, 'chapter-1', 0, 2, 'up')).toEqual({
      allowed: false,
      crossesChapter: false,
      destinationChapterId: null,
    });
    expect(resolveEpisodeMove(chapters, 'chapter-3', 1, 2, 'down')).toEqual({
      allowed: false,
      crossesChapter: false,
      destinationChapterId: null,
    });
  });

  it('同じ章に隣の話がある場合は従来の章内移動として判定する', () => {
    expect(resolveEpisodeMove(chapters, 'chapter-2', 0, 2, 'down')).toEqual({
      allowed: true,
      crossesChapter: false,
      destinationChapterId: 'chapter-2',
    });
  });

  it('追加 order は欠番に依存せず最大値の次になる', () => {
    expect(getAppendOrder([{ order: 4 }, { order: 1 }, { order: 9 }])).toBe(10);
    expect(getAppendOrder([])).toBe(1);
  });

  it('開閉状態は文字列配列だけを重複なく復元する', () => {
    expect(parseExpandedNodeIds('["work-1", "work-1", 1, "chapter-2"]')).toEqual([
      'work-1',
      'chapter-2',
    ]);
    expect(parseExpandedNodeIds('invalid')).toEqual([]);
  });

  it('章と話は order、同順位では id の順で安定して並ぶ', () => {
    expect(sortStoryItems([{ id: 'b', order: 2 }, { id: 'c', order: 1 }, { id: 'a', order: 2 }])).toEqual([
      { id: 'c', order: 1 },
      { id: 'a', order: 2 },
      { id: 'b', order: 2 },
    ]);
  });
});
