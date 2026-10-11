import { stateAutofillRequestOptions, type EpisodeStateAutofillChoice, type EpisodeStateAutofillRequestOptions } from '@/domain/episodeStateAutofillPolicy';
import type { UiLanguage } from '@/domain/types';
import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';
import { confirmAction } from '@/lib/confirm';
import { episodeStateMessage } from '@/lib/episodeStateMessages';
import { t } from '@/lib/i18n';

export function confirmStoryStateAutofill(input: {
  language: UiLanguage;
  available: boolean;
  choice: EpisodeStateAutofillChoice;
  includeSkeletonGeneration?: boolean;
  overwriteSummary?: string;
  isCurrent: () => boolean;
  onConfirm: (options: EpisodeStateAutofillRequestOptions | undefined) => void;
}): void {
  // Snapshot the explicitly reviewed options. Later toggle changes cannot widen
  // a pending confirmation from preserve to overwrite.
  const options = stateAutofillRequestOptions(input.available, input.choice);
  const stateCopy = options === undefined ? '' : `\n\n${episodeStateMessage(input.language, 'stateConfirmation')}\n${episodeStateMessage(input.language, options.state_assignment_policy === 'overwrite_existing' ? 'overwriteWarning' : 'preserveHelp')}`;
  const operationConfirmation = input.includeSkeletonGeneration === true
    ? `${t(input.language, 'screen.pages.design.generateConfirmation')}\n\n${t(input.language, 'screen.pages.design.autofillConfirmation')}`
    : t(input.language, 'screen.pages.design.autofillConfirmation');
  const overwriteSummary = input.overwriteSummary === undefined ? '' : `${input.overwriteSummary}\n\n`;
  confirmAction({
    language: input.language,
    title: t(input.language, 'component.storyGenerationControls.autofillAction'),
    message: appendAiProviderDisclosure(`${overwriteSummary}${operationConfirmation}${stateCopy}`, input.language, 'text'),
    confirmLabel: t(input.language, 'component.storyGenerationControls.autofillAction'),
    destructive: true,
    onConfirm: () => { if (input.isCurrent()) input.onConfirm(options); }
  });
}
