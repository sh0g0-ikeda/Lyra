import { automaticStateAutofillRequestOptions, type EpisodeStateAutofillRequestOptions } from '@/domain/episodeStateAutofillPolicy';
import type { UiLanguage } from '@/domain/types';
import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';
import { confirmAction } from '@/lib/confirm';
import { t } from '@/lib/i18n';

export function confirmStoryStateAutofill(input: {
  language: UiLanguage;
  available: boolean;
  includeSkeletonGeneration?: boolean;
  overwriteSummary?: string;
  isCurrent: () => boolean;
  onConfirm: (options: EpisodeStateAutofillRequestOptions | undefined) => void;
}): void {
  const options = automaticStateAutofillRequestOptions(input.available);
  const operationConfirmation = input.includeSkeletonGeneration === true
    ? `${t(input.language, 'screen.pages.design.generateConfirmation')}\n\n${t(input.language, 'screen.pages.design.autofillConfirmation')}`
    : t(input.language, 'screen.pages.design.autofillConfirmation');
  const overwriteSummary = input.overwriteSummary === undefined ? '' : `${input.overwriteSummary}\n\n`;
  confirmAction({
    language: input.language,
    title: t(input.language, 'component.storyGenerationControls.autofillAction'),
    message: appendAiProviderDisclosure(`${overwriteSummary}${operationConfirmation}`, input.language, 'text'),
    confirmLabel: t(input.language, 'component.storyGenerationControls.autofillAction'),
    destructive: true,
    onConfirm: () => { if (input.isCurrent()) input.onConfirm(options); }
  });
}
