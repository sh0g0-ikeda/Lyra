import { describe, expect, it } from 'vitest';

import {
  resolveOneShotEntry,
  type WorkCreationMetadata,
} from '../../../apps/web/src/lib/workCreation.js';

// Design contract: flatten only an explicitly declared one-shot whose complete
// current hierarchy still matches its persisted entry point. Every ambiguous or
// mobile-edited shape falls back to the ordinary chapter/episode tree.
describe('resolveOneShotEntry', () => {
  const metadata: WorkCreationMetadata = {
    work_id: 'work-1',
    mode: 'one_shot',
    entry_chapter_id: 'chapter-1',
    entry_episode_id: 'episode-1',
  };
  const chapters = [{ id: 'chapter-1', work_id: 'work-1' }];
  const episodes = [{ id: 'episode-1', chapter_id: 'chapter-1' }];

  it('明示された読み切りの唯一の章と話がentry IDと一致する場合だけ直行先を返す', () => {
    expect(resolveOneShotEntry(metadata, chapters, episodes)).toEqual({
      chapterId: 'chapter-1',
      episodeId: 'episode-1',
    });
  });

  it.each([
    ['metadataが未取得', undefined, chapters, episodes],
    ['シリーズ', { ...metadata, mode: 'series' as const }, chapters, episodes],
    ['entry章が未設定', { ...metadata, entry_chapter_id: null }, chapters, episodes],
    ['entry話が未設定', { ...metadata, entry_episode_id: null }, chapters, episodes],
    ['章がない', metadata, [], episodes],
    ['章が複数', metadata, [...chapters, { id: 'chapter-2', work_id: 'work-1' }], episodes],
    ['話がない', metadata, chapters, []],
    ['話が複数', metadata, chapters, [...episodes, { id: 'episode-2', chapter_id: 'chapter-1' }]],
    ['entry章IDが不一致', { ...metadata, entry_chapter_id: 'chapter-other' }, chapters, episodes],
    ['entry話IDが不一致', { ...metadata, entry_episode_id: 'episode-other' }, chapters, episodes],
    ['章の作品が不一致', metadata, [{ id: 'chapter-1', work_id: 'work-other' }], episodes],
    ['話の章が不一致', metadata, chapters, [{ id: 'episode-1', chapter_id: 'chapter-other' }]],
  ] satisfies ReadonlyArray<readonly [
    string,
    WorkCreationMetadata | undefined,
    ReadonlyArray<{ id: string; work_id: string }>,
    ReadonlyArray<{ id: string; chapter_id: string }>,
  ]>)('%sなら通常階層へ戻す', (_label, candidate, currentChapters, currentEpisodes) => {
    expect(resolveOneShotEntry(candidate, currentChapters, currentEpisodes)).toBeNull();
  });
});
