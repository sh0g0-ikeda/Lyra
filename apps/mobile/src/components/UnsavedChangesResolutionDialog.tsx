import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { DirtyStateChoice } from '@/domain/dirtyStatePolicy';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';
import { commonGuidanceMessages } from '@/lib/commonGuidanceMessages';

interface UnsavedChangesResolutionDialogProps {
  language: UiLanguage;
  onSelect: (choice: DirtyStateChoice) => void;
  visible: boolean;
}

export function UnsavedChangesResolutionDialog({
  language,
  onSelect,
  visible
}: UnsavedChangesResolutionDialogProps): React.JSX.Element {
  const copy = commonGuidanceMessages(language);
  const cancel = (): void => onSelect('cancel');

  return (
    <Modal
      animationType="fade"
      onRequestClose={cancel}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessible={false}
        onPress={cancel}
        style={styles.backdrop}
      >
        <SafeAreaProvider>
          <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
              <View
                accessibilityViewIsModal
                onAccessibilityEscape={cancel}
                onStartShouldSetResponder={() => true}
                style={styles.dialog}
              >
                <Text accessibilityRole="header" style={styles.title}>
                  {t(language, "generated.lib.confirm.unsaved.changes.4947a834")}
                </Text>
                <Text style={styles.message}>
                  {copy.dirtyMessage}
                </Text>
                <View style={styles.actions}>
                  <PrimaryButton
                    label={copy.saveContinue}
                    onPress={() => onSelect('save')}
                    testID="dirty-resolution-save"
                  />
                  <PrimaryButton
                    label={copy.discardContinue}
                    onPress={() => onSelect('discard')}
                    testID="dirty-resolution-discard"
                    variant="danger"
                  />
                  <PrimaryButton
                    label={copy.goBack}
                    onPress={cancel}
                    testID="dirty-resolution-cancel"
                    variant="secondary"
                  />
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1
  },
  dialog: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: '100%'
  },
  message: {
    ...textStyles.body,
    color: colors.ink
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  title: {
    ...textStyles.sectionTitle,
    color: colors.inkStrong
  }
});
