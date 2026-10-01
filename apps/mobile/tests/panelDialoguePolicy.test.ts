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

  it('発話系セリフは同じ作品の既知の話者を必須にする', () => {
    expect(requiresPanelDialogueSpeaker('speech')).toBe(true);
    expect(isPanelDialogueSpeakerValid('speech', null, ['entity-1'])).toBe(false);
    expect(isPanelDialogueSpeakerValid('thought', 'entity-2', ['entity-1'])).toBe(false);
    expect(isPanelDialogueSpeakerValid('whisper', 'entity-1', ['entity-1'])).toBe(true);
  });

  // F21 / Unified Spec §§5, 8, 11: speaker identity belongs to the work, not
  // the visible cast. Optional-speaker types may omit it, never bypass ownership.
  it.each(['speech', 'thought', 'shout', 'whisper'] as const)(
    '%s はコマ外の既知の話者を許可するが話者なしを拒否する',
    (type) => {
      const workEntityIds = ['visible', 'off-panel'];
      expect(isPanelDialogueSpeakerValid(type, 'off-panel', workEntityIds)).toBe(true);
      expect(isPanelDialogueSpeakerValid(type, null, workEntityIds)).toBe(false);
    }
  );

  it.each(['narration', 'sfx'] as const)('%s は話者なしを許可する', (type) => {
    expect(requiresPanelDialogueSpeaker(type)).toBe(false);
    expect(isPanelDialogueSpeakerValid(type, null, [])).toBe(true);
    expect(isPanelDialogueSpeakerValid(type, 'off-panel', ['off-panel'])).toBe(true);
  });

  it.each(['speech', 'thought', 'shout', 'whisper', 'narration', 'sfx'] as const)(
    '%s は別作品・未解決・空の話者 ID を許可しない',
    (type) => {
      expect(isPanelDialogueSpeakerValid(type, 'foreign', ['visible', 'off-panel'])).toBe(false);
      expect(isPanelDialogueSpeakerValid(type, 'unresolved', [])).toBe(false);
      expect(isPanelDialogueSpeakerValid(type, '', ['visible'])).toBe(false);
    }
  );

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
