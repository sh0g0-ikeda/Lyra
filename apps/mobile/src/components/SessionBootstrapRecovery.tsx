import { StyleSheet, View } from 'react-native';

import type { CurrentSessionRecord, UiLanguage } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { userErrorMessage } from '@/lib/userMessages';
import { LoadingState } from '@/components/LoadingState';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';

interface SessionBootstrapRecoveryProps {
  error: unknown | null;
  isFetching: boolean;
  isLoading: boolean;
  language: UiLanguage;
  onRetry: () => Promise<void>;
  onSignInAgain: () => Promise<void>;
  session: CurrentSessionRecord | undefined;
}

const isConnectionOrServerFailure = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof ApiError &&
    (error.status === 0 || error.status >= 500 || error.code === 'NETWORK_OFFLINE' || error.code === 'REQUEST_TIMEOUT'));

export function SessionBootstrapRecovery({
  error,
  isFetching,
  isLoading,
  language,
  onRetry,
  onSignInAgain,
  session
}: SessionBootstrapRecoveryProps): React.JSX.Element | null {
  if (isLoading) {
    return <LoadingState label={t(language, 'shared.session.loading')} />;
  }

  if (error !== null) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    const permissionDenied = error instanceof ApiError && error.status === 403;
    const connectionOrServerFailure = isConnectionOrServerFailure(error);

    return (
      <View style={styles.container}>
        <Notice message={userErrorMessage(error, language)} tone="danger" />
        {connectionOrServerFailure ? (
          <Notice
            message={t(language, 'shared.session.connectionFailed')}
            tone="warning"
          />
        ) : null}
        {permissionDenied ? (
          <Notice
            message={t(language, 'shared.session.permissionChanged')}
            tone="info"
          />
        ) : null}
        {unauthorized ? (
          <PrimaryButton
            label={t(language, 'shared.session.signInAgain')}
            onPress={() => void onSignInAgain()}
            variant="secondary"
          />
        ) : (
          <>
            <PrimaryButton
              label={t(language, 'shared.session.retry')}
              loading={isFetching}
              onPress={() => void onRetry()}
            />
            <PrimaryButton
              label={t(language, 'shared.session.logout')}
              onPress={() => void onSignInAgain()}
              variant="ghost"
            />
          </>
        )}
      </View>
    );
  }

  if (session === undefined) {
    return (
      <View style={styles.container}>
        <Notice
          message={t(language, 'shared.session.empty')}
          tone="warning"
        />
        <PrimaryButton
          label={t(language, 'shared.session.retry')}
          loading={isFetching}
          onPress={() => void onRetry()}
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    gap: 12
  }
});
