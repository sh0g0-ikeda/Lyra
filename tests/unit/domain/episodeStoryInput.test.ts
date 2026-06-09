import { describe, expect, it } from 'vitest';
import {
  deriveStructuredStorySections,
  normalizeEpisodeStoryInput,
} from '../../../src/domain/episodeStoryInput.js';

describe('episodeStoryInput', () => {
  it('全体入力の日本語文を句点で4区分へ分ける', () => {
    const sections = deriveStructuredStorySections(
      '朝、澪は白い部屋で目を覚ます。昼、エミールが安全圏を案内する。夕方、澪は影との干渉を知る。夜、澪は元の世界へ戻れない可能性を悟る。',
    );

    expect(sections.introduction).toContain('白い部屋');
    expect(sections.middle).toContain('安全圏');
    expect(sections.climax).toContain('影との干渉');
    expect(sections.endingHook).toContain('戻れない可能性');
  });

  it('全角の感嘆符と疑問符も全体入力の文境界として扱う', () => {
    const sections = deriveStructuredStorySections(
      '澪が叫ぶ！エミールが問い返す？影の正体が近づく！澪は選択を迫られる？',
    );

    expect(sections.introduction).toBe('澪が叫ぶ！');
    expect(sections.middle).toBe('エミールが問い返す？');
    expect(sections.climax).toBe('影の正体が近づく！');
    expect(sections.endingHook).toBe('澪は選択を迫られる？');
  });

  it('full mode は保存本文を残しつつ正規化済み4区分だけを派生する', () => {
    const normalized = normalizeEpisodeStoryInput({
      storyInputMode: 'full',
      purpose: '世界への違和感',
      introduction: '使われない導入',
      middle: null,
      climax: null,
      endingHook: null,
      storyFullDraft: '導入。中盤。山場。引き。',
    });

    expect(normalized.storyFullDraft).toBe('導入。中盤。山場。引き。');
    expect(normalized.introduction).toBeNull();
    expect(normalized.normalizedIntroduction).toBe('導入。');
    expect(normalized.normalizedMiddle).toBe('中盤。');
    expect(normalized.normalizedClimax).toBe('山場。');
    expect(normalized.normalizedEndingHook).toBe('引き。');
  });
});
