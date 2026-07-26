import React from 'react';
import {
  act,
  create,
  type ReactTestInstance
} from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceContextPicker,
  useWorkspaceContextSelection,
  type WorkspaceContextData
} from '@/components/WorkspaceContextPicker';
import type { WorkRecord } from '@/domain/types';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  api: {
    getChapters: vi.fn(),
    getEpisodes: vi.fn(),
    getWork: vi.fn(),
    getWorksPage: vi.fn()
  },
  isReady: vi.fn(() => true),
  logout: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  resolveDirtyEditors: vi.fn().mockResolvedValue(true),
  selection: {
    chapterId: null as string | null,
    entityId: null as string | null,
    episodeId: null as string | null,
    organizationId: null as string | null,
    pageId: null as string | null,
    workId: 'work-1' as string | null
  },
  useInfiniteQuery: vi.fn(),
  useQuery: vi.fn(),
  updateSelection: vi.fn().mockResolvedValue(true)
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mocks.useInfiniteQuery,
  useQuery: mocks.useQuery
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
    api: mocks.api,
    language: 'ja',
    logout: mocks.logout,
    selection: mocks.selection,
    sessionKey: 'user-1',
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

const selectedWork: WorkRecord = {
  id: 'work-1',
  organization_id: null,
  title: '選択中の作品',
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 1,
  status: 'draft',
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z'
};

function SelectionProbe({
  onValue
}: {
  onValue: (value: WorkspaceContextData) => void;
}): React.JSX.Element {
  const value = useWorkspaceContextSelection();
  React.useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return React.createElement('selection-probe');
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

describe('useWorkspaceContextSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selection.workId = 'work-1';
    mocks.selection.chapterId = null;
    mocks.selection.episodeId = null;
  });

  it('一覧に選択作品がある場合は残っている詳細404を無視する', async () => {
    const detailNotFound = new ApiError('stale detail error', 404, 'NOT_FOUND');
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pages: [{ works: [selectedWork], next_cursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isSuccess: true,
      refetch: vi.fn()
    });
    mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => {
      switch (options.queryKey[0]) {
        case 'work-detail':
          return { data: undefined, error: detailNotFound, refetch: vi.fn() };
        case 'chapters':
          return {
            data: { chapters: [] },
            error: null,
            isSuccess: true,
            refetch: vi.fn()
          };
        default:
          return {
            data: { episodes: [] },
            error: null,
            isSuccess: false,
            refetch: vi.fn()
          };
      }
    });
    let value: WorkspaceContextData | null = null;

    await act(async () => {
      create(
        <SelectionProbe
          onValue={(nextValue) => {
            value = nextValue;
          }}
        />
      );
    });

    expect(value?.selectedWorkId).toBe('work-1');
    expect(value?.error).toBeNull();
    expect(mocks.updateSelection).not.toHaveBeenCalled();
  });

  it('一覧成功前は保存済み作品IDの詳細取得を開始しない', async () => {
    mocks.useInfiniteQuery.mockReturnValue({
      data: undefined,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isSuccess: false,
      refetch: vi.fn()
    });
    const enabledByQueryKey = new Map<string, boolean>();
    mocks.useQuery.mockImplementation((options: {
      enabled?: boolean;
      queryKey: readonly unknown[];
    }) => {
      enabledByQueryKey.set(String(options.queryKey[0]), options.enabled ?? true);
      return {
        data: undefined,
        error: null,
        isSuccess: false,
        refetch: vi.fn()
      };
    });

    await act(async () => {
      create(<SelectionProbe onValue={() => undefined} />);
    });

    expect(enabledByQueryKey.get('work-detail')).toBe(false);
    expect(enabledByQueryKey.get('chapters')).toBe(false);
  });

  it('一覧にも詳細にも選択作品がない場合は選択を解除する', async () => {
    const detailNotFound = new ApiError('missing work', 404, 'NOT_FOUND');
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pages: [{ works: [], next_cursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isSuccess: true,
      refetch: vi.fn()
    });
    mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => {
      if (options.queryKey[0] === 'work-detail') {
        return { data: undefined, error: detailNotFound, refetch: vi.fn() };
      }
      return {
        data: undefined,
        error: null,
        isSuccess: false,
        refetch: vi.fn()
      };
    });

    await act(async () => {
      create(<SelectionProbe onValue={() => undefined} />);
      await Promise.resolve();
    });

    expect(mocks.updateSelection).toHaveBeenCalledWith(
      {
        workId: null,
        chapterId: null,
        episodeId: null,
        pageId: null,
        entityId: null
      },
      { skipDirtyCheck: true }
    );
  });

  it('後続ページがある間は詳細404でも選択解除せず次ページを取得する', async () => {
    const detailNotFound = new ApiError('missing from first page', 404, 'NOT_FOUND');
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pages: [{ works: [], next_cursor: 'next-page' }] },
      error: null,
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isSuccess: true,
      refetch: vi.fn()
    });
    mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => {
      if (options.queryKey[0] === 'work-detail') {
        return { data: undefined, error: detailNotFound, refetch: vi.fn() };
      }
      return {
        data: undefined,
        error: null,
        isSuccess: false,
        refetch: vi.fn()
      };
    });

    await act(async () => {
      create(<SelectionProbe onValue={() => undefined} />);
      await Promise.resolve();
    });

    expect(fetchNextPage).toHaveBeenCalledOnce();
    expect(mocks.updateSelection).not.toHaveBeenCalled();
  });

  it('作品未選択時の再試行では空IDの下位queryを実行しない', async () => {
    mocks.selection.workId = null;
    const worksRefetch = vi.fn();
    const detailRefetch = vi.fn();
    const chaptersRefetch = vi.fn();
    const episodesRefetch = vi.fn();
    const staleDetailNotFound = new ApiError(
      'empty work id',
      404,
      'NOT_FOUND'
    );
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pages: [{ works: [], next_cursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isSuccess: true,
      refetch: worksRefetch
    });
    mocks.useQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => {
      switch (options.queryKey[0]) {
        case 'work-detail':
          return {
            data: undefined,
            error: staleDetailNotFound,
            isSuccess: false,
            refetch: detailRefetch
          };
        case 'chapters':
          return {
            data: undefined,
            error: null,
            isSuccess: false,
            refetch: chaptersRefetch
          };
        default:
          return {
            data: undefined,
            error: null,
            isSuccess: false,
            refetch: episodesRefetch
          };
      }
    });
    let value: WorkspaceContextData | null = null;

    await act(async () => {
      create(
        <SelectionProbe
          onValue={(nextValue) => {
            value = nextValue;
          }}
        />
      );
    });
    act(() => {
      value?.retry();
    });

    expect(value?.error).toBeNull();
    expect(worksRefetch).toHaveBeenCalledOnce();
    expect(detailRefetch).not.toHaveBeenCalled();
    expect(chaptersRefetch).not.toHaveBeenCalled();
    expect(episodesRefetch).not.toHaveBeenCalled();
  });
});
