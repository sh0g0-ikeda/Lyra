import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '../components/LoadingState';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { configValidation } from '../lib/config';
import { t } from '../lib/i18n';
import { resolveFoundationRoute } from './foundationRoute';
import { AuthScreen } from '../screens/AuthScreen';
import { FoundationHomeScreen } from '../screens/FoundationHomeScreen';
import { useAuthSession } from '../state/AuthSessionProvider';

export function FoundationNavigator(): React.JSX.Element {
  const { api, hydrated, language, tokens } = useAuthSession();
  const sessionQuery = useQuery({
    enabled: hydrated && tokens !== null && configValidation.valid,
    queryKey: ['current-session'],
    queryFn: () => api.getCurrentSession(),
  });
  const route = resolveFoundationRoute({
    configValid: configValidation.valid,
    hydrated,
    authenticated: tokens !== null,
    sessionReady: sessionQuery.data !== undefined,
    sessionFailed: sessionQuery.isError,
  });

  switch (route) {
    case 'configuration-error':
      return (
        <Screen title="Lyra Mobile">
          <Notice
            message={t(language, 'configurationError')}
            tone="danger"
          />
          <Notice
            message={t(language, 'supportCode', {
              code: configValidation.supportCode,
            })}
          />
        </Screen>
      );
    case 'booting':
      return (
        <Screen title="Lyra Mobile">
          <LoadingState label={t(language, 'booting')} />
        </Screen>
      );
    case 'sign-in':
      return <AuthScreen />;
    case 'loading-session':
      return (
        <Screen title="Lyra Mobile">
          <LoadingState label={t(language, 'sessionLoading')} />
        </Screen>
      );
    case 'session-error':
      return (
        <Screen title="Lyra Mobile">
          <Notice
            message={t(language, 'sessionError')}
            tone="danger"
          />
          <PrimaryButton
            label={t(language, 'retry')}
            loading={sessionQuery.isFetching}
            onPress={() => {
              void sessionQuery.refetch();
            }}
          />
        </Screen>
      );
    case 'home':
      if (sessionQuery.data === undefined) {
        return (
          <Screen title="Lyra Mobile">
            <LoadingState label={t(language, 'sessionLoading')} />
          </Screen>
        );
      }
      return (
        <FoundationHomeScreen
          onSessionRefresh={async () => {
            await sessionQuery.refetch();
          }}
          session={sessionQuery.data}
        />
      );
  }
}
