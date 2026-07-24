import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const refreshedSession = {
    organizations: [],
    personal_credits: null,
    user: { display_name: null, email: 'user@example.test', id: 'user-1', plan_code: 'free' }
  };
  return {
    refetch: vi.fn().mockResolvedValue({ data: refreshedSession }),
    setSession: vi.fn(),
    refreshedSession,
    useQuery: vi.fn()
  };
});

vi.mock('@tanstack/react-query', () => {
  class QueryClient {}
  return {
    QueryClient,
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
    useQuery: mocks.useQuery,
    useQueryClient: () => ({ invalidateQueries: vi.fn() })
  };
});

vi.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => false,
    navigate: vi.fn()
  }),
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('react-native', () => ({
  Linking: {
    addEventListener: () => ({ remove: vi.fn() }),
    getInitialURL: vi.fn().mockResolvedValue(null)
  }
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('@/components/ImageMemoryPressureCoordinator', () => ({
  ImageMemoryPressureCoordinator: () => null
}));

vi.mock('@/components/LoadingState', () => ({
  LoadingState: () => React.createElement('loading')
}));

vi.mock('@/components/Notice', () => ({
  Notice: () => React.createElement('notice')
}));

vi.mock('@/components/PushNotificationCoordinator', () => ({
  PushNotificationCoordinator: () => null
}));

vi.mock('@/components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => React.createElement('screen', null, children)
}));

vi.mock('@/components/SessionBootstrapRecovery', () => ({
  SessionBootstrapRecovery: ({ onRetry }: { onRetry: () => Promise<void> }) =>
    React.createElement('button', { onClick: onRetry }, 'Retry')
}));

vi.mock('@/components/UnsavedChangesResolutionDialog', () => ({
  UnsavedChangesResolutionDialog: () => null
}));

vi.mock('@/screens/AuthScreen', () => ({ AuthScreen: () => React.createElement('auth') }));
vi.mock('@/screens/InvitationScreen', () => ({ InvitationScreen: () => React.createElement('invitation') }));
vi.mock('@/navigation/tabs', () => ({ MainTabs: () => React.createElement('tabs') }));
vi.mock('@/lib/config', () => ({ configValidation: { valid: true } }));
vi.mock('@/lib/deepLinks', () => ({ parseMobileLink: () => null }));
vi.mock('@/lib/storage', () => ({
  clearPendingInvitationToken: vi.fn(),
  loadPendingInvitationToken: vi.fn().mockResolvedValue(null),
  savePendingInvitationToken: vi.fn()
}));
vi.mock('@/lib/queryKeys', () => ({ sessionQueryKey: () => ['session'] }));
vi.mock('@/lib/requestPolicy', () => ({ apiRetryDelay: () => 0, shouldRetryApiQuery: () => false }));
vi.mock('@/state/networkStatus', () => ({
  NetworkStatusProvider: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock('@/state/appState', () => ({
  AppStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppState: () => ({
    api: { getCurrentSession: vi.fn() },
    hydrated: true,
    language: 'en',
    logout: vi.fn().mockResolvedValue(undefined),
    sessionKey: 'session-1',
    setSession: mocks.setSession,
    tokens: { accessToken: null, expiresAt: null, idToken: 'token', refreshToken: 'refresh', tokenType: null },
    updateSelection: vi.fn()
  })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('session bootstrap retry', () => {
  it('Retry は /api/me query を再取得し、成功した session を再設定して workspace hydration を起動する', async () => {
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: new ApiError('safe error', 503, 'SERVICE_UNAVAILABLE'),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetch
    });

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<App />);
    });
    await act(async () => {
      await tree!.root.findByType('button').props.onClick();
    });

    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.setSession).not.toHaveBeenCalledWith(null);
    expect(mocks.setSession).toHaveBeenCalledWith(mocks.refreshedSession);
  });
});
