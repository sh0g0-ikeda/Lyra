import { StyleSheet, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { spacing } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface StoryGenerationControlsProps {
  canGenerate: boolean;
  estimatedPagesInvalid: boolean;
  jobEnqueued: boolean;
  language: UiLanguage;
  onApplyStory: () => void;
  onGenerateSkeleton: () => void;
  overwrite: boolean;
  pagesLoading: boolean;
  selectedEpisode: boolean;
  storyApplyLoading?: boolean;
  skeletonLoading?: boolean;
}

export function StoryGenerationControls({
  canGenerate,
  estimatedPagesInvalid,
  jobEnqueued,
  language,
  onApplyStory,
  onGenerateSkeleton,
  overwrite,
  pagesLoading,
  selectedEpisode,
  skeletonLoading = false,
  storyApplyLoading = false
}: StoryGenerationControlsProps): React.JSX.Element {
  const commonDisabled = !canGenerate || !selectedEpisode || estimatedPagesInvalid;
  const commonDisabledReason = !canGenerate
    ? t(language, "generated.components.StoryGenerationControls.generation.permission.is.required.1bc5b7af")
    : !selectedEpisode
      ? t(language, "generated.components.StoryGenerationControls.select.an.episode.first.437356a6")
      : estimatedPagesInvalid
        ? t(language, "generated.components.StoryGenerationControls.check.page.count.846aeb03")
        : undefined;

  return (
    <View style={styles.root}>
      {jobEnqueued ? (
        <Notice
          message={t(language, "generated.components.StoryGenerationControls.processing.started.the.status.below.will.b1992386")}
          tone="info"
        />
      ) : null}
      <View style={styles.actions}>
        <PrimaryButton
          disabled={commonDisabled || pagesLoading}
          disabledReason={
            commonDisabledReason ??
            (pagesLoading
              ? t(language, "generated.components.StoryGenerationControls.checking.existing.pages.4fbfc50b")
              : undefined)
          }
          label={
            overwrite
              ? t(language, "generated.components.StoryGenerationControls.replace.and.regenerate.page.plan.afe93fc3")
              : t(language, "generated.components.StoryGenerationControls.generate.page.plan.a1048a6f")
          }
          loading={skeletonLoading}
          onPress={onGenerateSkeleton}
        />
        <PrimaryButton
          disabled={commonDisabled}
          disabledReason={commonDisabledReason}
          label={t(language, "generated.components.StoryGenerationControls.apply.whole.story.7d4f3180")}
          loading={storyApplyLoading}
          onPress={onApplyStory}
          variant="secondary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  root: {
    gap: spacing.md
  }
});
