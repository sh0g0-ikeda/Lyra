import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppState as NativeAppState } from 'react-native';

import type {
  AuthTokens,
  CurrentSessionRecord,
  PersistedWorkspaceSelection,
  UiLanguage
} from '@/domain/types';
import {
  hasWorkspaceCapability,
  type OrganizationCapability
} from '@/domain/capabilities';
import { hasSelectionChange } from '@/domain/dirtyStatePolicy';
import { LyraMobileApiClient } from '@/lib/api';
import { AuthError, refreshAuthTokens, signOutFromCognito } from '@/lib/auth';
import { clearAuthenticatedImageCache } from '@/lib/authenticatedImageCache';
import { config } from '@/lib/config';
import { defaultSelection } from '@/lib/queryKeys';
import { getDeviceUiLanguage } from '@/lib/deviceLanguage';
import {
  loadAuthTokens,
  loadActiveOrganizationId,
  loadLanguage,
  loadSelection,
  loadTrackedJobIds,
  clearAuthTokens,
  saveAuthTokens,
  saveActiveOrganizationId,
  saveLanguage,
  saveSelection,
  saveTrackedJobIds
} from '@/lib/storage';
import { useDirtyState } from '@/state/dirtyState';
import {
  unregisterNativePushNotifications,
  unregisterPushNotifications
} from '@/lib/pushNotifications';

interface LogoutOptions {
  skipDirtyCheck?: boolean;
}

interface SelectionUpdateOptions {
  skipDirtyCheck?: boolean;
}

interface AppStateContextValue {
  api: LyraMobileApiClient;
  hydrated: boolean;
  language: UiLanguage;
  tokens: AuthTokens | null;
  session: CurrentSessionRecord | null;
  selection: PersistedWorkspaceSelection;
  trackedJobIds: string[];
  sessionKey: string;
  hasCapability: (capability: OrganizationCapability) => boolean;
  refreshIdToken: () => Promise<string | null>;
  setLanguage: (language: UiLanguage) => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  setSession: (session: CurrentSessionRecord | null) => void;
  trackJob: (jobId: string) => Promise<void>;
  updateSelection: (
    selection: Partial<PersistedWorkspaceSelection>,
    options?: SelectionUpdateOptions
  ) => Promise<boolean>;
  logout: (options?: LogoutOptions) => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);
const authRefreshSkewMs = 120_000;

const tokenSessionKey = (tokens: AuthTokens | null): string => {
  if (tokens === null) {
    return 'signed-out';
  }
  return `token-${tokens.idToken.slice(Math.max(0, tokens.idToken.length - 16))}`;
};

