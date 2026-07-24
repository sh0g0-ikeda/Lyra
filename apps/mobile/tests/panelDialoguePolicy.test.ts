import { describe, expect, it } from 'vitest';

import {
  findNarrationCharacterQuote,
  isPanelDialogueSpeakerValid,
  requiresPanelDialogueSpeaker
} from '@/domain/panelDialoguePolicy';

describe('panelDialoguePolicy', () => {
  it('ナレーションは話者なしを許可する', () => {
    expect(requiresPanelDialogueSpeaker('narration')).toBe(false);
    expect(isPanelDialogueSpeakerValid('narration', null, ['entity-1'])).toBe(true);
  });

  it('発話系セリフはコマに登場する話者を必須にする', () => {
    expect(requiresPanelDialogueSpeaker('speech')).toBe(true);
    expect(isPanelDialogueSpeakerValid('speech', null, ['entity-1'])).toBe(false);
    expect(isPanelDialogueSpeakerValid('thought', 'entity-2', ['entity-1'])).toBe(false);
    expect(isPanelDialogueSpeakerValid('whisper', 'entity-1', ['entity-1'])).toBe(true);
  });

  it('ナレーション内に登場人物名付きの引用がある場合に警告対象を返す', () => {
    expect(
      findNarrationCharacterQuote('蓮「ここから始めよう」', [
        { id: 'entity-1', name: '蓮' },
        { id: 'entity-2', name: '春香' }
      ])
    ).toBe('蓮');
    expect(
      findNarrationCharacterQuote('蓮は静かに歩き出した。', [{ id: 'entity-1', name: '蓮' }])
    ).toBeNull();
  });
});
