import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

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

interface TermsAcceptanceScreenProps {
  language: UiLanguage;
  onAccept: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function TermsAcceptanceScreen({
  language,
  onAccept,
  onSignOut
}: TermsAcceptanceScreenProps): React.JSX.Element {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openLegalLink = async (url: string): Promise<void> => {
    try {
      await Linking.openURL(url);
    } catch {
      setErrorMessage(t(language, 'screen.terms.linkError'));
    }
  };

  const accept = async (): Promise<void> => {
    if (!agreed) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onAccept();
    } catch {
      setErrorMessage(t(language, 'screen.terms.saveError'));
      setSubmitting(false);
    }
  };

  return (
    <Screen
      subtitle={t(language, 'screen.terms.subtitle')}
      testID="terms-acceptance-screen"
      title={t(language, 'screen.terms.title')}
    >
      {errorMessage === null ? null : <Notice message={errorMessage} tone="warning" />}
      <View style={styles.agreementRow}>
        <Switch
          accessibilityLabel={t(language, 'screen.terms.agreement')}
          onValueChange={setAgreed}
          value={agreed}
        />
        <Text style={styles.agreementText}>{t(language, 'screen.terms.agreement')}</Text>
      </View>
      <PrimaryButton
        disabled={!agreed}
        disabledReason={t(language, 'screen.terms.required')}
        label={t(language, 'screen.terms.accept')}
        loading={submitting}
        onPress={() => void accept()}
        testID="terms-accept-button"
      />
      <PrimaryButton
        label={t(language, 'screen.terms.signOut')}
        onPress={() => void onSignOut()}
        variant="ghost"
      />
      <View style={styles.links}>
        <LegalLink label={t(language, 'screen.terms.termsLink')} onPress={() => void openLegalLink(legalLinks[language].terms)} />
        <LegalLink label={t(language, 'screen.terms.privacyLink')} onPress={() => void openLegalLink(legalLinks[language].privacy)} />
        <LegalLink label={t(language, 'screen.terms.supportLink')} onPress={() => void openLegalLink(legalLinks[language].support)} />
      </View>
    </Screen>
  );
}

function LegalLink({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="link" hitSlop={8} onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  agreementRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm
  },
  agreementText: {
    ...textStyles.body,
    color: colors.ink,
    flex: 1
  },
  link: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs
  },
  links: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center'
  },
  linkText: {
    color: colors.accent,
    fontSize: 14,
    textDecorationLine: 'underline'
  }
});
