import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MangaReader } from '@/components/MangaReader';

const state = { selection: { organizationId: null }, sessionKey: 'session-a', language: 'ja' as const };
const works = [{ id: 'work-1', title: '作品A' }];
const chapters = [{ id: 'chapter-2', order: 2, title: '完結' }, { id: 'chapter-1', order: 1, title: '脱獄' }];
const episodes = {
  'chapter-1': [{ id: 'episode-1', chapter_id: 'chapter-1', order: 1, title: '始まり' }],
  'chapter-2': [{ id: 'episode-2', chapter_id: 'chapter-2', order: 1, title: '続き' }],
};
const generatedImage = (uri: string, generatedAt = '2026-10-14T00:00:00.000Z') => ({ cdn_url: uri, generated_at: generatedAt });
const page = (id: string, pageNumber: number, uri: string | null = null, generatedAt = '2026-10-14T00:00:00.000Z') => ({
  id, episode_id: 'episode-1', page_number: pageNumber,
  generated_image: uri === null ? null : generatedImage(uri, generatedAt),
  updated_at: '2026-10-14T00:00:00.000Z',
});
let readerPages = [page('page-1', 1), page('page-2', 2)];
let failedEpisodeChapterId: string | null = null;
let nextPageFailed = false;
let refreshedPage: ReturnType<typeof page> | undefined;
let pageDetailLoaded = false;
const retryEpisode = vi.fn();
const fetchNextPage = vi.fn();
const refetchPage = vi.fn();
const scrollToIndex = vi.fn();
const scrollToOffset = vi.fn();
const activePageDetailRequests = new Set<string>();
const readerRefreshBudgets = new Set<string>();
let automaticPageDetailGets = 0;
const setQueryData = vi.fn((queryKey: readonly unknown[], value: unknown) => {
  if (queryKey[0] === 'manga-reader-image-refresh-budget' && value === true) readerRefreshBudgets.add(JSON.stringify(queryKey));
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity', FlatList: React.forwardRef(function MockFlatList(props: Record<string, unknown>, ref: React.ForwardedRef<{ scrollToIndex: typeof scrollToIndex; scrollToOffset: typeof scrollToOffset }>) {
    React.useImperativeHandle(ref, () => ({ scrollToIndex, scrollToOffset }), []);
    const children = (props.data as unknown[]).map((item, index) => React.createElement(
      React.Fragment,
      { key: index },
      (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
    ));
    return React.createElement('list', props, children);
  }),
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress: () => void }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StatusBar: 'status-bar', StyleSheet: { create: <T,>(value: T): T => value }, Text: 'text', View: 'view',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('safe-area', props, children) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData }),
  useInfiniteQuery: (input: { queryKey: readonly string[] }) => input.queryKey[0] === 'works' ? ({
    data: { pages: [{ works }] }, isPending: false, isError: false, isSuccess: true, hasNextPage: false,
    isFetchingNextPage: false, isFetchNextPageError: false, fetchNextPage, refetch: vi.fn(),
  }) : ({
    data: { pages: [{ pages: readerPages }] }, isPending: false, isError: false, isSuccess: true, hasNextPage: nextPageFailed,
    isFetchingNextPage: false, isFetchNextPageError: nextPageFailed, fetchNextPage, refetch: vi.fn(),
  }),
  useQuery: (input: { enabled?: boolean; queryKey: readonly string[] }) => {
    if (input.queryKey[0] === 'chapters') return { data: { chapters }, isPending: false, isError: false, isSuccess: true, isFetching: false, refetch: vi.fn() };
    if (input.queryKey[0] === 'manga-reader-image-refresh-budget') return { data: readerRefreshBudgets.has(JSON.stringify(input.queryKey)) };
    const requestKey = JSON.stringify(input.queryKey);
    if (input.enabled && !activePageDetailRequests.has(requestKey)) {
      activePageDetailRequests.add(requestKey);
      automaticPageDetailGets += 1;
      pageDetailLoaded = true;
    } else if (!input.enabled) {
      activePageDetailRequests.delete(requestKey);
    }
    return { data: pageDetailLoaded ? refreshedPage : undefined, isPending: false, isError: false, isSuccess: true, isFetching: false, refetch: refetchPage };
  },
  useQueries: ({ queries }: { queries: { queryKey: readonly string[] }[] }) => queries.map((query) => {
    const chapterId = query.queryKey[2] as keyof typeof episodes;
    const failed = chapterId === failedEpisodeChapterId;
    return { data: failed ? undefined : { episodes: episodes[chapterId] ?? [] }, isPending: false, isError: failed, isSuccess: !failed, refetch: retryEpisode };
  }),
}));
vi.mock('@/components/Screen', () => ({ Screen: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('screen', props, children) }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: (props: Record<string, unknown>) => React.createElement('resilient-image', props) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ ...state, api: { getWorksPage: vi.fn(), getChapters: vi.fn(), getEpisodes: vi.fn(), getPagesPage: vi.fn(), getPage: vi.fn() } }) }));

