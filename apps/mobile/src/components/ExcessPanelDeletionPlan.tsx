import { StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

export interface ExcessPanelDeletionCandidate {
  dialogueCount: number;
  entityCount: number;
  id: string;
  order: number;
  situation: string;
}

interface ExcessPanelDeletionPlanProps {
  language: UiLanguage;
  onReviewDelete: (panelId: string) => void;
  panels: readonly ExcessPanelDeletionCandidate[];
  targetPanelCount: number;
}

export function ExcessPanelDeletionPlan({
  language,
  onReviewDelete,
  panels,
  targetPanelCount,
}: ExcessPanelDeletionPlanProps): React.JSX.Element | null {
  if (panels.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      <Notice
        message={t(language, 'component.excessPanelDeletionPlan.notice', { targetPanelCount })}
        tone="warning"
      />
      {panels.map((panel) => (
        <View key={panel.id} style={styles.row}>
          <View style={styles.summary}>
            <Text style={styles.title}>
              {t(language, 'component.excessPanelDeletionPlan.panelTitle', { order: panel.order })}
            </Text>
            <Text style={styles.caption}>{panel.situation}</Text>
            <Text style={styles.caption}>
              {t(language, 'component.excessPanelDeletionPlan.panelContents', {
                entityCount: panel.entityCount,
                dialogueCount: panel.dialogueCount
              })}
            </Text>
          </View>
          <PrimaryButton
            label={t(language, 'component.excessPanelDeletionPlan.reviewForDeletion', { order: panel.order })}
            onPress={() => onReviewDelete(panel.id)}
            variant="danger"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...textStyles.caption,
    color: colors.muted,
  },
  root: {
    gap: spacing.sm,
  },
  row: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  summary: {
    gap: spacing.xs,
  },
  title: {
    ...textStyles.body,
    fontWeight: '700',
  },
});
