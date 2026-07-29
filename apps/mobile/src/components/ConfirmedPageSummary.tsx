import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/constants/theme';
import type { PageRecord, UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface ConfirmedPageSummaryProps {
  language: UiLanguage;
  page: PageRecord;
  sourceSceneLabels: readonly string[];
}

export function ConfirmedPageSummary({
  language,
  page,
  sourceSceneLabels
}: ConfirmedPageSummaryProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {t(language, "generated.components.ConfirmedPageSummary.confirmed.page.50b23c70")}
      </Text>
      <Text style={styles.pageNumber}>
        {t(language, 'component.confirmedPageSummary.pageNumber', { pageNumber: page.page_number })}
      </Text>
      <SummaryRow
        label={t(language, "generated.components.ConfirmedPageSummary.story.sources.82e34b3e")}
        value={
          sourceSceneLabels.length === 0
            ? t(language, "generated.components.ConfirmedPageSummary.none.56ce12f1")
            : sourceSceneLabels.join(' / ')
        }
      />
      <SummaryRow
        label={t(language, "generated.components.ConfirmedPageSummary.page.purpose.a8b0e5bd")}
        value={page.story_page_purpose?.trim() || t(language, "generated.components.ConfirmedPageSummary.none.56ce12f1")}
      />
      <SummaryRow
        label={t(language, "generated.components.ConfirmedPageSummary.continuity.c1023676")}
        value={page.story_continuity_note?.trim() || t(language, "generated.components.ConfirmedPageSummary.none.56ce12f1")}
      />
      <Text style={styles.counts}>
        {t(language, 'component.confirmedPageSummary.counts', {
          panelCount: page.panel_count,
          frameCount: page.frame_count,
          balloonCount: page.balloon_count
        })}
      </Text>
      <Text style={styles.caption}>
        {t(language, "generated.components.ConfirmedPageSummary.reopen.this.page.before.editing.or.regen.bfaf6ff1")}
      </Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...textStyles.caption
  },
  counts: {
    ...textStyles.body,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    fontWeight: '700',
    paddingTop: spacing.sm
  },
  label: {
    ...textStyles.caption,
    color: colors.muted
  },
  pageNumber: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  },
  root: {
    gap: spacing.sm
  },
  row: {
    gap: spacing.xs
  },
  title: {
    ...textStyles.sectionTitle
  },
  value: {
    ...textStyles.body
  }
});
