import type { UiLanguage } from '@/domain/types';
import { commonGuidanceMessages } from '@/lib/commonGuidanceMessages';
import { confirmAction } from '@/lib/confirm';

export type StaleDraftScope = 'story' | 'character' | 'page';

// Deliberately separate destructive snapshot replacement from an ordinary read
// retry and from save/discard navigation. Cancel never invokes the reset command.
export function confirmStaleDraftReload(input: {
  language: UiLanguage;
  scope: StaleDraftScope;
  onConfirm: () => void;
}): void {
  const copy = commonGuidanceMessages(input.language);
  confirmAction({
    language: input.language,
    title: copy.reloadTitle,
    message: `${copy.reloadWarning}\n\n${copy.reloadFields[input.scope]}`,
    confirmLabel: copy.reloadConfirm,
    destructive: true,
    onConfirm: input.onConfirm
  });
}
