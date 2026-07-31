import { describe, expect, it } from 'vitest';
import {
  buildEpisodeStoryUpdate,
  createEpisodeStoryDraft,
  isEpisodeStoryDraftDirty,
} from '../src/domain/episodeStoryDraft';

describe('episode story draft', () => {
  it('保存済みepisodeを全文story editorのdraftへ変換する', () => {
    expect(createEpisodeStoryDraft({
      title: '第一話',
      story_input_mode: 'full',
      story_full_draft: '探偵が依頼を受ける。',
      introduction: null,
      middle: null,
      climax: null,
      ending_hook: null,
      estimated_pages: 12,
    })).toEqual({
      title: '第一話',
      story: '探偵が依頼を受ける。',
      estimatedPages: '12',
      sourceStoryInputMode: 'full',
    });
  });

  it('空文字をnullへ変換し既存fieldを消さない最小payloadを作る', () => {
    const saved = {
      title: '第一話',
      story: '本文',
      estimatedPages: '4',
      sourceStoryInputMode: 'full' as const,
    };
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      title: '   ',
      story: '',
    })).toEqual({
      ok: true,
      payload: {
        title: null,
        story_input_mode: 'full',
        story_full_draft: null,
        estimated_pages: 4,
      },
    });
  });

  it('structured storyを本文未変更で保存しても非表示fieldとmodeを壊さない', () => {
    const saved = createEpisodeStoryDraft({
      title: '第一話',
      story_input_mode: 'structured',
      story_full_draft: null,
      introduction: '導入',
      middle: '中盤',
      climax: '山場',
      ending_hook: '引き',
      estimated_pages: 8,
    });

    expect(saved.story).toBe('導入\n\n中盤\n\n山場\n\n引き');
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      title: '更新後',
    })).toEqual({
      ok: true,
      payload: {
        title: '更新後',
        estimated_pages: 8,
      },
    });
  });

  it('title・story・想定ページ数の境界をclientで拒否する', () => {
    const saved = {
      title: '題',
      story: '本文',
      estimatedPages: '4',
      sourceStoryInputMode: 'full' as const,
    };
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      title: '題'.repeat(201),
    })).toEqual({ ok: false, reason: 'title_too_long' });
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      story: '本'.repeat(8001),
    })).toEqual({ ok: false, reason: 'story_too_long' });
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      estimatedPages: '0',
    })).toEqual({ ok: false, reason: 'estimated_pages_out_of_range' });
    expect(buildEpisodeStoryUpdate(saved, {
      ...saved,
      estimatedPages: '33',
    })).toEqual({ ok: false, reason: 'estimated_pages_out_of_range' });
  });

  it('trim後の保存値が同じならdirtyにしない', () => {
    const saved = {
      title: '第一話',
      story: '本文',
      estimatedPages: '4',
      sourceStoryInputMode: 'full' as const,
    };

    expect(isEpisodeStoryDraftDirty(saved, {
      title: ' 第一話 ',
      story: ' 本文 ',
      estimatedPages: '04',
      sourceStoryInputMode: 'full',
    })).toBe(false);
    expect(isEpisodeStoryDraftDirty(saved, {
      ...saved,
      story: '変更後',
    })).toBe(true);
  });
});
