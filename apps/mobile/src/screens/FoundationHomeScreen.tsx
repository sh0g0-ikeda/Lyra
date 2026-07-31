import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { colors, radius, spacing } from '../constants/theme';
import type { CurrentSession } from '../lib/api';
import { userErrorMessage } from '../lib/userMessages';
import { useAuthSession } from '../state/AuthSessionProvider';

interface FoundationHomeScreenProps {
  session: CurrentSession;
}

export function FoundationHomeScreen({
  session,
}: FoundationHomeScreenProps): React.JSX.Element {
  const { signOut } = useAuthSession();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignOut = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch (error: unknown) {
      setErrorMessage(userErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen title="Lyra Mobile">
      <Notice message="Mobile基盤との接続を確認できました。編集機能は安全な単位で順次追加します。" />
      <View style={styles.card}>
        <Text style={styles.label}>アカウント</Text>
        <Text style={styles.value}>{session.user.email}</Text>
        <Text style={styles.label}>プラン</Text>
        <Text style={styles.value}>{session.user.plan_code}</Text>
      </View>
      {errorMessage === null ? null : (
        <Notice message={errorMessage} tone="danger" />
      )}
      <PrimaryButton
        label="ログアウト"
        loading={loading}
        onPress={() => void handleSignOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  value: {
    color: colors.ink,
    fontSize: 17,
    marginBottom: spacing.sm,
  },
});
