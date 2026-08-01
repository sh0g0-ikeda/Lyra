import { describe, expect, it } from 'vitest';

import type { EpisodeRecord } from '@/domain/types';
import {
  buildEpisodeMobileUpdatePayload,
  episodeMobileDraft
} from '@/domain/episodeMobileDraft';

const structuredEpisode: EpisodeRecord = {
  id: 'episode-1',
  chapter_id: 'chapter-1',
  order: 1,
  title: '第1話',
  purpose: '出会い',
  story_input_mode: 'structured',
  story_full_draft: null,
  introduction: '導入の本文',
  middle: '中盤の本文',
  climax: '山場の本文',
  ending_hook: '引きの本文',
  estimated_pages: 8,
  entities_involved: ['entity-1'],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft',
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z'
};

describe('episode Mobile full-draft compatibility', () => {
  it('structured episodeは非表示の4区分を欠落させず全文欄へ表示する', () => {
    expect(episodeMobileDraft(structuredEpisode)).toBe(
      '導入の本文\n\n中盤の本文\n\n山場の本文\n\n引きの本文'
    );
  });

  it('structured本文を変更していない保存ではstory fieldsを送らず保持する', () => {
    expect(
      buildEpisodeMobileUpdatePayload({
        episode: structuredEpisode,
        draft: episodeMobileDraft(structuredEpisode),
        estimatedPages: 12,
        title: 'タイトルのみ変更'
      })
    ).toEqual({
      expected_updated_at: '2026-07-25T00:00:00.000Z',
      estimated_pages: 12,
      title: 'タイトルのみ変更'
    });
  });

  it('structured本文を実際に編集した場合だけfull draftへ更新する', () => {
    expect(
      buildEpisodeMobileUpdatePayload({
        episode: structuredEpisode,
        draft: `${episodeMobileDraft(structuredEpisode)}\n\n追記`,
        estimatedPages: 8,
        title: '第1話'
      })
    ).toEqual({
      expected_updated_at: '2026-07-25T00:00:00.000Z',
      estimated_pages: 8,
      story_full_draft: '導入の本文\n\n中盤の本文\n\n山場の本文\n\n引きの本文\n\n追記',
      story_input_mode: 'full',
      title: '第1話'
    });
  });

  it('full episodeは空欄への明示的な変更も保存対象にする', () => {
    expect(
      buildEpisodeMobileUpdatePayload({
        episode: {
          ...structuredEpisode,
          story_input_mode: 'full',
          story_full_draft: '全文',
          introduction: null,
          middle: null,
          climax: null,
          ending_hook: null
        },
        draft: '',
        estimatedPages: 8,
        title: '第1話'
      })
    ).toMatchObject({
      story_full_draft: null,
      story_input_mode: 'full'
    });
  });
});
