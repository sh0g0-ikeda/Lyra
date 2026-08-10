import * as SecureStore from 'expo-secure-store';

import type { AuthTokens, PersistedWorkspaceSelection, UiLanguage } from '@/domain/types';
import { defaultSelection } from '@/lib/queryKeys';
import {
  activeOrganizationStorageKey,
  selectionStorageKey,
  storyHierarchyExpansionStorageKey
} from '@/lib/storageKeys';

const authTokensKey = 'lyra.mobile.auth.tokens';
const languageKey = 'lyra.mobile.ui.language';
const pendingInvitationTokenKey = 'lyra.mobile.pending-invitation-token';
const pushInstallationIdKey = 'lyra.mobile.push.installation-id';
const sectionCollapsedKey = (key: string): string => `lyra.mobile.section.${key}`;
const trackedJobIdsKey = (userId: string): string => `lyra.mobile.tracked-jobs.${userId}`;

const readJson = async <T>(key: string): Promise<T | null> => {
  const raw = await readItem(key);
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }
};

const readItem = async (key: string): Promise<string | null> => {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.error(`SecureStore read failed for ${key}`, error);
    return null;
  }
};

const writeJson = async (key: string, value: unknown): Promise<void> => {
  await SecureStore.setItemAsync(key, JSON.stringify(value));
};

export const loadAuthTokens = (): Promise<AuthTokens | null> => readJson<AuthTokens>(authTokensKey);
export const saveAuthTokens = (tokens: AuthTokens): Promise<void> => writeJson(authTokensKey, tokens);
export const clearAuthTokens = (): Promise<void> => SecureStore.deleteItemAsync(authTokensKey);

export const loadLanguage = async (): Promise<UiLanguage | null> => {
  const value = await readItem(languageKey);
  return value === 'ja' || value === 'en' ? value : null;
};

export const saveLanguage = (language: UiLanguage): Promise<void> => SecureStore.setItemAsync(languageKey, language);

export const loadPendingInvitationToken = (): Promise<string | null> => readItem(pendingInvitationTokenKey);
export const savePendingInvitationToken = (token: string): Promise<void> =>
  SecureStore.setItemAsync(pendingInvitationTokenKey, token);
export const clearPendingInvitationToken = (): Promise<void> =>
  SecureStore.deleteItemAsync(pendingInvitationTokenKey);

export const loadPushInstallationId = (): Promise<string | null> =>
  readItem(pushInstallationIdKey);
export const savePushInstallationId = (installationId: string): Promise<void> =>
  SecureStore.setItemAsync(pushInstallationIdKey, installationId);

export const loadSelection = async (
  userId: string,
  organizationId: string | null
): Promise<PersistedWorkspaceSelection> => {
  const selection = await readJson<Partial<PersistedWorkspaceSelection>>(
    selectionStorageKey(userId, organizationId)
  );
  return {
    ...defaultSelection,
    ...selection,
    organizationId
  };
};

export const saveSelection = (
  userId: string,
  organizationId: string | null,
  selection: PersistedWorkspaceSelection
): Promise<void> =>
  writeJson(selectionStorageKey(userId, organizationId), {
    ...selection,
    organizationId
  });

export const loadActiveOrganizationId = async (userId: string): Promise<string | null> => {
  const value = await readItem(activeOrganizationStorageKey(userId));
  return value === null || value === 'personal' ? null : value;
};

export const saveActiveOrganizationId = (userId: string, organizationId: string | null): Promise<void> =>
  SecureStore.setItemAsync(activeOrganizationStorageKey(userId), organizationId ?? 'personal');

export const loadSectionCollapsed = async (key: string): Promise<boolean | null> => {
  const value = await readItem(sectionCollapsedKey(key));
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
};

export const saveSectionCollapsed = (key: string, collapsed: boolean): Promise<void> =>
  SecureStore.setItemAsync(sectionCollapsedKey(key), collapsed ? 'true' : 'false');

export const loadTrackedJobIds = async (userId: string): Promise<string[]> => {
  const jobIds = await readJson<string[]>(trackedJobIdsKey(userId));
  return Array.isArray(jobIds) ? jobIds.filter((jobId) => typeof jobId === 'string') : [];
};

export const saveTrackedJobIds = (userId: string, jobIds: string[]): Promise<void> =>
  writeJson(trackedJobIdsKey(userId), jobIds);

export interface StoryHierarchyExpansionState {
  workIds: string[];
  chapterIds: string[];
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

export const loadStoryHierarchyExpansion = async (
  userId: string,
  organizationId: string | null
): Promise<StoryHierarchyExpansionState> => {
  const stored = await readJson<Partial<StoryHierarchyExpansionState>>(
    storyHierarchyExpansionStorageKey(userId, organizationId)
  );
  return {
    workIds: stringArray(stored?.workIds),
    chapterIds: stringArray(stored?.chapterIds)
  };
};

export const saveStoryHierarchyExpansion = (
  userId: string,
  organizationId: string | null,
  state: StoryHierarchyExpansionState
): Promise<void> =>
  writeJson(storyHierarchyExpansionStorageKey(userId, organizationId), {
    workIds: [...new Set(state.workIds)],
    chapterIds: [...new Set(state.chapterIds)]
  });
