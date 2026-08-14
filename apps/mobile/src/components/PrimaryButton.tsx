import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  size?: 'default' | 'large';
  testID?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  disabledReason,
  loading = false,
  size = 'default',
  testID,
  variant = 'primary'
}: PrimaryButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityHint={isDisabled ? disabledReason : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        size === 'large' ? styles.largeButton : null,
        variant === 'primary' ? styles.primary : null,
        variant === 'secondary' ? styles.secondary : null,
        variant === 'ghost' ? styles.ghost : null,
        variant === 'danger' ? styles.danger : null,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.primary} size="small" /> : null}
        <Text
          style={[
            styles.label,
            size === 'large' ? styles.largeLabel : null,
            variant === 'primary' ? styles.primaryLabel : null,
            variant === 'secondary' ? styles.secondaryLabel : null,
            variant === 'ghost' ? styles.ghostLabel : null
          ]}
        >
          {label}
        </Text>
      </View>
      {isDisabled && disabledReason !== undefined ? <Text style={styles.disabledReason}>{disabledReason}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 116,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center'
  },
  danger: {
    backgroundColor: 'rgba(114, 27, 20, 0.32)',
    borderColor: 'rgba(244, 67, 54, 0.4)'
  },
  disabled: {
    opacity: 0.45
  },
  disabledReason: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 14,
    marginTop: 3,
    textAlign: 'center'
  },
  label: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: 0
  },
  largeButton: {
    minHeight: 58,
    paddingVertical: spacing.lg,
    width: '100%'
  },
  largeLabel: {
    fontSize: 18,
    lineHeight: 24
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: 'rgba(245, 211, 102, 0.7)',
    shadowColor: colors.primaryPressed,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 3
  },
  primaryLabel: {
    color: colors.primaryText
  },
  secondary: {
    backgroundColor: colors.secondarySurface,
    borderColor: 'rgba(119, 174, 255, 0.42)'
  },
  secondaryLabel: {
    color: '#D9E8FF'
  },
  ghost: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border
  },
  ghostLabel: {
    color: colors.ink
  }
});
