import * as pageSelection from '@/domain/pageSelection';
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


it('最初のコマ選択に別ページの応答を混ぜない', () => {
  expect(initialPageAndPanel([page('episode-1')], [{ id: 'foreign', order: 1, page_id: 'page-2' }, { id: 'local', order: 2, page_id: 'page-1' }])).toEqual({ pageId: 'page-1', panelId: 'local' });
});


it('番号順で前後ページを選びページ番号の空きを許容する', () => {
  expect(pageSelection.adjacentPage).toBeTypeOf('function');
  const first=page('episode-1'); const middle={...first,id:'page-2',page_number:5}; const last={...first,id:'page-3',page_number:9};
  expect(pageSelection.adjacentPage([last,first,middle],middle.id,-1)?.id).toBe(first.id);
  expect(pageSelection.adjacentPage([last,first,middle],middle.id,1)?.id).toBe(last.id);
});
it('ページの両端や不明な選択では前後に移動しない', () => {
  expect(pageSelection.adjacentPage).toBeTypeOf('function');
  const first=page('episode-1');
  expect(pageSelection.adjacentPage([first],first.id,-1)).toBeNull();
  expect(pageSelection.adjacentPage([first],first.id,1)).toBeNull();
  expect(pageSelection.adjacentPage([first],'unknown',1)).toBeNull();
});
it('別の話のページを前後候補に採用しない', () => {
  expect(pageSelection.adjacentPage).toBeTypeOf('function');
  const first=page('episode-1');const other={...page('episode-2'),id:'other',page_number:2};const last={...first,id:'last',page_number:3};
  expect(pageSelection.adjacentPage([first,other,last],first.id,1)?.id).toBe(last.id);
});
