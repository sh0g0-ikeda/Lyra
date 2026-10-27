import { describe, expect, it } from 'vitest';

import { readWorkspaceView, resumeMangaStep } from '../../../apps/web/src/lib/mangaWorkflow.js';

// The primary four-way Web shell only restores safe navigation. These tests
// prevent a persisted view from saving drafts, starting jobs, or accepting an
// invalid cross-session value.
describe('Web manga workflow navigation', () => {
  it('保存済みの制作状態から安全な工程を再開する', () => {
    expect(resumeMangaStep({ hasEpisode: false, hasPages: true, savedStory: 'saved' })).toBe('story');
    expect(resumeMangaStep({ hasEpisode: true, hasPages: false, savedStory: '   ' })).toBe('story');
    expect(resumeMangaStep({ hasEpisode: true, hasPages: false, savedStory: 'saved' })).toBe('entities');
    expect(resumeMangaStep({ hasEpisode: true, hasPages: true, savedStory: '' })).toBe('pages');
  });

  it('sessionStorage view は既知の値だけを復元し、破損または失敗時は library に戻す', () => {
    const values = new Map<string, string>([['workspace', 'pages']]);
    const storage = { getItem: (key: string): string | null => values.get(key) ?? null };

    expect(readWorkspaceView(storage, 'workspace')).toBe('pages');
    values.set('workspace', 'unknown');
    expect(readWorkspaceView(storage, 'workspace')).toBe('library');
    expect(readWorkspaceView({ getItem: (): string | null => { throw new Error('blocked'); } }, 'workspace')).toBe('library');
  });
});
