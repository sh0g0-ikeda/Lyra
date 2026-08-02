import { StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface StoryGenerationControlsProps {
  canGenerate: boolean;
  estimatedPagesInvalid: boolean;
  hasActiveJob?: boolean;
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
  hasActiveJob = false,
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
  const operationLoading = skeletonLoading || storyApplyLoading;
  const commonDisabled =
    !canGenerate ||
    !selectedEpisode ||
    estimatedPagesInvalid ||
    hasActiveJob ||
    operationLoading;
  const commonDisabledReason = !canGenerate
    ? t(language, "generated.components.StoryGenerationControls.generation.permission.is.required.1bc5b7af")
    : !selectedEpisode
      ? t(language, "generated.components.StoryGenerationControls.select.an.episode.first.437356a6")
      : estimatedPagesInvalid
        ? t(language, "generated.components.StoryGenerationControls.check.page.count.846aeb03")
        : hasActiveJob || operationLoading
          ? t(language, 'component.storyGenerationControls.activeJob')
          : undefined;

  return (
    <View style={styles.root}>
      <Text style={styles.description}>
        {t(language, 'component.storyGenerationControls.description')}
      </Text>
      <View style={styles.steps}>
        <Text style={styles.stepText}>
          <Text style={styles.stepTitle}>
            {t(language, 'component.storyGenerationControls.step1Title')}
          </Text>
          {t(language, 'component.storyGenerationControls.step1Description')}
        </Text>
        <Text style={styles.stepText}>
          <Text style={styles.stepTitle}>
            {t(language, 'component.storyGenerationControls.step2Title')}
          </Text>
          {t(language, 'component.storyGenerationControls.step2Description')}
        </Text>
        <Text style={styles.estimate}>
          {t(language, 'component.storyGenerationControls.autofillEstimate')}
        </Text>
      </View>
      {overwrite ? (
        <Text style={styles.warning}>
          {t(language, 'component.storyGenerationControls.overwriteWarning')}
        </Text>
      ) : null}
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
          label={t(language, 'component.storyGenerationControls.autofillAction')}
          loading={storyApplyLoading}
          onPress={onApplyStory}
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
  description: {
    ...textStyles.body,
    color: colors.ink
  },
  estimate: {
    ...textStyles.caption,
    color: colors.primary
  },
  root: {
    gap: spacing.md
  },
  steps: {
    gap: spacing.sm
  },
  stepText: {
    ...textStyles.body,
    color: colors.muted
  },
  stepTitle: {
    color: colors.ink,
    fontWeight: '800'
  },
  warning: {
    ...textStyles.body,
    color: colors.warning
  }
});
