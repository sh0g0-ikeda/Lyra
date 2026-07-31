import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '../components/LoadingState';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { configValidation } from '../lib/config';
import { resolveFoundationRoute } from './foundationRoute';
import { AuthScreen } from '../screens/AuthScreen';
import { FoundationHomeScreen } from '../screens/FoundationHomeScreen';
import { useAuthSession } from '../state/AuthSessionProvider';

export function FoundationNavigator(): React.JSX.Element {
  const { api, hydrated, tokens } = useAuthSession();
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
            message="アプリの接続設定が不足しています。配布元へお問い合わせください。"
            tone="danger"
          />
          <Notice message={`サポートコード: ${configValidation.supportCode}`} />
        </Screen>
      );
    case 'booting':
      return (
        <Screen title="Lyra Mobile">
          <LoadingState label="安全な保存領域を確認しています…" />
        </Screen>
      );
    case 'sign-in':
      return <AuthScreen />;
    case 'loading-session':
      return (
        <Screen title="Lyra Mobile">
          <LoadingState label="アカウント情報を確認しています…" />
        </Screen>
      );
    case 'session-error':
      return (
        <Screen title="Lyra Mobile">
          <Notice
            message="アカウント情報を確認できませんでした。入力内容や既存データは変更されていません。"
            tone="danger"
          />
          <PrimaryButton
            label="再試行"
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
            <LoadingState label="アカウント情報を確認しています…" />
          </Screen>
        );
      }
      return <FoundationHomeScreen session={sessionQuery.data} />;
  }
}
