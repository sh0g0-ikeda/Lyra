import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType
} from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { isAuthConfigured } from '@/lib/config';
import { t } from '@/lib/i18n';
import { signInWithCognito } from '@/lib/auth';
import { userErrorMessage } from '@/lib/userMessages';
import { useGoogleAuthCapabilities } from '@/hooks/useGoogleAuthCapabilities';
import { useXAuthCapabilities } from '@/hooks/useXAuthCapabilities';
import { googleAuthMessages } from '@/lib/googleAuthMessages';
import { googleAllowedOnPlatform } from '@/lib/googleIdentityLink';
import { xAllowedOnMobile } from '@/lib/xAuth';
import { xAuthMessages } from '@/lib/xAuthMessages';
import { useAppState } from '@/state/appState';

const heroImage = require('../../assets/start_lyra.jpg') as ImageSourcePropType;
const heroImageSize = Image.resolveAssetSource(heroImage);
const heroImageAspectRatio = heroImageSize.width / heroImageSize.height;
const legalLinks = {
  ja: {
    privacy: 'https://app.lyra-editor.com/privacy.html',
    support: 'https://app.lyra-editor.com/support.html',
    terms: 'https://app.lyra-editor.com/terms.html'
  },
  en: {
    privacy: 'https://app.lyra-editor.com/privacy-en.html',
    support: 'https://app.lyra-editor.com/support-en.html',
    terms: 'https://app.lyra-editor.com/terms-en.html'
  }
} as const;

interface AuthScreenProps {
  pendingInvitation?: boolean;
}

export function AuthScreen({ pendingInvitation = false }: AuthScreenProps): React.JSX.Element {
  const { language, setTokens } = useAppState();
  const capabilities = useGoogleAuthCapabilities();
  const xCapabilities = useXAuthCapabilities();
  const copy = googleAuthMessages(language);
  const xCopy = xAuthMessages(language);
  const googleEnabled = !capabilities.isError && googleAllowedOnPlatform(capabilities.data, Platform.OS, 'google_sign_in');
  const xEnabled = !xCapabilities.isError && xAllowedOnMobile(xCapabilities.data, Platform.OS);
  const signingIn = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [splashOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      Animated.timing(splashOpacity, {
        duration: 260,
        toValue: 0,
        useNativeDriver: true
      }).start(() => setShowSplash(false));
    }, 1800);

    return () => clearTimeout(timeoutId);
  }, [splashOpacity]);

  const signIn = async (provider: 'Google' | 'X' | undefined = undefined): Promise<void> => {
    if (signingIn.current) return;
    signingIn.current = true;
    setLoading(true);
    setErrorMessage(null);
    try {
      if (provider === 'Google') {
        const current = await capabilities.refetch();
        if (current.isError || !googleAllowedOnPlatform(current.data, Platform.OS, 'google_sign_in')) throw new Error('GOOGLE_DISABLED');
      }
      if (provider === 'X') {
        const current = await xCapabilities.refetch();
        if (current.isError || !xAllowedOnMobile(current.data, Platform.OS)) throw new Error('X_DISABLED');
      }
      const tokens = await signInWithCognito(
        provider === undefined ? { language } : { identityProvider: provider, language }
      );
      await setTokens(tokens);
    } catch (error) {
      setErrorMessage(provider === 'Google' ? copy.unavailable : provider === 'X' ? xCopy.unavailable : userErrorMessage(error, language));
    } finally {
      signingIn.current = false;
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
    <View style={styles.splash}>
      <StatusBar backgroundColor={colors.canvas} barStyle="light-content" />
      <Animated.Image resizeMode="contain" source={heroImage} style={[styles.splashImage, { opacity: splashOpacity }]} />
      <Animated.View style={[styles.splashCopy, { opacity: splashOpacity }]}>
        <Text style={styles.splashTitle}>Lyra Japan</Text>
        <Text style={styles.splashSubtitle}>{t(language, 'lyraSubtitle')}</Text>
      </Animated.View>
    </View>
  ) : (
    <Screen chrome="language" showHeader={false} testID="auth-screen" title="Lyra Japan">
      <View style={styles.authCard}>
        <Image resizeMode="contain" source={heroImage} style={styles.heroImage} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>Lyra</Text>
          <Text style={styles.title}>Lyra Japan</Text>
          <Text style={styles.subtitle}>{t(language, 'lyraSubtitle')}</Text>
        </View>
      </View>
      {isAuthConfigured() ? null : <Notice message={t(language, 'apiSetupRequired')} tone="warning" />}
      {pendingInvitation ? (
        <Notice
          message={t(language, "generated.screens.AuthScreen.sign.in.with.the.same.email.address.that.120eacc0")}
          tone="info"
        />
      ) : null}
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      <PrimaryButton
        disabled={!isAuthConfigured()}
        label={t(language, 'login')}
        loading={loading}
        onPress={() => void signIn()}
        testID="auth-login-button"
      />
      {googleEnabled ? <>
        <PrimaryButton disabled={!isAuthConfigured() || loading} label={copy.google} onPress={() => void signIn('Google')} testID="auth-google-button" variant="secondary" />
        <Text style={styles.subtitle}>{copy.existing}</Text>
      </> : null}
      {xEnabled ? <>
        <PrimaryButton disabled={!isAuthConfigured() || loading} label={xCopy.signIn} onPress={() => void signIn('X')} testID="auth-x-button" variant="secondary" />
        <Text style={styles.subtitle}>{xCopy.confirmation}</Text>
        <Text style={styles.subtitle}>{xCopy.existing}</Text>
      </> : null}
      <View accessibilityLabel={t(language, "generated.screens.AuthScreen.legal.and.support.d411b8e1")} style={styles.legalLinks}>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalLink(legalLinks[language].terms)}
          style={styles.legalLink}
        >
          <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.terms.63800dba")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalLink(legalLinks[language].privacy)}
          style={styles.legalLink}
        >
          <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.privacy.4437e12a")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalLink(legalLinks[language].support)}
          style={styles.legalLink}
        >
          <Text style={styles.legalLinkText}>{t(language, "generated.screens.AuthScreen.support.36269dd8")}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  authCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: 'hidden'
  },
  copy: {
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  heroImage: {
    aspectRatio: heroImageAspectRatio,
    backgroundColor: colors.surfaceAlt,
    height: undefined,
    maxHeight: 220,
    width: '100%'
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
  splash: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg
  },
  splashCopy: {
    alignSelf: 'stretch',
    gap: 6,
    paddingHorizontal: spacing.xs
  },
  splashImage: {
    aspectRatio: heroImageAspectRatio,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: undefined,
    maxHeight: 420,
    opacity: 0.92,
    overflow: 'hidden',
    width: '100%'
  },
  splashSubtitle: {
    ...textStyles.body,
    color: colors.muted
  },
  splashTitle: {
    color: colors.ink,
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 38
  },
  subtitle: {
    ...textStyles.body,
    color: colors.muted
  },
  title: {
    ...textStyles.title
  }
});