function renderedText(renderer: ReturnType<typeof create>): string {
  return renderer.root.findAllByType('text').flatMap((node) => node.children).join(' ');
}

function openWork(renderer: ReturnType<typeof create>): void {
  act(() => { renderer.root.findByProps({ accessibilityLabel: '作品A' }).props.onPress(); });
}

function openFirstEpisode(renderer: ReturnType<typeof create>): void {
  const episode = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) =>
    typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.endsWith(' 始まり'));
  if (episode === undefined) throw new Error('対象の話が見つかりません');
  act(() => { episode.props.onPress(); });
}

describe('MangaReader', () => {
  beforeEach(() => {
    readerPages = [page('page-1', 1), page('page-2', 2)];
    failedEpisodeChapterId = null;
    nextPageFailed = false;
    refreshedPage = undefined;
    pageDetailLoaded = false;
    automaticPageDetailGets = 0;
    activePageDetailRequests.clear();
    readerRefreshBudgets.clear();
    retryEpisode.mockClear();
    fetchNextPage.mockClear();
    refetchPage.mockClear();
    scrollToIndex.mockClear();
    scrollToOffset.mockClear();
    setQueryData.mockClear();
  });

  it('作品から章見出し付きの通算話一覧を経てreaderを開き、モード・前後話・closeを操作できる', () => {
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '作品A' }).props.onPress(); });
    const text = () => renderer!.root.findAllByType('text').flatMap((node) => node.children).join(' ');
    expect(text()).toContain('1章 脱獄');
    expect(text()).toContain('2章 完結');
    expect(text()).toContain('1話');
    expect(text()).not.toContain('通算');
    expect(text()).toContain('始まり');
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '1話 始まり' }).props.onPress(); });
    expect(renderer!.root.findByProps({ testID: 'manga-episode-reader-shell' })).toBeDefined();
    expect(text()).toContain('1章 脱獄');
    expect(text()).toContain('このページはまだ生成されていません。');
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '縦読み' }).props.onPress(); });
    expect(renderer!.root.findAllByType('list').some((node) => node.props.initialScrollIndex === 0)).toBe(true);
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '次話' }).props.onPress(); });
    expect(text()).toContain('2話');
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '閉じる' }).props.onPress(); });
    expect(renderer!.root.findByProps({ testID: 'manga-reader-episodes' })).toBeDefined();
  });

  it('episode readerをScrollView外の専用shellで開き、viewport単位のRTLと縦読みで現在ページを保つ', () => {
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    expect(renderer!.root.findByProps({ testID: 'manga-episode-reader-shell' })).toBeDefined();
    expect(renderer!.root.findAllByType('safe-area')).toHaveLength(1);
    expect(renderer!.root.findAllByType('screen')).toHaveLength(0);
    act(() => { renderer!.root.findByProps({ testID: 'manga-reader-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 390, height: 600 } } }); });
    const rtlList = renderer!.root.findAllByType('list').find((node) => node.props.horizontal === true);
    expect(renderedText(renderer!)).toContain('左右にスワイプで移動');
    expect(renderer!.root.findAllByProps({ accessibilityLabel: '前のページ' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ accessibilityLabel: '次のページ' })).toHaveLength(0);
    expect(rtlList?.props.inverted).toBe(true);
    expect(rtlList?.props.pagingEnabled).toBe(true);
    expect(rtlList?.props.getItemLayout(null, 1)).toEqual({ index: 1, length: 390, offset: 390 });
    scrollToIndex.mockClear();
    act(() => { rtlList?.props.onViewableItemsChanged({ viewableItems: [{ item: readerPages[1] }] }); });
    expect(scrollToIndex).not.toHaveBeenCalled();
    scrollToIndex.mockClear();
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '縦読み' }).props.onPress(); });
    const verticalList = renderer!.root.findAllByType('list').find((node) => node.props.horizontal !== true);
    expect(renderedText(renderer!)).not.toContain('左右にスワイプで移動');
    expect(verticalList?.props.initialScrollIndex).toBe(1);
    expect(verticalList?.props.getItemLayout(null, 1)).toEqual({ index: 1, length: 600, offset: 600 });
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, animated: false });
    act(() => { verticalList?.props.onScrollToIndexFailed({ index: 1 }); });
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 600 });
    scrollToIndex.mockClear();
    act(() => { renderer!.root.findByProps({ testID: 'manga-reader-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 400, height: 640 } } }); });
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, animated: false });
  });

  it('全章の話取得が成功するまで通算番号を確定せず、失敗章を再試行できる', () => {
    failedEpisodeChapterId = 'chapter-1';
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);

    expect(renderedText(renderer!)).not.toContain('1話');
    expect(renderedText(renderer!)).toContain('話一覧を読み込めません。');
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '話一覧を再試行' }).props.onPress(); });
    expect(retryEpisode).toHaveBeenCalledTimes(1);
  });

  it('追加page cursorの失敗を最終ページ扱いせず専用retryを表示する', () => {
    nextPageFailed = true;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    expect(renderedText(renderer!)).toContain('続きのページを読み込めません。');
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '続きのページを再試行' }).props.onPress(); });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('CDN失敗時は同じ生成revisionで自動更新を一度だけ使い、更新URLの再失敗をUIにする', () => {
    readerPages = [page('page-1', 1, 'https://cdn.lyra.test/old.png?sig=1')];
    refreshedPage = page('page-1', 1, 'https://cdn.lyra.test/new.png?sig=2');
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    const oldImage = renderer!.root.findByType('resilient-image');
    act(() => { oldImage.props.onExhausted(); });
    const refreshedImage = renderer!.root.findByType('resilient-image');
    expect(refreshedImage.props.sources[0].uri).toContain('new.png');
    act(() => { refreshedImage.props.onExhausted(); });
    expect(renderedText(renderer!)).toContain('画像を読み込めません。');
    expect(renderer!.root.findAllByType('resilient-image')).toHaveLength(0);
  });

  it('getPageが別pageのmetadataを返した場合は画像URLを採用しない', () => {
    readerPages = [page('page-1', 1, 'https://cdn.lyra.test/owned.png?sig=1')];
    refreshedPage = page('foreign-page', 1, 'https://cdn.lyra.test/foreign.png?sig=2');
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    act(() => { renderer!.root.findByType('resilient-image').props.onExhausted(); });
    expect(renderedText(renderer!)).toContain('画像を読み込めません。');
    expect(renderer!.root.findAllByType('resilient-image')).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('foreign.png');
  });

  it('旧生成revisionのpage detail cacheがあっても新しい一覧pageを上書きしない', () => {
    readerPages = [page('page-1', 1, 'https://cdn.lyra.test/revision-b.png', '2026-10-14T02:00:00.000Z')];
    refreshedPage = page('page-1', 1, 'https://cdn.lyra.test/revision-a.png', '2026-10-14T01:00:00.000Z');
    pageDetailLoaded = true;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    expect(renderer!.root.findByType('resilient-image').props.sources[0].uri).toContain('revision-b.png');
  });

  it('同じ生成revisionをmode切替でremountしても自動page detail取得は合計一度にする', () => {
    readerPages = [page('page-1', 1, 'https://cdn.lyra.test/old.png?sig=1')];
    refreshedPage = page('page-1', 1, 'https://cdn.lyra.test/new.png?sig=2');
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<MangaReader />); });
    openWork(renderer!);
    openFirstEpisode(renderer!);

    act(() => { renderer!.root.findByType('resilient-image').props.onExhausted(); });
    expect(automaticPageDetailGets).toBe(1);
    act(() => { renderer!.root.findByProps({ accessibilityLabel: '縦読み' }).props.onPress(); });
    act(() => { renderer!.root.findByType('resilient-image').props.onExhausted(); });

    expect(automaticPageDetailGets).toBe(1);
    expect(renderedText(renderer!)).toContain('画像を読み込めません。');
  });
});
