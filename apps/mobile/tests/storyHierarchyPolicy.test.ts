import { describe, expect, it } from 'vitest';
import {
  nextStoryOrder,
  resolveEpisodeMove,
  validateStoryHierarchyTitle,
} from '../src/domain/storyHierarchyPolicy';

describe('storyHierarchyPolicy', () => {
  it('タイトルは前後空白を除去し、1〜200文字だけを許可する', () => {
    expect(validateStoryHierarchyTitle('  新しい作品  ')).toEqual({
      ok: true,
      value: '新しい作品',
    });
    expect(validateStoryHierarchyTitle('   ')).toEqual({
      ok: false,
      reason: 'required',
    });
    expect(validateStoryHierarchyTitle('あ'.repeat(201))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('欠番があっても件数ではなく最大orderの次を返す', () => {
    expect(nextStoryOrder([{ order: 1 }, { order: 4 }])).toEqual({
      ok: true,
      order: 5,
    });
    expect(nextStoryOrder([])).toEqual({ ok: true, order: 1 });
  });

  it('最大orderが1000の場合は作成可能なorderを返さない', () => {
    expect(nextStoryOrder([{ order: 1000 }])).toEqual({
      ok: false,
      reason: 'limit_reached',
    });
  });

  it('話の章内移動と章境界移動を区別する', () => {
    const chapters = [
      { id: 'chapter-1', order: 1 },
      { id: 'chapter-2', order: 2 },
    ];
    const episodes = [
      { id: 'episode-1', order: 1 },
      { id: 'episode-2', order: 2 },
    ];

    expect(resolveEpisodeMove(
      chapters,
      'chapter-1',
      episodes,
      'episode-1',
      'down',
    )).toEqual({
      allowed: true,
      crossChapter: false,
      destinationChapterId: 'chapter-1',
    });
    expect(resolveEpisodeMove(
      chapters,
      'chapter-1',
      episodes,
      'episode-2',
      'down',
    )).toEqual({
      allowed: true,
      crossChapter: true,
      destinationChapterId: 'chapter-2',
    });
    expect(resolveEpisodeMove(
      chapters,
      'chapter-1',
      episodes,
      'episode-1',
      'up',
    )).toEqual({
      allowed: false,
      crossChapter: false,
      destinationChapterId: null,
    });
    expect(resolveEpisodeMove(
      chapters,
      'chapter-1',
      [],
      'episode-missing',
      'down',
    )).toEqual({
      allowed: false,
      crossChapter: false,
      destinationChapterId: null,
    });
  });
});
