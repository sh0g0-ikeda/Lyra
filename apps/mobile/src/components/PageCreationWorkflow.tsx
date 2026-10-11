import { useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageStoryAutofillActionProps { canGenerate: boolean; hasActiveJob: boolean; jobEnqueued: boolean; language: UiLanguage; loading: boolean; onPress: () => void; pagesLoading: boolean; selectedEpisode: boolean; }

// The primary page flow is intentionally one action followed by the page list.
// Existing page-design controls remain available in the collapsed history below it.
export function PageStoryAutofillAction({ canGenerate, hasActiveJob, jobEnqueued, language, loading, onPress, pagesLoading, selectedEpisode }: PageStoryAutofillActionProps): React.JSX.Element {
  const disabled = !canGenerate || !selectedEpisode || hasActiveJob || jobEnqueued || loading || pagesLoading;
  const disabledReason = !canGenerate
    ? t(language, 'generated.components.StoryGenerationControls.generation.permission.is.required.1bc5b7af')
    : !selectedEpisode
      ? t(language, 'generated.components.StoryGenerationControls.select.an.episode.first.437356a6')
      : pagesLoading
        ? t(language, 'generated.components.StoryGenerationControls.checking.existing.pages.4fbfc50b')
        : hasActiveJob || loading || jobEnqueued
          ? t(language, 'component.storyGenerationControls.activeJob')
          : undefined;
  return <PrimaryButton disabled={disabled} disabledReason={disabledReason} label={t(language, 'component.storyGenerationControls.autofillAction')} loading={loading} onPress={onPress} testID="page-story-autofill-primary" variant="primary" />;
}

export function PageJobHistory({ children, title }: PropsWithChildren<{ title: string }>): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.history}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.historyToggle} testID="page-job-history-toggle">
      <Text style={styles.historyTitle}>{title}</Text><Text style={styles.historyIcon}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'} style={expanded ? styles.historyContent : styles.hidden} testID="page-job-history-content">{children}</View>
  </View>;
}
const styles = StyleSheet.create({
  hidden: { display: 'none' },
  history: { borderColor: colors.controlBorder, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  historyContent: { gap: spacing.md, padding: spacing.md },
  historyIcon: { ...textStyles.body, color: colors.primary, fontWeight: '800' },
  historyTitle: { ...textStyles.body, color: colors.inkStrong, fontWeight: '700' },
  historyToggle: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }
});
