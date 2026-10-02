import { describe, expect, it } from 'vitest';

import { mangaWorkflowScopeKey, resumeMangaStep } from '@/domain/mangaWorkflow';
import { defaultSelection } from '@/lib/queryKeys';

describe('漫画制作の再開工程', () => {
  it('新規または本文が空の場合はストーリーから始める', () => {
    expect(resumeMangaStep({ savedStory: '', hasPages: false, hasEpisode: false })).toBe('story');
    expect(resumeMangaStep({ savedStory: '  ', hasPages: false, hasEpisode: true })).toBe('story');
  });

  it('保存済み本文がある場合はキャラクターから再開する', () => {
    expect(resumeMangaStep({ savedStory: '既存の物語', hasPages: false, hasEpisode: true })).toBe('characters');
  });

  it('既存ページがある場合は本文よりページを優先して再開する', () => {
    expect(resumeMangaStep({ savedStory: '', hasPages: true, hasEpisode: true })).toBe('pages');
    expect(resumeMangaStep({ savedStory: '既存の物語', hasPages: true, hasEpisode: false })).toBe('story');
  });

  it('ユーザー・法人・作品・章・話が変わる場合は工程の保存範囲を分ける', () => {
    const selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
    const base = mangaWorkflowScopeKey('user', selection);
    expect(mangaWorkflowScopeKey('other-user', selection)).not.toBe(base);
    for (const key of ['organizationId', 'workId', 'chapterId', 'episodeId'] as const) {
      expect(mangaWorkflowScopeKey('user', { ...selection, [key]: 'different' })).not.toBe(base);
    }
    expect(mangaWorkflowScopeKey('user', { ...selection, pageId: 'page', entityId: 'entity' })).toBe(base);
  });
});
