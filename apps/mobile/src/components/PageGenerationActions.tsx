import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { spacing } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageGenerationActionsProps {
  canConfirm: boolean;
  confirmDisabledReason?: string;
  confirmed: boolean;
  confirmLoading: boolean;
  generateDisabled: boolean;
  generateDisabledReason?: string;
  generateLoading: boolean;
  language: UiLanguage;
  onConfirm: () => void;
  onGenerate: () => void;
  onReopen: () => void;
  reopenLoading: boolean;
}

export function PageGenerationActions({
  canConfirm,
  confirmDisabledReason,
  confirmed,
  confirmLoading,
  generateDisabled,
  generateDisabledReason,
  generateLoading,
  language,
  onConfirm,
  onGenerate,
  onReopen,
  reopenLoading
}: PageGenerationActionsProps): React.JSX.Element {
  return (
    <View style={styles.actions}>
      <PrimaryButton
        disabled={generateDisabled}
        disabledReason={generateDisabledReason}
        label={t(language, 'generate')}
        loading={generateLoading}
        onPress={onGenerate}
        testID="page-generation-action"
      />
      {confirmed ? (
        <PrimaryButton
          disabled={!canConfirm}
          disabledReason={confirmDisabledReason}
          label={t(language, 'reopenPage')}
          loading={reopenLoading}
          onPress={onReopen}
          testID="page-reopen-action"
          variant="secondary"
        />
      ) : (
        <PrimaryButton
          disabled={!canConfirm}
          disabledReason={confirmDisabledReason}
          label={t(language, 'confirmPage')}
          loading={confirmLoading}
          onPress={onConfirm}
          testID="page-confirm-action"
          variant="secondary"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  }
});
