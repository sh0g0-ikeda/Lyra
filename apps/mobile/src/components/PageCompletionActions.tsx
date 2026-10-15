import type { ReactNode, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { spacing } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageCompletionActionsProps {
  exportSection: ReactNode;
  generationSection: ReactNode;
}

export function PageCompletionActions({
  exportSection,
  generationSection
}: PageCompletionActionsProps): React.JSX.Element {
  return (
    <>
      {generationSection}
      {exportSection}
    </>
  );
}

interface PageGenerationStartActionsProps { canGenerate: boolean; disabledReason?: string; generateLoading?: boolean; generateMonochromeLoading?: boolean; language: UiLanguage; onGenerate: () => void; onGenerateMonochrome: () => void; }

export function PageGenerationStartActions({ canGenerate, disabledReason, generateLoading = false, generateMonochromeLoading = false, language, onGenerate, onGenerateMonochrome }: PageGenerationStartActionsProps): React.JSX.Element {
  return <View style={styles.actions}>
    <PrimaryButton disabled={!canGenerate} disabledReason={disabledReason} label={t(language, 'generate')} loading={generateLoading} onPress={onGenerate} testID="page-generation-action" />
    <PrimaryButton disabled={!canGenerate} disabledReason={disabledReason} label={t(language, 'generateMonochrome')} loading={generateMonochromeLoading} onPress={onGenerateMonochrome} testID="page-monochrome-generation-action" variant="secondary" />
  </View>;
}

interface PageConfirmationActionProps { buttonRef?: RefObject<View | null>; canConfirm: boolean; confirmed: boolean; disabledReason?: string; confirmLoading?: boolean; language: UiLanguage; onConfirm: () => void; onReopen: () => void; reopenLoading?: boolean; }

export function PageConfirmationAction({ buttonRef, canConfirm, confirmed, disabledReason, confirmLoading = false, language, onConfirm, onReopen, reopenLoading = false }: PageConfirmationActionProps): React.JSX.Element {
  return confirmed
    ? <PrimaryButton buttonRef={buttonRef} disabled={!canConfirm} disabledReason={disabledReason} label={t(language, 'reopenPage')} loading={reopenLoading} onPress={onReopen} testID="page-reopen-action" variant="secondary" />
    : <PrimaryButton buttonRef={buttonRef} disabled={!canConfirm} disabledReason={disabledReason} label={t(language, 'confirmPage')} loading={confirmLoading} onPress={onConfirm} testID="page-confirm-action" variant="secondary" />;
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } });
