import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import {
  AuthSessionProvider,
  useAuthSession,
} from '../src/state/AuthSessionProvider';

const {
  clearAuthTokens,
  clearPrivateImageMemoryCache,
  fatalRefresh,
  loadAuthTokens,
  remoteSignOut,
  saveAuthTokens,
} = vi.hoisted(() => ({
  clearAuthTokens: vi.fn(),
  clearPrivateImageMemoryCache: vi.fn(),
  fatalRefresh: { enabled: false },
  loadAuthTokens: vi.fn(),
  remoteSignOut: vi.fn(),
  saveAuthTokens: vi.fn(),
}));

vi.mock('../src/lib/privateImageCache', () => ({
  clearPrivateImageMemoryCache,
}));

vi.mock('../src/lib/storage', () => ({
  clearAuthTokens,
  loadAuthTokens,
  saveAuthTokens,
}));

vi.mock('../src/lib/expoCognito', () => ({
  createExpoCognitoDependencies: () => ({}),
}));

vi.mock('../src/lib/auth', () => {
  class FakeAuthError extends Error {
    public constructor(
      public readonly code: string,
      message: string,
      public readonly fatal: boolean,
    ) {
      super(message);
    }
  }

  return {
    AuthError: FakeAuthError,
    CognitoAuthService: class FakeCognitoAuthService {
      public async signIn(): Promise<AuthTokens> {
        return tokens;
      }

      public async refresh(): Promise<AuthTokens> {
        if (fatalRefresh.enabled) {
          throw new FakeAuthError('REFRESH_REJECTED', 'expired', true);
        }
        return tokens;
      }

      public async signOut(): Promise<void> {
        await remoteSignOut();
      }
    },
  };
});

const tokens: AuthTokens = {
  accessToken: null,
  expiresAt: 1_800_000_000_000,
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
};

describe('AuthSessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fatalRefresh.enabled = false;
    loadAuthTokens.mockResolvedValue(tokens);
    clearPrivateImageMemoryCache.mockResolvedValue(undefined);
    remoteSignOut.mockResolvedValue(undefined);
  });

  it('logout成功後にqueryとprivate image memory cacheを消去する', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private-reference'], { visible: true });
    let signOut: (() => Promise<void>) | undefined;

    function Consumer(): React.JSX.Element {
      const session = useAuthSession();
      signOut = session.signOut;
      return React.createElement('session-state', {
        hydrated: session.hydrated,
        signedIn: session.tokens !== null,
      });
    }

    await act(async () => {
      create(
        <QueryClientProvider client={queryClient}>
          <AuthSessionProvider>
            <Consumer />
          </AuthSessionProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await signOut?.();
    });

    expect(remoteSignOut).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['private-reference'])).toBeUndefined();
    expect(clearPrivateImageMemoryCache).toHaveBeenCalledOnce();
  });

  it('画像認証の致命的refresh失敗でもqueryとprivate image cacheを消去する', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private-reference'], { visible: true });
    let refreshImageAuthorization: (() => Promise<string>) | undefined;

    function Consumer(): React.JSX.Element {
      const session = useAuthSession();
      refreshImageAuthorization = () => session.api.refreshImageAuthorizationHeader();
      return React.createElement('session-state', {
        hydrated: session.hydrated,
        signedIn: session.tokens !== null,
      });
    }

    await act(async () => {
      create(
        <QueryClientProvider client={queryClient}>
          <AuthSessionProvider>
            <Consumer />
          </AuthSessionProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    fatalRefresh.enabled = true;
    expect(refreshImageAuthorization).toBeDefined();
    await act(async () => {
      await expect(refreshImageAuthorization!()).rejects.toMatchObject({
        code: 'REFRESH_REJECTED',
      });
      await Promise.resolve();
    });

    expect(clearAuthTokens).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['private-reference'])).toBeUndefined();
    expect(clearPrivateImageMemoryCache).toHaveBeenCalledOnce();
  });
});
