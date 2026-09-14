import { describe, expect, it } from 'vitest';
import { normalizeAutofillDialogueReadingOrder } from '../../../../src/domain/policies/autofillDialogueReadingOrder.js';
import type { PanelDialogueLine } from '../../../../src/domain/types/panel.js';

function line(index: number, overrides: Partial<PanelDialogueLine> = {}): PanelDialogueLine {
  return {
    entityId: `entity-${index}`,
    text: `台詞${index}`,
    type: 'speech',
    position: 'center',
    ...overrides,
  };
}

describe('normalizeAutofillDialogueReadingOrder', () => {
  it.each([
    [0, []],
    [1, ['right']],
    [2, ['right', 'left']],
    [3, ['right', 'right', 'left']],
    [4, ['right', 'right', 'left', 'left']],
  ] as const)('%i行の候補を日本語漫画の右から左の位置へ正規化する', (count, expectedPositions) => {
    const result = normalizeAutofillDialogueReadingOrder(
      Array.from({ length: count }, (_, index) => line(index + 1)),
    );

    expect(result.map((entry) => entry.position)).toEqual(expectedPositions);
  });

  it('本文、話者、種別、順序を保ち、入力と各行を変更しない', () => {
    const dialogue = [
      line(1, { entityId: 'speaker-1', type: 'speech', position: 'bottom' }),
      line(2, { entityId: null, type: 'narration', position: 'top' }),
      line(3, { entityId: 'speaker-2', type: 'thought', position: 'center' }),
      line(4, { entityId: null, type: 'sfx', position: 'left' }),
    ];
    const original = structuredClone(dialogue);

    const result = normalizeAutofillDialogueReadingOrder(dialogue);

    expect(result).toEqual([
      { ...original[0], position: 'right' },
      { ...original[1], position: 'right' },
      { ...original[2], position: 'left' },
      { ...original[3], position: 'left' },
    ]);
    expect(result).not.toBe(dialogue);
    expect(result[0]).not.toBe(dialogue[0]);
    expect(dialogue).toEqual(original);
  });

  it('5行以上も切り捨てず、正規化済みの候補を再度正規化しても同じになる', () => {
    const dialogue = [
      line(1, { type: 'thought' }),
      line(2, { type: 'narration', entityId: null }),
      line(3, { type: 'sfx', entityId: null }),
      line(4, { type: 'whisper' }),
      line(5, { type: 'shout' }),
    ];

    const normalized = normalizeAutofillDialogueReadingOrder(dialogue);

    expect(normalized).toHaveLength(5);
    expect(normalized.map((entry) => entry.position)).toEqual(['right', 'right', 'right', 'left', 'left']);
    expect(normalizeAutofillDialogueReadingOrder(normalized)).toEqual(normalized);
  });
});
