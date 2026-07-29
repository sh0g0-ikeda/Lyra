import type { PanelDialogueLine } from '@/domain/types';

type NamedEntity = {
  id: string;
  name: string;
};

const speakerRequiredTypes: ReadonlySet<PanelDialogueLine['type']> = new Set([
  'speech',
  'thought',
  'shout',
  'whisper'
]);

export const requiresPanelDialogueSpeaker = (type: PanelDialogueLine['type']): boolean =>
  speakerRequiredTypes.has(type);

export const isPanelDialogueSpeakerValid = (
  type: PanelDialogueLine['type'],
  entityId: string | null,
  assignedEntityIds: readonly string[]
): boolean =>
  !requiresPanelDialogueSpeaker(type) ||
  (entityId !== null && assignedEntityIds.includes(entityId));

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findNarrationCharacterQuote = (
  text: string,
  entities: readonly NamedEntity[]
): string | null => {
  for (const entity of entities) {
    const name = entity.name.trim();
    if (name.length === 0) {
      continue;
    }
    const characterQuote = new RegExp(`${escapeRegExp(name)}\\s*[「『]`);
    if (characterQuote.test(text)) {
      return name;
    }
  }
  return null;
};
