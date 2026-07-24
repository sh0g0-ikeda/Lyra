import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppStateProvider,
  useAppState
} from '@/state/appState';

const mocks = vi.hoisted(() => ({
  appStateListeners: [] as ((state: string) => void)[],
  clearAuthenticatedImageCache: vi.fn().mockResolvedValue(undefined),
  clearAuthTokens: vi.fn().mockResolvedValue(undefined),
  hasDirtyEditors: true,
  queryClear: vi.fn(),
  queryInvalidate: vi.fn().mockResolvedValue(undefined),
  resolveDirtyEditors: vi.fn<() => Promise<boolean>>(),
  saveDirtyEditors: vi.fn<() => Promise<boolean>>(),
  saveActiveOrganizationId: vi.fn().mockResolvedValue(undefined),
  saveSelection: vi.fn().mockResolvedValue(undefined),
  signOutFromCognito: vi.fn().mockResolvedValue(undefined),
  unregisterPushNotifications: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    clear: mocks.queryClear,
    invalidateQueries: mocks.queryInvalidate
  })
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (
      _event: string,
      listener: (state: string) => void
    ): { remove: () => void } => {
      mocks.appStateListeners.push(listener);
      return {
        remove: () => {
          const index = mocks.appStateListeners.indexOf(listener);
          if (index >= 0) {
            mocks.appStateListeners.splice(index, 1);
          }
        }
      };
    }
  }
}));

vi.mock('@/lib/api', () => ({
  LyraMobileApiClient: class LyraMobileApiClient {}
}));

vi.mock('@/lib/auth', () => ({
  AuthError: class AuthError extends Error {
    public fatal = false;
  },
  refreshAuthTokens: vi.fn(),
  signOutFromCognito: mocks.signOutFromCognito
}));

vi.mock('@/lib/authenticatedImageCache', () => ({
  clearAuthenticatedImageCache: mocks.clearAuthenticatedImageCache
}));

vi.mock('@/lib/config', () => ({
  config: {
    organizationFeaturesEnabled: true
  }
}));

vi.mock('@/lib/pushNotifications', () => ({
  unregisterNativePushNotifications: vi.fn().mockResolvedValue(undefined),
  unregisterPushNotifications: mocks.unregisterPushNotifications
}));

vi.mock('@/lib/storage', () => ({
  clearAuthTokens: mocks.clearAuthTokens,
  loadActiveOrganizationId: vi.fn().mockResolvedValue(null),
  loadAuthTokens: vi.fn().mockResolvedValue(null),
  loadLanguage: vi.fn().mockResolvedValue('ja'),
  loadSelection: vi.fn().mockResolvedValue({
    organizationId: null,
    workId: null,
    chapterId: null,
    episodeId: null,
    pageId: null,
    entityId: null
  }),
  loadTrackedJobIds: vi.fn().mockResolvedValue([]),
  saveActiveOrganizationId: mocks.saveActiveOrganizationId,
  saveAuthTokens: vi.fn().mockResolvedValue(undefined),
  saveLanguage: vi.fn().mockResolvedValue(undefined),
  saveSelection: mocks.saveSelection,
  saveTrackedJobIds: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@/state/dirtyState', () => ({
  useDirtyState: () => ({
    hasDirtyEditors: mocks.hasDirtyEditors,
    resolveDirtyEditors: mocks.resolveDirtyEditors,
    saveDirtyEditors: mocks.saveDirtyEditors
  })
}));

let latestState: ReturnType<typeof useAppState> | null = null;

function Probe(): React.JSX.Element {
  const state = useAppState();
  useEffect(() => {
    latestState = state;
  }, [state]);
  return React.createElement('probe');
}

async function renderProvider(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>
    );
    await Promise.resolve();
  });
  return renderer!;
}

describe('AppStateProvider dirty-state guard', () => {
  beforeEach(() => {
    latestState = null;
    mocks.appStateListeners.splice(0);
    mocks.clearAuthenticatedImageCache.mockClear();
    mocks.clearAuthTokens.mockClear();
    mocks.hasDirtyEditors = true;
    mocks.queryClear.mockClear();
    mocks.resolveDirtyEditors.mockReset();
    mocks.saveDirtyEditors.mockReset();
    mocks.saveDirtyEditors.mockResolvedValue(true);
    mocks.saveActiveOrganizationId.mockClear();
    mocks.saveSelection.mockClear();
    mocks.signOutFromCognito.mockClear();
    mocks.unregisterPushNotifications.mockClear();
  });

  it('selection変更をキャンセルした場合は選択状態を変えない', async () => {
    mocks.resolveDirtyEditors.mockResolvedValue(false);
    const renderer = await renderProvider();

    let changed = true;
    await act(async () => {
      changed = (await latestState?.updateSelection({ workId: 'work-1' })) ?? true;
    });

    expect(changed).toBe(false);
    expect(latestState?.selection.workId).toBeNull();
    await act(async () => renderer.unmount());
  });

  it('selectionが同じ場合はダイアログを出さず、保存後だけ変更する', async () => {
    mocks.resolveDirtyEditors.mockResolvedValue(true);
    const renderer = await renderProvider();

    await act(async () => {
      await latestState?.updateSelection({ workId: null });
    });
    expect(mocks.resolveDirtyEditors).not.toHaveBeenCalled();

    await act(async () => {
      await latestState?.updateSelection({ workId: 'work-1' });
    });
    expect(mocks.resolveDirtyEditors).toHaveBeenCalledWith('ja');
    expect(latestState?.selection.workId).toBe('work-1');
    await act(async () => renderer.unmount());
  });

  it('保存済み処理の内部selection更新は明示指定時だけguardを省略する', async () => {
    mocks.resolveDirtyEditors.mockResolvedValue(false);
    const renderer = await renderProvider();

    let changed = false;
    await act(async () => {
      changed = (
        await latestState?.updateSelection(
          { entityId: 'entity-created' },
          { skipDirtyCheck: true }
        )
      ) ?? false;
    });

    expect(changed).toBe(true);
    expect(mocks.resolveDirtyEditors).not.toHaveBeenCalled();
    expect(latestState?.selection.entityId).toBe('entity-created');
    await act(async () => renderer.unmount());
  });

  it('logoutをキャンセルした場合は認証情報を消さない', async () => {
    mocks.resolveDirtyEditors.mockResolvedValue(false);
    const renderer = await renderProvider();

    await act(async () => {
      await latestState?.logout();
    });

    expect(mocks.clearAuthTokens).not.toHaveBeenCalled();
    expect(mocks.signOutFromCognito).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('logout確定時は認証情報を消す前にpush tokenを解除する', async () => {
    mocks.resolveDirtyEditors.mockResolvedValue(true);
    const renderer = await renderProvider();

    await act(async () => {
      await latestState?.logout();
    });

    expect(mocks.unregisterPushNotifications).toHaveBeenCalledOnce();
    expect(mocks.unregisterPushNotifications).toHaveBeenCalledBefore(mocks.clearAuthTokens);
    await act(async () => renderer.unmount());
  });

  it('background遷移ではダイアログを出さず保存を1回だけ試みる', async () => {
    const renderer = await renderProvider();
    const backgroundListener = mocks.appStateListeners[0];

    backgroundListener?.('inactive');
    backgroundListener?.('background');
    await Promise.resolve();
    expect(mocks.saveDirtyEditors).toHaveBeenCalledTimes(1);
    expect(mocks.resolveDirtyEditors).not.toHaveBeenCalled();

    backgroundListener?.('active');
    backgroundListener?.('background');
    await Promise.resolve();
    expect(mocks.saveDirtyEditors).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
  });
});
