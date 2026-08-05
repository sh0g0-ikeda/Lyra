import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractImprovedFullStory,
  shouldOverwritePageSkeleton
} from '@/domain/storyWorkflow';
import type { StoryEpisodeImprovementRecord } from '@/domain/types';

const improvement = (
  draft: StoryEpisodeImprovementRecord['draft']
): StoryEpisodeImprovementRecord => ({
  draft,
  compiler_provider: 'fallback',
  compiler_model: null,
  compiler_prompt_version: null,
  compiler_error: null
});

describe('storyWorkflow', () => {
  it('通常の話保存と未保存確認は同じdraft保存経路を使う', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/screens/StoryScreen.tsx'), 'utf8');
    const saveButtonStart = source.indexOf("label={t(language, 'save')}");
    const saveButton = source.slice(saveButtonStart, source.indexOf('/>', saveButtonStart));

    expect(saveButtonStart).toBeGreaterThanOrEqual(0);
    expect(source).toContain('save: saveStoryDrafts');
    expect(saveButton).toContain('saveStoryDrafts().catch(() => undefined)');
  });

  it('既存ページが1件以上ある場合だけ骨格を上書き再生成する', () => {
    expect(shouldOverwritePageSkeleton(0)).toBe(false);
    expect(shouldOverwritePageSkeleton(1)).toBe(true);
    expect(shouldOverwritePageSkeleton(12)).toBe(true);
  });

  it('StoryAIのfull story出力だけを現在の話本文へ適用する', () => {
    expect(
      extractImprovedFullStory(
        improvement({
          title: '変更してはいけない題名',
          purpose: '変更してはいけない目的',
          story_input_mode: 'full',
          story_full_draft: '  改善後の本文  ',
          introduction: null,
          middle: null,
          climax: null,
          ending_hook: null
        })
      )
    ).toBe('改善後の本文');
  });

  it('旧structured出力は本文の4区分だけを結合する', () => {
    expect(
      extractImprovedFullStory(
        improvement({
          title: null,
          purpose: null,
          story_input_mode: 'structured',
          story_full_draft: null,
          introduction: '導入',
          middle: '展開',
          climax: '山場',
          ending_hook: '締め'
        })
      )
    ).toBe('導入\n\n展開\n\n山場\n\n締め');
  });
});
