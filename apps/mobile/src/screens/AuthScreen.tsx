import { useState } from 'react';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { t } from '../lib/i18n';
import { userErrorMessage } from '../lib/userMessages';
import { useAuthSession } from '../state/AuthSessionProvider';

export function AuthScreen(): React.JSX.Element {
  const { language, signIn } = useAuthSession();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await signIn();
    } catch (error: unknown) {
      setErrorMessage(userErrorMessage(error, language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen title="Lyra">
      <Notice message={t(language, 'authNotice')} />
      {errorMessage === null ? null : (
        <Notice message={errorMessage} tone="danger" />
      )}
      <PrimaryButton
        label={t(language, 'login')}
        loading={loading}
        onPress={() => void handleSignIn()}
      />
    </Screen>
  );
}
