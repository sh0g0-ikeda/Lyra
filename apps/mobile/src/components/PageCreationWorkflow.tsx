import { PrimaryButton } from '@/components/PrimaryButton';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageStoryAutofillActionProps { blockReason?: string; canGenerate: boolean; hasActiveJob: boolean; jobEnqueued: boolean; language: UiLanguage; loading: boolean; onPress: () => void; pagesLoading: boolean; selectedEpisode: boolean; }

// One user intent owns the skeleton then autofill chain. PagesScreen keeps its
// monitor mounted separately until that intent settles.
export function PageStoryAutofillAction({ blockReason, canGenerate, hasActiveJob, jobEnqueued, language, loading, onPress, pagesLoading, selectedEpisode }: PageStoryAutofillActionProps): React.JSX.Element {
  const disabled = blockReason !== undefined || !canGenerate || !selectedEpisode || hasActiveJob || jobEnqueued || loading || pagesLoading;
  const disabledReason = blockReason ?? (!canGenerate
    ? t(language, 'generated.components.StoryGenerationControls.generation.permission.is.required.1bc5b7af')
    : !selectedEpisode
      ? t(language, 'generated.components.StoryGenerationControls.select.an.episode.first.437356a6')
      : pagesLoading
        ? t(language, 'generated.components.StoryGenerationControls.checking.existing.pages.4fbfc50b')
        : hasActiveJob || loading || jobEnqueued
          ? t(language, 'component.storyGenerationControls.activeJob')
          : undefined);
  return <PrimaryButton disabled={disabled} disabledReason={disabledReason} label={t(language, 'component.storyGenerationControls.autofillAction')} loading={loading} onPress={onPress} testID="page-story-autofill-primary" variant="primary" />;
}