export function AppStateProvider({ children }: PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const { hasDirtyEditors, resolveDirtyEditors, saveDirtyEditors } = useDirtyState();
  const [hydrated, setHydrated] = useState(false);
  const [tokens, setTokensState] = useState<AuthTokens | null>(null);
  const [languageState, setLanguageState] = useState<UiLanguage>(getDeviceUiLanguage);
  const [session, setSession] = useState<CurrentSessionRecord | null>(null);
  const [selection, setSelection] = useState<PersistedWorkspaceSelection>(defaultSelection);
  const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);
  const selectionRef = useRef<PersistedWorkspaceSelection>(defaultSelection);
  const trackedJobIdsRef = useRef<string[]>([]);
  const tokensRef = useRef<AuthTokens | null>(null);
  const authGenerationRef = useRef(0);
  const backgroundResolutionRequestedRef = useRef(false);
  const followsDeviceLanguageRef = useRef(true);

  const clearLocalAuthentication = useCallback(async (
    options?: { skipNativePushUnregister?: boolean }
  ): Promise<void> => {
    authGenerationRef.current += 1;
    tokensRef.current = null;
    queryClient.clear();
    setTokensState(null);
    setSession(null);
    selectionRef.current = defaultSelection;
    trackedJobIdsRef.current = [];
    setSelection(defaultSelection);
    setTrackedJobIds([]);
    await Promise.all([
      clearAuthTokens(),
      clearAuthenticatedImageCache(),
      options?.skipNativePushUnregister
        ? Promise.resolve()
        : unregisterNativePushNotifications()
    ]);
  }, [queryClient]);

  const refreshAndPersistTokens = useCallback(async (): Promise<string | null> => {
    const currentTokens = tokensRef.current;
    if (currentTokens === null || currentTokens.refreshToken === null) {
      return null;
    }
    const generation = authGenerationRef.current;
    try {
      const refreshedTokens = await refreshAuthTokens(currentTokens);
      if (generation !== authGenerationRef.current || tokensRef.current === null) {
        return null;
      }
      tokensRef.current = refreshedTokens;
      await saveAuthTokens(refreshedTokens);
      if (generation !== authGenerationRef.current || tokensRef.current === null) {
        await clearAuthTokens();
        return null;
      }
      setTokensState(refreshedTokens);
      return refreshedTokens.idToken;
    } catch (error) {
      if (error instanceof AuthError && error.fatal) {
        await clearLocalAuthentication();
      }
      throw error;
    }
  }, [clearLocalAuthentication]);

  useEffect(() => {
    let mounted = true;
    const hydrate = async (): Promise<void> => {
      const [storedTokens, storedLanguage] = await Promise.all([loadAuthTokens(), loadLanguage()]);
      let usableTokens = storedTokens;
      if (
        storedTokens !== null &&
        storedTokens.expiresAt !== null &&
        storedTokens.expiresAt <= Date.now() + authRefreshSkewMs
      ) {
        try {
          usableTokens = await refreshAuthTokens(storedTokens);
          await saveAuthTokens(usableTokens);
        } catch {
          usableTokens = null;
          await clearAuthTokens();
        }
      }
      if (!mounted) {
        return;
      }
      tokensRef.current = usableTokens;
      setTokensState(usableTokens);
      followsDeviceLanguageRef.current = storedLanguage === null;
      setLanguageState(storedLanguage ?? getDeviceUiLanguage());
      setHydrated(true);
    };
    void hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (tokens === null || tokens.expiresAt === null || tokens.refreshToken === null) {
      return;
    }
    const refresh = async (): Promise<void> => {
      try {
        await refreshAndPersistTokens();
      } catch (error) {
        if (error instanceof AuthError && error.fatal) {
          return;
        }
      }
    };
    const delayMs = Math.max(0, tokens.expiresAt - Date.now() - authRefreshSkewMs);
    const timeoutId = setTimeout(() => {
      void refresh();
    }, delayMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [refreshAndPersistTokens, tokens]);

  useEffect(() => {
    let mounted = true;
    const hydrateSelection = async (): Promise<void> => {
      if (session === null) {
        selectionRef.current = defaultSelection;
        trackedJobIdsRef.current = [];
        setSelection(defaultSelection);
        setTrackedJobIds([]);
        return;
      }
      const storedOrganizationId = config.organizationFeaturesEnabled
        ? await loadActiveOrganizationId(session.user.id)
        : null;
      const organizationId =
        storedOrganizationId !== null &&
        session.organizations.some(
          (organization) =>
            organization.id === storedOrganizationId &&
            organization.membership_status === 'active'
        )
          ? storedOrganizationId
          : null;
      const [storedSelection, storedJobIds] = await Promise.all([
        loadSelection(session.user.id, organizationId),
        loadTrackedJobIds(session.user.id)
      ]);
      if (mounted) {
        selectionRef.current = storedSelection;
        trackedJobIdsRef.current = storedJobIds;
        setSelection(storedSelection);
        setTrackedJobIds(storedJobIds);
      }
    };
    void hydrateSelection();
    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (tokens === null || tokens.expiresAt === null || tokens.refreshToken === null) {
      return;
    }
    const subscription = NativeAppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || tokens.expiresAt === null || tokens.expiresAt > Date.now() + authRefreshSkewMs) {
        return;
      }
      void refreshAndPersistTokens()
        .then(async (refreshedToken) => {
          if (refreshedToken !== null) {
            await queryClient.invalidateQueries();
          }
        })
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, [queryClient, refreshAndPersistTokens, tokens]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        backgroundResolutionRequestedRef.current = false;
        return;
      }
      if (!hasDirtyEditors || backgroundResolutionRequestedRef.current) {
        return;
      }
      backgroundResolutionRequestedRef.current = true;
      void saveDirtyEditors();
    });
    return () => subscription.remove();
  }, [hasDirtyEditors, saveDirtyEditors]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && followsDeviceLanguageRef.current) {
        setLanguageState(getDeviceUiLanguage());
      }
    });
    return () => subscription.remove();
  }, []);

  const api = useMemo(
    () =>
      new LyraMobileApiClient(
        () => tokens?.idToken ?? null,
        // The client stores this callback and invokes it only after a request receives 401.
        // eslint-disable-next-line react-hooks/refs
        refreshAndPersistTokens
      ),
    [refreshAndPersistTokens, tokens]
  );

  const sessionKey = session?.user.id ?? tokenSessionKey(tokens);
  const workspaceRole =
    selection.organizationId === null
      ? null
      : session?.organizations.find(
          (organization) => organization.id === selection.organizationId
        )?.role ?? null;
  const hasCapability = useCallback(
    (capability: OrganizationCapability): boolean =>
      hasWorkspaceCapability(selection.organizationId, workspaceRole, capability),
    [selection.organizationId, workspaceRole]
  );

  const setLanguage = useCallback(async (language: UiLanguage): Promise<void> => {
    followsDeviceLanguageRef.current = false;
    setLanguageState(language);
    await saveLanguage(language);
  }, []);

  const setTokens = useCallback(async (newTokens: AuthTokens): Promise<void> => {
    authGenerationRef.current += 1;
    tokensRef.current = newTokens;
    setTokensState(newTokens);
    await saveAuthTokens(newTokens);
  }, []);

  const updateSelection = useCallback(
    async (
      nextSelection: Partial<PersistedWorkspaceSelection>,
      options?: SelectionUpdateOptions
    ): Promise<boolean> => {
      const previousOrganizationId = selectionRef.current.organizationId;
      const requestedOrganizationId = config.organizationFeaturesEnabled && Object.prototype.hasOwnProperty.call(nextSelection, 'organizationId')
        ? nextSelection.organizationId ?? null
        : config.organizationFeaturesEnabled
          ? previousOrganizationId
          : null;
      const resetStaleOrganizationSelection =
        !config.organizationFeaturesEnabled && previousOrganizationId !== null;
      const effectiveSelectionPatch: Partial<PersistedWorkspaceSelection> =
        resetStaleOrganizationSelection
          ? {
              ...defaultSelection,
              ...nextSelection,
              organizationId: null
            }
          : {
              ...nextSelection,
              organizationId: requestedOrganizationId
            };
      if (!hasSelectionChange(selectionRef.current, effectiveSelectionPatch)) {
        return true;
      }
      if (!options?.skipDirtyCheck && !(await resolveDirtyEditors(languageState))) {
        return false;
      }
      let baseSelection = selectionRef.current;
      if (session !== null && requestedOrganizationId !== previousOrganizationId) {
        await clearAuthenticatedImageCache();
        baseSelection = await loadSelection(session.user.id, requestedOrganizationId);
        await saveActiveOrganizationId(session.user.id, requestedOrganizationId);
      }
      const merged = {
        ...baseSelection,
        ...nextSelection,
        ...(resetStaleOrganizationSelection
          ? {
              workId: null,
              chapterId: null,
              episodeId: null,
              pageId: null,
              entityId: null
            }
          : {}),
        organizationId: requestedOrganizationId
      };
      selectionRef.current = merged;
      setSelection(merged);
      if (session !== null) {
        await saveSelection(session.user.id, requestedOrganizationId, merged);
      }
      return true;
    },
    [languageState, resolveDirtyEditors, session]
  );

  const trackJob = useCallback(
    async (jobId: string): Promise<void> => {
      const normalizedJobId = jobId.trim();
      if (normalizedJobId.length === 0) {
        return;
      }
      const nextJobIds = [normalizedJobId, ...trackedJobIdsRef.current.filter((currentJobId) => currentJobId !== normalizedJobId)].slice(0, 10);
      trackedJobIdsRef.current = nextJobIds;
      setTrackedJobIds(nextJobIds);
      if (session !== null) {
        await saveTrackedJobIds(session.user.id, nextJobIds);
      }
    },
    [session]
  );

  const logout = useCallback(async (options?: LogoutOptions): Promise<void> => {
    if (!options?.skipDirtyCheck && !(await resolveDirtyEditors(languageState))) {
      return;
    }
    await unregisterPushNotifications(api);
    await clearLocalAuthentication({ skipNativePushUnregister: true });
    await signOutFromCognito();
  }, [api, clearLocalAuthentication, languageState, resolveDirtyEditors]);

  const value = useMemo<AppStateContextValue>(
    () => ({
      api,
      hydrated,
      hasCapability,
      language: languageState,
      refreshIdToken: refreshAndPersistTokens,
      tokens,
      session,
      selection,
      trackedJobIds,
      sessionKey,
      setLanguage,
      setTokens,
      setSession,
      trackJob,
      updateSelection,
      logout
    }),
    [
      api,
      hydrated,
      hasCapability,
      languageState,
      logout,
      refreshAndPersistTokens,
      selection,
      session,
      sessionKey,
      setLanguage,
      setTokens,
      trackJob,
      trackedJobIds,
      tokens,
      updateSelection
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export const useAppState = (): AppStateContextValue => {
  const value = useContext(AppStateContext);
  if (value === null) {
    throw new Error('useAppState must be used inside AppStateProvider');
  }
  return value;
};
