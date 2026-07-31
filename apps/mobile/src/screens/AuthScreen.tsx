import { useState } from 'react';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { userErrorMessage } from '../lib/userMessages';
import { useAuthSession } from '../state/AuthSessionProvider';

export function AuthScreen(): React.JSX.Element {
  const { signIn } = useAuthSession();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await signIn();
    } catch (error: unknown) {
      setErrorMessage(userErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen title="Lyra">
      <Notice message="安全なログイン画面を開きます。認証情報は端末の保護領域へ保存されます。" />
      {errorMessage === null ? null : (
        <Notice message={errorMessage} tone="danger" />
      )}
      <PrimaryButton
        label="ログイン"
        loading={loading}
        onPress={() => void handleSignIn()}
      />
    </Screen>
  );
}
