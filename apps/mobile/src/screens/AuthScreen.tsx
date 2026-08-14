import { useEffect, useState } from 'react';
import {
  Animated,
  Image,
  Linking,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ResponsiveContentFrame } from '@/components/ResponsiveContentFrame';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { isAuthConfigured } from '@/lib/config';
import { t } from '@/lib/i18n';
import { signInWithCognito } from '@/lib/auth';
import { userErrorMessage } from '@/lib/userMessages';
import { useAppState } from '@/state/appState';

const brandMark = require('../../assets/brand-mark.png') as ImageSourcePropType;
const authFeatureKeys = [
  'screen.auth.feature.story',
  'screen.auth.feature.character',
  'screen.auth.feature.page'
] as const;
const legalLinks = {
  privacy: 'https://app.lyra-editor.com/privacy.html',
  support: 'https://app.lyra-editor.com/support.html',
  terms: 'https://app.lyra-editor.com/terms.html'
} as const;

interface AuthScreenProps {
  pendingInvitation?: boolean;
}

export function AuthScreen({ pendingInvitation = false }: AuthScreenProps): React.JSX.Element {
  const { language, setTokens } = useAppState();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [splashOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      Animated.timing(splashOpacity, {
        duration: 180,
        toValue: 0,
        useNativeDriver: true
      }).start(() => setShowSplash(false));
    }, 900);

    return () => clearTimeout(timeoutId);
  }, [splashOpacity]);

  const signIn = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const tokens = await signInWithCognito(language);
      await setTokens(tokens);
    } catch (error) {
      setErrorMessage(userErrorMessage(error, language));
    } finally {
      setLoading(false);
    }
  };
  const openLegalLink = async (url: string): Promise<void> => {
    try {
      await Linking.openURL(url);
    } catch {
      setErrorMessage(
        t(language, "generated.screens.AuthScreen.could.not.open.the.page.check.your.conne.ceb60300")
      );
    }
  };

  return showSplash ? (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.splash}>
      <StatusBar backgroundColor={colors.canvas} barStyle="light-content" />
      <ResponsiveContentFrame style={styles.splashFrame} testID="auth-splash-content-frame">
        <Animated.Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={t(language, 'screen.auth.brand')}
          resizeMode="contain"
          source={brandMark}
          style={[styles.splashMark, { opacity: splashOpacity }]}
        />
        <Animated.View style={[styles.splashCopy, { opacity: splashOpacity }]}>
          <Text style={styles.splashTitle}>Lyra Japan</Text>
          <Text style={styles.splashSubtitle}>{t(language, 'lyraSubtitle')}</Text>
        </Animated.View>
      </ResponsiveContentFrame>
    </SafeAreaView>
  ) : (
    <Screen contentStyle={styles.screenContent} showHeader={false} testID="auth-screen" title="Lyra Japan">
      <View style={styles.authLayout}>
        <View style={styles.intro}>
          <Image
            accessibilityIgnoresInvertColors
            accessibilityLabel={t(language, 'screen.auth.brand')}
            resizeMode="contain"
            source={brandMark}
            style={styles.brandMark}
          />
          <Text style={styles.eyebrow}>LYRA MOBILE</Text>
          <Text accessibilityRole="header" style={styles.headline}>
            {t(language, 'screen.auth.headline')}
          </Text>
          <Text style={styles.summary}>{t(language, 'screen.auth.summary')}</Text>
        </View>

        <View style={styles.features}>
          {authFeatureKeys.map((key, index) => (
            <View key={key} style={styles.featureRow}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.featureIndex}
              >
                <Text style={styles.featureIndexText}>{index + 1}</Text>
              </View>
              <Text style={styles.featureLabel}>{t(language, key)}</Text>
            </View>
          ))}
        </View>

        {isAuthConfigured() ? null : <Notice message={t(language, 'apiSetupRequired')} tone="warning" />}
        {pendingInvitation ? (
          <Notice
            message={t(language, "generated.screens.AuthScreen.sign.in.with.the.same.email.address.that.120eacc0")}
            tone="info"
          />
        ) : null}
        {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}

        <View style={styles.actionGroup}>
          <PrimaryButton
            disabled={!isAuthConfigured()}
            label={t(language, 'screen.auth.action')}
            loading={loading}
            onPress={() => void signIn()}
            size="large"
            testID="auth-login-button"
          />
          <Text style={styles.actionHint}>{t(language, 'screen.auth.actionHint')}</Text>
        </View>

        <View style={styles.footer}>
          <View accessibilityLabel={t(language, "generated.screens.AuthScreen.legal.and.support.d411b8e1")} style={styles.legalLinks}>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void openLegalLink(legalLinks.terms)}
              style={styles.legalLink}
            >
              <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.terms.63800dba")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void openLegalLink(legalLinks.privacy)}
              style={styles.legalLink}
            >
              <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.privacy.4437e12a")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void openLegalLink(legalLinks.support)}
              style={styles.legalLink}
            >
              <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.support.36269dd8")}</Text>
            </Pressable>
          </View>
          <Text style={styles.securityNote}>{t(language, 'screen.auth.securityNote')}</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionGroup: {
    gap: spacing.sm
  },
  actionHint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  },
  authLayout: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.xl,
    maxWidth: 560,
    width: '100%'
  },
  brandMark: {
    height: 128,
    width: 128
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase'
  },
  featureIndex: {
    alignItems: 'center',
    backgroundColor: colors.canvasAlt,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  featureIndexText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800'
  },
  featureLabel: {
    color: colors.inkStrong,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23
  },
  featureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  features: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden'
  },
  footer: {
    gap: spacing.sm,
    marginTop: 'auto',
    paddingTop: spacing.sm
  },
  headline: {
    color: colors.inkStrong,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 36,
    textAlign: 'center'
  },
  intro: {
    alignItems: 'center',
    gap: spacing.sm
  },
  legalLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs
  },
  legalLinks: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center'
  },
  legalLinkText: {
    color: colors.accent,
    fontSize: 14,
    textDecorationLine: 'underline'
  },
  screenContent: {
    gap: spacing.lg,
    paddingHorizontal: 20,
    paddingVertical: spacing.xl
  },
  securityNote: {
    color: colors.mutedSoft,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center'
  },
  splash: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  splashFrame: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg
  },
  splashCopy: {
    alignItems: 'center',
    gap: 6
  },
  splashMark: {
    height: 176,
    width: 176
  },
  splashSubtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center'
  },
  splashTitle: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 36,
    textAlign: 'center'
  },
  summary: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center'
  }
});
