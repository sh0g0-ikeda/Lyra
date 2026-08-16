import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { EpisodeRecord } from '@/domain/types';
import {
  fetchFreshEpisode,
  replaceEpisodeInResponse,
} from '@/lib/storyEpisodeCache';

const episode = (overrides: Partial<EpisodeRecord> = {}): EpisodeRecord => ({
  id: 'episode-1',
  chapter_id: 'chapter-1',
  order: 1,
  title: '第1話',
  purpose: null,
  story_input_mode: 'full',
  story_full_draft: '本文',
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 4,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft',
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

describe('story episode cache', () => {
  it('保存応答の話だけを一覧内で置き換える', () => {
    const current = episode();
    const other = episode({ id: 'episode-2', order: 2 });
    const updated = episode({ story_full_draft: '保存後', updated_at: '2026-08-16T00:01:00.000Z', version: 2 });

    expect(replaceEpisodeInResponse({ episodes: [current, other] }, updated)).toEqual({
      episodes: [updated, other],
    });
  });

  it('キャッシュがfreshでも最新状態はAPIから強制取得してキャッシュを更新する', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    });
    const queryKey = ['episodes', 'session-1', 'chapter-1', 'personal'] as const;
    const cached = episode({ story_full_draft: '古い本文' });
    const latest = episode({
      story_full_draft: '最新本文',
      updated_at: '2026-08-16T00:01:00.000Z',
      version: 2,
    });
    queryClient.setQueryData(queryKey, { episodes: [cached] });
    const getEpisodes = vi.fn().mockResolvedValue({ episodes: [latest] });

    await expect(fetchFreshEpisode({
      api: { getEpisodes },
      chapterId: 'chapter-1',
      episodeId: 'episode-1',
      organizationId: null,
      queryClient,
      queryKey,
    })).resolves.toEqual(latest);

    expect(getEpisodes).toHaveBeenCalledWith('chapter-1', null);
    expect(queryClient.getQueryData(queryKey)).toEqual({ episodes: [latest] });
  });
});
