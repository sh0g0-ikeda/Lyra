import type { EntityStateRecord } from '@/domain/types';
import { t } from '@/lib/i18n';
import type { SharedTranslationKey } from '@/lib/i18nSharedMessages';

export interface PageEntityStateOption {
  id: string;
  label: string;
}

interface BuildPageEntityStateOptionsInput {
  entityId: string;
  language: 'ja' | 'en';
  states: readonly EntityStateRecord[];
}

const describeState = (
  state: EntityStateRecord,
  language: 'ja' | 'en',
  index: number
): string => {
  const parts: string[] = [];
  const add = (labelKey: SharedTranslationKey, value: string | null): void => {
    const normalized = value?.trim() ?? '';
    if (normalized.length > 0) {
      parts.push(`${t(language, labelKey)}: ${normalized}`);
    }
  };

  add('shared.pageEntityState.costume', state.costume_note);
  add('shared.pageEntityState.condition', state.condition_note);
  add('shared.pageEntityState.hair', state.hair_note);
  add('shared.pageEntityState.expression', state.expression_default);
  add('shared.pageEntityState.notes', state.extra_note);

  if (parts.length === 0) {
    return t(language, 'shared.pageEntityState.fallback', { index: index + 1 });
  }
  return parts.join(' / ');
};

export const buildPageEntityStateOptions = ({
  entityId,
  language,
  states
}: BuildPageEntityStateOptionsInput): PageEntityStateOption[] => {
  const matchingStates = states.filter((state) => state.entity_id === entityId);
  return [
    {
      id: '',
      label: t(language, 'shared.pageEntityState.none')
    },
    ...matchingStates.map((state, index) => ({
      id: state.id,
      label: describeState(state, language, index)
    }))
  ];
};
