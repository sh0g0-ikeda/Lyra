import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import { extractImprovedFullStory } from '@/domain/storyWorkflow';
import type { StoryEpisodeImprovementRecord, UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface EpisodeImprovementPanelProps {
  canEdit: boolean;
  improvement: StoryEpisodeImprovementRecord | null;
  improveLoading?: boolean;
  instruction: string;
  language: UiLanguage;
  onApply: () => void;
  onImprove: () => void;
  onImprovementChange: (value: string) => void;
  onInstructionChange: (value: string) => void;
  selectedEpisode: boolean;
}

export function EpisodeImprovementPanel({
  canEdit,
  improvement,
  improveLoading = false,
  instruction,
  language,
  onApply,
  onImprove,
  onImprovementChange,
  onInstructionChange,
  selectedEpisode
}: EpisodeImprovementPanelProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <FormField
        label={t(language, "generated.components.EpisodeImprovementPanel.improvement.instruction.193a848b")}
        maxLength={2000}
        multiline
        onChangeText={onInstructionChange}
        value={instruction}
      />
      <PrimaryButton
        disabled={!canEdit || !selectedEpisode || instruction.trim().length === 0}
        disabledReason={
          !canEdit
            ? t(language, "generated.components.EpisodeImprovementPanel.editing.permission.is.required.6d3b86ee")
            : !selectedEpisode
              ? t(language, "generated.components.EpisodeImprovementPanel.select.an.episode.first.437356a6")
              : instruction.trim().length === 0
                ? t(language, "generated.components.EpisodeImprovementPanel.enter.an.improvement.instruction.c909e9e2")
                : undefined
        }
        label={t(language, "generated.components.EpisodeImprovementPanel.improve.episode.35262d02")}
        loading={improveLoading}
        onPress={onImprove}
      />
      {improvement === null ? null : (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>
            {t(language, "generated.components.EpisodeImprovementPanel.ai.improvement.c55937b3")}
          </Text>
          <FormField
            label={t(language, "generated.components.EpisodeImprovementPanel.improved.full.story.8e9a044b")}
            maxLength={8000}
            multiline
            multilineMaxHeight={260}
            onChangeText={onImprovementChange}
            value={extractImprovedFullStory(improvement)}
          />
          <PrimaryButton
            disabled={!canEdit}
            label={t(language, "generated.components.EpisodeImprovementPanel.apply.improvement.to.story.de94e05c")}
            onPress={onApply}
            variant="secondary"
          />
          <Text style={styles.caption}>
            {t(language, "generated.components.EpisodeImprovementPanel.after.applying.you.can.improve.the.curre.88d89597")}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...textStyles.caption
  },
  result: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md
  },
  resultTitle: {
    ...textStyles.sectionTitle,
    color: colors.primary
  },
  root: {
    gap: spacing.md
  }
});
