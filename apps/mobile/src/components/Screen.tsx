import type { PropsWithChildren, RefObject } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice } from '@/components/Notice';
import { ResponsiveContentFrame } from '@/components/ResponsiveContentFrame';
import { colors, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { useNetworkStatus } from '@/state/networkStatus';

interface ScreenProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  showHeader?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollViewRef?: RefObject<ScrollView | null>;
  testID?: string;
}

export function Screen({
  title,
  eyebrow,
  subtitle,
  showHeader = true,
  refreshing = false,
  onRefresh,
  scrollViewRef,
  testID,
  children
}: ScreenProps): React.JSX.Element {
  const { language, online } = useNetworkStatus();
  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea} testID={testID}>
      <StatusBar backgroundColor={colors.canvas} barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoider}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh === undefined ? undefined : (
              <RefreshControl
                colors={[colors.primary]}
                onRefresh={onRefresh}
                progressBackgroundColor={colors.surfaceAlt}
                refreshing={refreshing}
                tintColor={colors.primary}
              />
            )
          }
          ref={scrollViewRef}
        >
          <ResponsiveContentFrame style={styles.content} testID="screen-content-frame">
            {showHeader ? (
              <View style={styles.header}>
                {eyebrow === undefined ? null : <Text style={styles.eyebrow}>{eyebrow}</Text>}
                <Text accessibilityRole="header" style={styles.title}>{title}</Text>
                {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
              </View>
            ) : null}
            {online ? null : (
              <Notice
                message={t(language, 'shared.screen.offline')}
                tone="warning"
              />
            )}
            {children}
          </ResponsiveContentFrame>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: 112
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  header: {
    backgroundColor: 'rgba(10, 10, 10, 0.86)',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: 3,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  keyboardAvoider: {
    flex: 1
  },
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  subtitle: {
    ...textStyles.caption,
    color: colors.muted
  },
  title: {
    ...textStyles.title
  }
});
