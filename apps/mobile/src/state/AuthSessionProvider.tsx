import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthTokens } from '../domain/auth';
import { LyraMobileApiClient } from '../lib/api';
import { CognitoAuthService } from '../lib/auth';
import { AuthSessionCoordinator } from '../lib/authSessionCoordinator';
import { config } from '../lib/config';
import { createExpoCognitoDependencies } from '../lib/expoCognito';
import { detectUiLanguage, type UiLanguage } from '../lib/i18n';
import {
  clearAuthTokens,
  loadAuthTokens,
  saveAuthTokens,
} from '../lib/storage';

interface AuthSessionContextValue {
  api: LyraMobileApiClient;
  hydrated: boolean;
  language: UiLanguage;
  tokens: AuthTokens | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  const [language] = useState(detectUiLanguage);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const service = useMemo(
    () => new CognitoAuthService(config, createExpoCognitoDependencies(config)),
    [],
  );
  const [coordinator] = useState(
    () => new AuthSessionCoordinator(
      service,
      {
        save: saveAuthTokens,
        clear: clearAuthTokens,
      },
      setTokens,
    ),
  );

  useEffect(() => {
    let active = true;
    const hydrate = async (): Promise<void> => {
      let stored: AuthTokens | null = null;
      try {
        stored = await loadAuthTokens();
      } catch {
        // A platform storage failure must not leave the app on an endless
        // loading screen. Sign-in remains fail-closed until storage recovers.
      }
      if (!active) {
        return;
      }
      coordinator.hydrate(stored);
      setHydrated(true);
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, [coordinator]);

  const signIn = useCallback(async (): Promise<void> => {
    await coordinator.signIn();
  }, [coordinator]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await coordinator.signOut();
    } finally {
      if ((await coordinator.getTokens()) === null) {
        queryClient.clear();
      }
    }
  }, [coordinator, queryClient]);

  const api = useMemo(
    () => new LyraMobileApiClient({
      apiBaseUrl: config.apiBaseUrl,
      auth: coordinator,
    }),
    [coordinator],
  );
  const value = useMemo<AuthSessionContextValue>(
    () => ({ api, hydrated, language, signIn, signOut, tokens }),
    [api, hydrated, language, signIn, signOut, tokens],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (context === null) {
    throw new Error('useAuthSession must be used inside AuthSessionProvider.');
  }
  return context;
}
