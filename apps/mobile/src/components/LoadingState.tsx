import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/constants/theme';

interface LoadingStateProps {
  label: string;
}

export function LoadingState({ label }: LoadingStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md
  },
  label: {
    ...textStyles.body,
    color: colors.muted
  }
});
