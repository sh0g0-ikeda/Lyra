import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';

interface LoadingStateProps {
  label: string;
}

export function LoadingState({
  label,
}: LoadingStateProps): React.JSX.Element {
  return (
    <View accessibilityLabel={label} style={styles.container}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  label: {
    color: colors.muted,
    fontSize: 15,
  },
});
