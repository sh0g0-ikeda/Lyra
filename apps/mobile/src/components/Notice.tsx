import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';

interface NoticeProps {
  actionLabel?: string;
  actionTestID?: string;
  message: string;
  onAction?: () => void;
  tone?: 'info' | 'warning' | 'danger' | 'success';
}

export function Notice({
  actionLabel,
  actionTestID,
  message,
  onAction,
  tone = 'info'
}: NoticeProps): React.JSX.Element {
  const textToneStyle =
    tone === 'warning'
      ? styles.warningText
      : tone === 'danger'
        ? styles.dangerText
        : tone === 'success'
          ? styles.successText
          : styles.infoText;

  return (
    <View
      style={[
        styles.notice,
        tone === 'warning' ? styles.warning : null,
        tone === 'danger' ? styles.danger : null,
        tone === 'success' ? styles.success : null
      ]}
    >
      <Text style={[styles.text, textToneStyle]}>{message}</Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            pressed ? styles.actionPressed : null
          ]}
          testID={actionTestID}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'flex-start',
    borderColor: 'rgba(229, 199, 107, 0.42)',
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  actionLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 20
  },
  actionPressed: {
    opacity: 0.72
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: 'rgba(244, 67, 54, 0.28)'
  },
  dangerText: {
    color: '#FF9E96'
  },
  infoText: {
    color: '#E4D08A'
  },
  notice: {
    backgroundColor: 'rgba(229, 199, 107, 0.10)',
    borderColor: 'rgba(229, 199, 107, 0.18)',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: 'rgba(76, 175, 80, 0.28)'
  },
  successText: {
    color: '#88D989'
  },
  text: {
    ...textStyles.body
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: 'rgba(255, 193, 7, 0.28)'
  },
  warningText: {
    color: '#FFD56A'
  }
});
