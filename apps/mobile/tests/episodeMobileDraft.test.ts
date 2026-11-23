import { describe, expect, it } from 'vitest';

import type { EpisodeRecord } from '@/domain/types';
import {
  buildEpisodeMobileUpdatePayload,
  episodeMobileDraft,
  separateProductionNoteLines,
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
  it('開始状態を操作しない保存では旧API互換でfieldを省略する', () => {
    const payload = buildEpisodeMobileUpdatePayload({ episode: structuredEpisode, draft: episodeMobileDraft(structuredEpisode), estimatedPages: 8, title: '第1話' });
    expect(payload).not.toHaveProperty('starting_entity_states');
  });

  it('開始状態を明示的に空へ変更した場合だけ空配列を保存する', () => {
    const payload = buildEpisodeMobileUpdatePayload({ episode: structuredEpisode, draft: episodeMobileDraft(structuredEpisode), estimatedPages: 8, title: '第1話', startingEntityStates: [] });
    expect(payload).toHaveProperty('starting_entity_states', []);
    expect(payload).not.toHaveProperty('introduction');
    expect(payload).not.toHaveProperty('entities_involved');
  });

  it('v2の保存済み指示を全文欄へ戻して再編集できる', () => {
    expect(episodeMobileDraft({
      ...structuredEpisode,
      production_notes_enabled: false,
      production_notes: ['「導入の本文」と「中盤の本文」は別のコマにする。'],
    })).toContain('# 「導入の本文」と「中盤の本文」は別のコマにする。');
  });

  it('明示有効時も対応構文だけをsidecarへ分けてMarkdown見出しを本文に保つ', () => {
    expect(separateProductionNoteLines(
      '# 第一章\n本文\n＃ 「本文」のコマで「ミオ」は通常に戻る。',
      true,
    )).toEqual({
      body: '# 第一章\n本文',
      notes: ['「本文」のコマで「ミオ」は通常に戻る。'],
    });
  });

  it('半角空白なしの対応構文を分け、無効化保存では既存sidecarだけを保持する', () => {
    const saved = '「本文A」と「本文B」は別のコマにする。';
    expect(separateProductionNoteLines(
      `本文A。本文B。\n#${saved}\n#「新規A」と「新規B」は同じコマにする。\n#通常見出し`,
      false,
      [saved],
    )).toEqual({
      body: '本文A。本文B。\n#「新規A」と「新規B」は同じコマにする。\n#通常見出し',
      notes: [saved],
    });
    expect(separateProductionNoteLines(`#${saved}`, true)).toEqual({ body: '', notes: [saved] });
    expect(separateProductionNoteLines('本文A。本文B。', false, [saved])).toEqual({
      body: '本文A。本文B。',
      notes: [],
    });
  });

});
