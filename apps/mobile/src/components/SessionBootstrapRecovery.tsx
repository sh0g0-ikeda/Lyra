import { useEffect, useState } from 'react';
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

const rateLimitWaitSeconds = (error: unknown, nowMs: number): number =>
  error instanceof ApiError &&
  error.status === 429 &&
  error.retryAtMs !== null
    ? Math.max(0, Math.ceil((error.retryAtMs - nowMs) / 1_000))
    : 0;

export function SessionBootstrapRecovery({
  error,
  isFetching,
  isLoading,
  language,
  onRetry,
  onSignInAgain,
  session
}: SessionBootstrapRecoveryProps): React.JSX.Element | null {
  const [rateLimitClockMs, setRateLimitClockMs] = useState(() => Date.now());
  const remainingRateLimitSeconds = rateLimitWaitSeconds(
    error,
    rateLimitClockMs
  );

  useEffect(() => {
    if (remainingRateLimitSeconds <= 0) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setRateLimitClockMs(Date.now());
    }, 1_000);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [remainingRateLimitSeconds]);

  if (isLoading) {
    return <LoadingState label={t(language, 'shared.session.loading')} />;
  }

  if (error !== null) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    const permissionDenied = error instanceof ApiError && error.status === 403;
    const rateLimited = error instanceof ApiError && error.status === 429;
    const connectionOrServerFailure = isConnectionOrServerFailure(error);
    const retryWaitMessage = t(language, 'shared.session.rateLimitWait', {
      seconds: remainingRateLimitSeconds
    });

    return (
      <View style={styles.container}>
        <Notice message={userErrorMessage(error, language)} tone="danger" />
        {rateLimited && remainingRateLimitSeconds > 0 ? (
          <Notice message={retryWaitMessage} tone="warning" />
        ) : null}
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
              disabled={rateLimited && remainingRateLimitSeconds > 0}
              disabledReason={
                rateLimited && remainingRateLimitSeconds > 0
                  ? retryWaitMessage
                  : undefined
              }
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
