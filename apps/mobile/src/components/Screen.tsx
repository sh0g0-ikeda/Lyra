import type { PropsWithChildren, RefObject } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice } from '@/components/Notice';
import { ResponsiveContentFrame } from '@/components/ResponsiveContentFrame';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
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
  contentStyle?: StyleProp<ViewStyle>;
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
  contentStyle,
  testID,
  children
}: ScreenProps): React.JSX.Element {
  const { language, online, setLanguage } = useNetworkStatus();
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
          <ResponsiveContentFrame style={[styles.content, contentStyle]} testID="screen-content-frame">
            <View accessibilityLabel="Language / 言語" style={styles.languageSwitcher}>
              <Pressable
                accessibilityLabel="English"
                accessibilityRole="radio"
                accessibilityState={{ checked: language === 'en' }}
                onPress={() => void setLanguage('en')}
                style={{
                  ...styles.languageOption,
                  ...(language === 'en' ? styles.languageOptionActive : {})
                }}
              >
                <Text style={language === 'en' ? styles.languageTextActive : styles.languageText}>ENG</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="日本語"
                accessibilityRole="radio"
                accessibilityState={{ checked: language === 'ja' }}
                onPress={() => void setLanguage('ja')}
                style={{
                  ...styles.languageOption,
                  ...(language === 'ja' ? styles.languageOptionActive : {})
                }}
              >
                <Text style={language === 'ja' ? styles.languageTextActive : styles.languageText}>日本語</Text>
              </Pressable>
            </View>
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
  languageOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 54,
    paddingHorizontal: spacing.sm
  },
  languageOptionActive: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.controlBorder
  },
  languageSwitcher: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs
  },
  languageText: {
    ...textStyles.caption,
    color: colors.muted
  },
  languageTextActive: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700'
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
