import type { PanelDialogueLine } from '../types/panel.js';

const DIALOGUE_READING_ORDER_SPLIT_DIVISOR = 2;

/**
 * Assigns positions only for newly compiled dialogue candidates. Persisted and
 * manually authored dialogue must keep its authored position elsewhere.
 */
export function normalizeAutofillDialogueReadingOrder(
  dialogue: readonly PanelDialogueLine[],
): PanelDialogueLine[] {
  const rightPositionCount = Math.ceil(dialogue.length / DIALOGUE_READING_ORDER_SPLIT_DIVISOR);

  return dialogue.map((line, index) => ({
    ...line,
    position: index < rightPositionCount ? 'right' : 'left',
  }));
}
