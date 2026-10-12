import { describe, expect, it } from 'vitest';

import { initialPageAndPanel, selectPageForEpisode } from '@/domain/pageSelection';
import type { PageRecord } from '@/domain/types';

const page = (episodeId: string): PageRecord => ({
  id: 'page-1',
  episode_id: episodeId,
  page_number: 1,
  layout_config: {},
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'image_baked',
  page_dialogue_toggle: true,
  generation_mode: null,
  generated_image: null,
  status: 'designing',
  panel_count: 0,
  frame_count: 0,
  balloon_count: 0,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
});

describe('pageSelection', () => {
  it('選択中の話に属するページだけを採用する', () => {
    expect(selectPageForEpisode(page('episode-1'), 'episode-1')?.id)
      .toBe('page-1');
    expect(selectPageForEpisode(page('episode-2'), 'episode-1'))
      .toBeNull();
  });

  it('話が未選択の場合は保存済みページを採用しない', () => {
    expect(selectPageForEpisode(page('episode-1'), null)).toBeNull();
  });

  it('初回と自動入力完了時は最小ページ番号と最小保存順のコマを選ぶ', () => {
    const later = { ...page('episode-1'), id: 'page-2', page_number: 2 };
    expect(initialPageAndPanel([later, page('episode-1')], [{ id: 'panel-2', order: 2 }, { id: 'panel-1', order: 1 }]))
      .toEqual({ pageId: 'page-1', panelId: 'panel-1' });
  });
});
