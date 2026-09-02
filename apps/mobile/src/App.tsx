import { useEffect, useState } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ImageMemoryPressureCoordinator } from '@/components/ImageMemoryPressureCoordinator';
import { LoadingState } from '@/components/LoadingState';
import { Notice } from '@/components/Notice';
import { PushNotificationCoordinator } from '@/components/PushNotificationCoordinator';
import { Screen } from '@/components/Screen';
import { SessionBootstrapRecovery } from '@/components/SessionBootstrapRecovery';
import { AuthScreen } from '@/screens/AuthScreen';
import { InvitationScreen } from '@/screens/InvitationScreen';
import { MainTabs } from '@/navigation/tabs';
import { navigationRef } from '@/navigation/navigationRef';
import type { OrganizationWorkspaceRecord } from '@/domain/types';
import { parseMobileLink } from '@/lib/deepLinks';
import { configValidation } from '@/lib/config';
import { t } from '@/lib/i18n';
import { createMobileQueryClient } from '@/lib/queryClient';
import { sessionQueryKey } from '@/lib/queryKeys';
import {
  clearPendingInvitationToken,
  loadPendingInvitationToken,
  savePendingInvitationToken
} from '@/lib/storage';
import { AppStateProvider, useAppState } from '@/state/appState';
import { DirtyStateProvider } from '@/state/dirtyState';
import { NetworkStatusProvider } from '@/state/networkStatus';

const queryClient = createMobileQueryClient();

function AuthenticatedApp(): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    api,
    hydrated,
    language,
    logout,
    sessionKey,
    setSession,
    tokens,
    updateSelection
  } = useAppState();
  const [pendingInvitationToken, setPendingInvitationToken] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const captureLink = async (rawUrl: string | null): Promise<string | null> => {
      if (rawUrl === null) {
        return null;
      }
      const link = parseMobileLink(rawUrl);
      if (link?.type !== 'invitation') {
        return null;
      }
      await savePendingInvitationToken(link.token);
      if (mounted) {
        setPendingInvitationToken(link.token);
      }
      return link.token;
    };
    void Promise.all([loadPendingInvitationToken(), Linking.getInitialURL()]).then(
      async ([storedToken, initialUrl]) => {
        const initialToken = await captureLink(initialUrl);
        if (mounted && initialToken === null) {
          setPendingInvitationToken(storedToken);
        }
      }
    );
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void captureLink(url);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const sessionQuery = useQuery({
    enabled: hydrated && tokens !== null,
    queryKey: sessionQueryKey(sessionKey),
    queryFn: () => api.getCurrentSession()
  });

  useEffect(() => {
    if (sessionQuery.data !== undefined) {
      setSession(sessionQuery.data);
    }
  }, [sessionQuery.data, setSession]);

  if (!hydrated) {
    return (
      <Screen title="Lyra Mobile">
        <LoadingState label={t(language, 'shared.app.loading')} />
      </Screen>
    );
  }

  if (tokens === null) {
    return <AuthScreen pendingInvitation={pendingInvitationToken !== null} />;
  }

  const retrySessionBootstrap = async (): Promise<void> => {
    const result = await sessionQuery.refetch();
    if (result.data !== undefined) {
      setSession(result.data);
    }
  };

  if (sessionQuery.isLoading || sessionQuery.data === undefined) {
    return (
      <Screen title="Lyra Mobile">
        <SessionBootstrapRecovery
          error={sessionQuery.isError ? sessionQuery.error : null}
          isFetching={sessionQuery.isFetching}
          isLoading={sessionQuery.isLoading}
          language={language}
          onRetry={retrySessionBootstrap}
          onSignInAgain={() => logout({ skipDirtyCheck: true })}
          session={sessionQuery.data}
        />
      </Screen>
    );
  }

  if (pendingInvitationToken !== null) {
    const acceptInvitation = async (
      workspace: OrganizationWorkspaceRecord
    ): Promise<void> => {
      await clearPendingInvitationToken();
      setPendingInvitationToken(null);
      await updateSelection({
        organizationId: workspace.organization.id,
        workId: null,
        chapterId: null,
        episodeId: null,
        pageId: null,
        entityId: null
      });
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionKey) });
    };
    const dismissInvitation = async (): Promise<void> => {
      await clearPendingInvitationToken();
      setPendingInvitationToken(null);
    };
    return (
      <InvitationScreen
        onAccepted={acceptInvitation}
        onDismiss={dismissInvitation}
        onSwitchAccount={logout}
        token={pendingInvitationToken}
      />
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <PushNotificationCoordinator />
      <MainTabs />
    </NavigationContainer>
  );
}

function NetworkAwareAuthenticatedApp(): React.JSX.Element {
  const { language, setLanguage } = useAppState();
  return (
    <NetworkStatusProvider language={language} setLanguage={setLanguage}>
      <AuthenticatedApp />
    </NetworkStatusProvider>
  );
}

export default function App(): React.JSX.Element {
  if (!configValidation.valid) {
    return (
      <ErrorBoundary>
        <SafeAreaProvider>
          <Screen title="Lyra Mobile">
            <Notice
              message={t('ja', 'shared.app.invalidConfiguration')}
              tone="danger"
            />
            <Notice
              message={t('ja', 'shared.app.supportCode', { code: configValidation.supportCode })}
              tone="info"
            />
          </Screen>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ImageMemoryPressureCoordinator />
          <DirtyStateProvider>
            <AppStateProvider>
              <NetworkAwareAuthenticatedApp />
            </AppStateProvider>
          </DirtyStateProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
