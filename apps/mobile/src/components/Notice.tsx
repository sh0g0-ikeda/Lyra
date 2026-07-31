import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';

interface NoticeProps {
  message: string;
  tone?: 'danger' | 'info';
}

export function Notice({
  message,
  tone = 'info',
}: NoticeProps): React.JSX.Element {
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.container, tone === 'danger' && styles.danger]}
    >
      <Text style={[styles.text, tone === 'danger' && styles.dangerText]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.danger,
  },
  dangerText: {
    color: colors.danger,
  },
  text: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 23,
  },
});
