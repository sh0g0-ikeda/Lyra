import type { PropsWithChildren } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';

interface ScreenProps extends PropsWithChildren {
  title: string;
}

export function Screen({
  children,
  title,
}: ScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
  },
});
