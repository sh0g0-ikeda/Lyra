import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { DirtyStateChoice } from '@/domain/dirtyStatePolicy';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface UnsavedChangesResolutionDialogProps {
  language: UiLanguage;
  onSelect: (choice: DirtyStateChoice) => void;
  saving: boolean;
  visible: boolean;
}

export function UnsavedChangesResolutionDialog({
  language,
  onSelect,
  saving,
  visible
}: UnsavedChangesResolutionDialogProps): React.JSX.Element {
  const select = (choice: DirtyStateChoice): void => {
    if (!saving) {
      onSelect(choice);
    }
  };
  const cancel = (): void => select('cancel');

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
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
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
              {t(language, "generated.lib.confirm.save.or.discard.your.edits.before.leavin.764f7978")}
            </Text>
            <View style={styles.actions}>
              <PrimaryButton
                disabled={saving}
                label={t(language, "generated.lib.confirm.save.80b89d5e")}
                loading={saving}
                onPress={() => select('save')}
                testID="dirty-resolution-save"
              />
              <PrimaryButton
                disabled={saving}
                label={t(language, "generated.lib.confirm.discard.bd94165e")}
                onPress={() => select('discard')}
                testID="dirty-resolution-discard"
                variant="danger"
              />
              <PrimaryButton
                disabled={saving}
                label={t(language, "generated.lib.confirm.cancel.3672b0b9")}
                onPress={cancel}
                testID="dirty-resolution-cancel"
                variant="secondary"
              />
            </View>
          </View>
        </SafeAreaView>
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
  title: {
    ...textStyles.sectionTitle,
    color: colors.inkStrong
  }
});
