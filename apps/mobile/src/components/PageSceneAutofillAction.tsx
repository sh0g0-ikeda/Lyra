import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageSceneAutofillActionProps {
  canEdit: boolean;
  hasActiveJob: boolean;
  isEditableDraft: boolean;
  language: UiLanguage;
  loading: boolean;
  onPress: () => void;
  pageNumber: number | null;
  sourceSceneLabels: string[];
}

export function PageSceneAutofillAction({
  canEdit,
  hasActiveJob,
  isEditableDraft,
  language,
  loading,
  onPress,
  pageNumber,
  sourceSceneLabels
}: PageSceneAutofillActionProps): React.JSX.Element {
  const disabled = !canEdit || pageNumber === null || !isEditableDraft || hasActiveJob || sourceSceneLabels.length === 0;
  const disabledReason = !canEdit
    ? t(language, 'component.pageSceneAutofill.editPermissionRequired')
    : pageNumber === null
      ? t(language, 'component.pageSceneAutofill.selectPageFirst')
      : !isEditableDraft
        ? t(language, 'component.pageSceneAutofill.editableDraftRequired')
        : hasActiveJob
          ? t(language, 'component.pageSceneAutofill.waitForActiveJob')
          : sourceSceneLabels.length === 0
            ? t(language, 'component.pageSceneAutofill.sceneSourceRequired')
            : undefined;

  return (
    <View style={styles.root}>
      <Text style={styles.description}>{t(language, 'component.pageSceneAutofill.description')}</Text>
      <Text style={styles.selection}>
        {pageNumber === null
          ? t(language, 'component.pageSceneAutofill.noPageSelected')
          : t(language, 'component.pageSceneAutofill.selectedPage', { pageNumber })}
      </Text>
      {sourceSceneLabels.length === 0 ? (
        <Text style={styles.provenance}>{t(language, 'component.pageSceneAutofill.noSceneSources')}</Text>
      ) : (
        <View style={styles.provenanceList}>
          <Text style={styles.provenanceTitle}>{t(language, 'component.pageSceneAutofill.sceneSources')}</Text>
          {sourceSceneLabels.map((label) => (
            <Text key={label} style={styles.provenance}>- {label}</Text>
          ))}
        </View>
      )}
      <PrimaryButton
        disabled={disabled}
        disabledReason={disabledReason}
        label={t(language, 'component.pageSceneAutofill.apply')}
        loading={loading}
        onPress={onPress}
        variant="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  description: {
    ...textStyles.caption,
    color: colors.mutedSoft
  },
  provenance: {
    ...textStyles.caption,
    color: colors.ink
  },
  provenanceList: {
    gap: spacing.xs
  },
  provenanceTitle: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  root: {
    gap: spacing.sm
  },
  selection: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700'
  }
});
