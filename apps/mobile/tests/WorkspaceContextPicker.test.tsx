import React from 'react';
import {
  act,
  create,
  type ReactTestInstance
} from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceContextPicker,
  type WorkspaceContextData
} from '@/components/WorkspaceContextPicker';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  logout: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  resolveDirtyEditors: vi.fn().mockResolvedValue(true),
  updateSelection: vi.fn().mockResolvedValue(true)
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text'
}));

vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) =>
    React.createElement('notice', props)
}));

vi.mock('@/components/RecordPicker', () => ({
  RecordPicker: () => React.createElement('record-picker')
}));

vi.mock('@/components/Section', () => ({
  Section: ({ children }: { children: React.ReactNode }) =>
    React.createElement('section', null, children)
}));

vi.mock('@/lib/i18n', () => ({
  t: (_language: string, key: string) => key
}));

vi.mock('@/lib/userMessages', () => ({
  userErrorMessage: () => 'safe error'
}));

vi.mock('@/navigation/navigationRef', () => ({
  navigationRef: {
    isReady: mocks.isReady,
    navigate: mocks.navigate
  }
}));

vi.mock('@/state/appState', () => ({
  useAppState: () => ({
    language: 'ja',
    logout: mocks.logout,
    updateSelection: mocks.updateSelection
  })
}));

vi.mock('@/state/dirtyState', () => ({
  useDirtyState: () => ({
    resolveDirtyEditors: mocks.resolveDirtyEditors
  })
}));

function context(error: unknown, retry = vi.fn()): WorkspaceContextData {
  return {
    chapters: [],
    episodes: [],
    error,
    hasMoreWorks: false,
    isFetchingMoreWorks: false,
    loadMoreWorks: vi.fn(),
    retry,
    selectedChapterId: null,
    selectedEpisodeId: null,
    selectedWorkId: null,
    works: []
  };
}

function renderNotice(error: unknown, retry = vi.fn()): {
  notice: ReactTestInstance;
  retry: typeof retry;
} {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <WorkspaceContextPicker context={context(error, retry)} />
    );
  });
  return {
    notice: renderer!.root.findByType('notice'),
    retry
  };
}

describe('WorkspaceContextPicker recovery actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isReady.mockReturnValue(true);
    mocks.resolveDirtyEditors.mockResolvedValue(true);
  });

  it('一時エラーの再試行ボタンで全階層queryのretryを実行する', () => {
    const retry = vi.fn();
    const rendered = renderNotice(
      new ApiError('provider detail', 503, 'SERVICE_UNAVAILABLE'),
      retry
    );

    act(() => rendered.notice.props.onAction());

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('認証エラーの再ログインボタンでlogoutを実行する', () => {
    const rendered = renderNotice(
      new ApiError('provider detail', 401, 'UNAUTHORIZED')
    );

    act(() => rendered.notice.props.onAction());

    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('権限エラーでは未保存確認後にAccountへ移動する', async () => {
    const rendered = renderNotice(
      new ApiError('provider detail', 403, 'FORBIDDEN')
    );

    await act(async () => {
      rendered.notice.props.onAction();
      await Promise.resolve();
    });

    expect(mocks.resolveDirtyEditors).toHaveBeenCalledWith('ja');
    expect(mocks.navigate).toHaveBeenCalledWith('Account');
  });
});
