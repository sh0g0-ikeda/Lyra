import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { ResilientImage } from '@/components/ResilientImage';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { buildMangaReadingOrder, findAdjacentEpisode, readerCdnImageSource, type MangaReadingEpisode } from '@/domain/mangaReader';
import type { PageRecord, UiLanguage, WorkRecord } from '@/domain/types';
import { readerMessage } from '@/lib/mangaReaderMessages';
import { MOBILE_LIST_PAGE_SIZE, nextCursorFromPage } from '@/lib/listPagination';
import { chaptersQueryKey, episodesQueryKey, pageDetailQueryKey, pagesInfiniteQueryKey, worksInfiniteQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';

interface ReaderPageImageProps {
  height: number;
  language: UiLanguage;
  organizationId: string | null;
  page: PageRecord;
  sessionKey: string;
  width: number;
}

function ReaderPageImage({ height, language, organizationId, page, sessionKey, width }: ReaderPageImageProps): React.JSX.Element {
  const { api } = useAppState();
  const queryClient = useQueryClient();
  const [failedSource, setFailedSource] = useState<{ budgetKey: string; sourceIdentity: string } | null>(null);
  const [refreshRequestKey, setRefreshRequestKey] = useState<string | null>(null);
  const inputRevision = page.generated_image?.generated_at ?? page.updated_at;
  const refreshBudgetKey = [sessionKey, organizationId ?? 'personal', page.episode_id, page.id, inputRevision].join(':');
  const refreshBudgetQueryKey = useMemo(() => ['manga-reader-image-refresh-budget', refreshBudgetKey] as const, [refreshBudgetKey]);
  const refreshBudgetQuery = useQuery({
    enabled: false,
    gcTime: Infinity,
    initialData: false,
    queryFn: () => Promise.resolve(false),
    queryKey: refreshBudgetQueryKey,
    staleTime: Infinity,
  });
  const refreshQuery = useQuery({
    enabled: refreshRequestKey === refreshBudgetKey,
    queryKey: [...pageDetailQueryKey(sessionKey, page.id, organizationId), 'reader-revision', inputRevision] as const,
    queryFn: async () => {
      try {
        return await api.getPage(page.id, organizationId);
      } finally {
        setRefreshRequestKey((current) => current === refreshBudgetKey ? null : current);
      }
    },
    retry: false,
  });
  const refreshed = refreshQuery.data;
  const refreshedRevision = refreshed?.generated_image?.generated_at ?? refreshed?.updated_at;
  const resolvedPage = refreshed !== undefined && refreshed.id === page.id && refreshed.episode_id === page.episode_id && refreshedRevision === inputRevision ? refreshed : page;
  const source = readerCdnImageSource(resolvedPage, { sessionKey, organizationId, episodeId: page.episode_id });
  // The signed URI identifies one delivery attempt, while refreshBudgetKey keeps
  // the automatic metadata refresh capped at one per generated revision.
  const sourceIdentity = source === null ? 'missing' : `${source.cacheKey ?? 'reader'}:${source.uri}`;
  const sourceFailed = failedSource?.budgetKey === refreshBudgetKey && failedSource.sourceIdentity === sourceIdentity;

  const recordSourceFailure = useCallback((): void => {
    setFailedSource({ budgetKey: refreshBudgetKey, sourceIdentity });
    if (refreshBudgetQuery.data !== true) {
      queryClient.setQueryData(refreshBudgetQueryKey, true);
      setRefreshRequestKey(refreshBudgetKey);
    }
  }, [queryClient, refreshBudgetKey, refreshBudgetQuery.data, refreshBudgetQueryKey, sourceIdentity]);

  const reload = useCallback((): void => {
    setFailedSource({ budgetKey: refreshBudgetKey, sourceIdentity });
    void refreshQuery.refetch();
  }, [refreshBudgetKey, refreshQuery, sourceIdentity]);

  if (page.generated_image === null) {
    return <View style={styles.placeholder}><Text style={styles.placeholderText}>{readerMessage(language, 'notGenerated')}</Text></View>;
  }
  if (source === null || (sourceFailed && refreshBudgetQuery.data === true && !refreshQuery.isFetching)) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>{readerMessage(language, 'imageUnavailable')}</Text>
        <ReaderButton label={readerMessage(language, 'reloadImage')} onPress={reload} />
      </View>
    );
  }
  return (
    <View style={[styles.pageImageFrame, { height, width }]}>
      <ResilientImage
        cachePolicy="memory-disk"
        contentFit="contain"
        onExhausted={recordSourceFailure}
        priority="high"
        sources={[source]}
        style={[styles.pageImage, { height, width }]}
      />
      {refreshQuery.isFetching ? <ActivityIndicator color={colors.primary} style={styles.refreshing} /> : null}
    </View>
  );
}

function ReaderButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.JSX.Element {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled ? styles.disabledButton : null]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function chapterHeading(language: UiLanguage, number: number, title: string | null): string {
  return readerMessage(language, 'chapterHeading', { number, title: title?.trim() ?? '' }).trim();
}

interface MangaEpisodeReaderProps {
  episode: MangaReadingEpisode;
  onClose: () => void;
  onOpenEpisode: (episodeId: string) => void;
  readingOrder: readonly MangaReadingEpisode[];
}

function MangaEpisodeReader({ episode, onClose, onOpenEpisode, readingOrder }: MangaEpisodeReaderProps): React.JSX.Element {
  const { api, language, selection, sessionKey } = useAppState();
  const organizationId = selection.organizationId;
  const window = useWindowDimensions();
  const [mode, setMode] = useState<'rtl' | 'vertical'>('rtl');
  const horizontalListRef = useRef<FlatList<PageRecord>>(null);
  const verticalListRef = useRef<FlatList<PageRecord>>(null);
  const activeIndexRef = useRef(0);
  const [focusedPageId, setFocusedPageId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({
    height: Math.max(1, window.height - 220),
    width: Math.max(1, window.width),
  });
  const pagesQuery = useInfiniteQuery({
    enabled: true,
    queryKey: pagesInfiniteQueryKey(sessionKey, episode.episodeId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getPagesPage(episode.episodeId, { organizationId, limit: MOBILE_LIST_PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: nextCursorFromPage,
  });
  const pages = useMemo(() => pagesQuery.data?.pages.flatMap((page) => page.pages).sort((left, right) => left.page_number - right.page_number) ?? [], [pagesQuery.data?.pages]);
  const fetchNextPage = pagesQuery.fetchNextPage;
  const activePageId = focusedPageId ?? pages[0]?.id ?? null;
  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
  const adjacentPrevious = findAdjacentEpisode(readingOrder, episode.episodeId, 'previous');
  const adjacentNext = findAdjacentEpisode(readingOrder, episode.episodeId, 'next');

  useEffect(() => {
    if (pagesQuery.hasNextPage && !pagesQuery.isFetchingNextPage && !pagesQuery.isFetchNextPageError) void fetchNextPage();
  }, [fetchNextPage, pagesQuery.hasNextPage, pagesQuery.isFetchNextPageError, pagesQuery.isFetchingNextPage]);

  useEffect(() => {
    if (pages.length === 0) return;
    const list = mode === 'rtl' ? horizontalListRef.current : verticalListRef.current;
    const index = Math.min(activeIndexRef.current, pages.length - 1);
    list?.scrollToIndex({ index, animated: false });
  }, [mode, pages.length, viewport.height, viewport.width]);

  const handleViewportLayout = useCallback((event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout;
    if (next.width <= 0 || next.height <= 0) return;
    setViewport((current) => current.width === next.width && current.height === next.height
      ? current
      : { width: next.width, height: next.height });
  }, []);

  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<PageRecord>[] }): void => {
    const first = viewableItems.find((item) => item.isViewable !== false)?.item;
    if (first === undefined) return;
    const index = pages.findIndex((pageItem) => pageItem.id === first.id);
    if (index >= 0) activeIndexRef.current = index;
    setFocusedPageId(first.id);
  }, [pages]);

  const horizontalItemLayout = useCallback((_data: ArrayLike<PageRecord> | null | undefined, index: number) => ({
    index,
    length: viewport.width,
    offset: viewport.width * index,
  }), [viewport.width]);
  const verticalItemLayout = useCallback((_data: ArrayLike<PageRecord> | null | undefined, index: number) => ({
    index,
    length: viewport.height,
    offset: viewport.height * index,
  }), [viewport.height]);

  const handleScrollToIndexFailed = useCallback(({ index }: { index: number }): void => {
    const list = mode === 'rtl' ? horizontalListRef.current : verticalListRef.current;
    const extent = mode === 'rtl' ? viewport.width : viewport.height;
    list?.scrollToOffset({ animated: false, offset: Math.max(0, index) * extent });
  }, [mode, viewport.height, viewport.width]);

  const movePage = useCallback((direction: 'next' | 'previous'): void => {
    const nextIndex = activeIndex + (direction === 'next' ? 1 : -1);
    const candidate = pages[nextIndex];
    if (candidate === undefined) return;
    activeIndexRef.current = nextIndex;
    setFocusedPageId(candidate.id);
    const list = mode === 'rtl' ? horizontalListRef.current : verticalListRef.current;
    list?.scrollToIndex({ index: nextIndex, animated: true });
  }, [activeIndex, mode, pages]);

  const renderPage = useCallback(({ item }: { item: PageRecord }): React.JSX.Element => (
    <View style={{ height: viewport.height, width: viewport.width }}>
      <ReaderPageImage
        height={viewport.height}
        language={language}
        organizationId={organizationId}
        page={item}
        sessionKey={sessionKey}
        width={viewport.width}
      />
    </View>
  ), [language, organizationId, sessionKey, viewport.height, viewport.width]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.readerSafeArea} testID="manga-episode-reader-shell">
      <StatusBar backgroundColor={colors.canvas} barStyle="light-content" />
      <View style={styles.readerShell}>
      <View style={styles.readerHeader}>
        <ReaderButton label={readerMessage(language, 'close')} onPress={onClose} />
        <Text accessibilityRole="header" style={styles.readerTitle}>{readerMessage(language, 'workTotalEpisode', { number: episode.displayOrdinal })}</Text>
        <ReaderButton label={mode === 'rtl' ? readerMessage(language, 'vertical') : readerMessage(language, 'horizontalRtl')} onPress={() => setMode((current) => current === 'rtl' ? 'vertical' : 'rtl')} />
      </View>
      <Text style={styles.chapterTitle}>{chapterHeading(language, episode.chapterOrdinal, episode.chapterTitle)}</Text>
      <Text style={styles.episodeTitle}>{episode.episode.title?.trim() || readerMessage(language, 'episodeFallback')}</Text>
      {pagesQuery.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {pagesQuery.isError ? <ReaderButton label={readerMessage(language, 'retry')} onPress={() => { void pagesQuery.refetch(); }} /> : null}
      {pages.length === 0 && pagesQuery.isSuccess ? <Text style={styles.empty}>{readerMessage(language, 'emptyPages')}</Text> : null}
      <View onLayout={handleViewportLayout} style={styles.readerViewport} testID="manga-reader-viewport">
        {mode === 'rtl' ? (
          <FlatList
            data={pages}
            ref={horizontalListRef}
            key="rtl"
            initialScrollIndex={activeIndex}
            horizontal
            inverted
            getItemLayout={horizontalItemLayout}
            keyExtractor={(page) => page.id}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            onViewableItemsChanged={handleViewableItemsChanged}
            pagingEnabled
            renderItem={renderPage}
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalPages}
          />
        ) : (
        <FlatList
          data={pages}
          ref={verticalListRef}
          key="vertical"
          initialScrollIndex={activeIndex}
          getItemLayout={verticalItemLayout}
          keyExtractor={(page) => page.id}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onViewableItemsChanged={handleViewableItemsChanged}
          renderItem={renderPage}
          style={styles.verticalPages}
        />
        )}
      </View>
      {mode === 'rtl' ? <View style={styles.pageActions}><ReaderButton disabled={activeIndex <= 0} label={readerMessage(language, 'previousPage')} onPress={() => movePage('previous')} /><ReaderButton disabled={activeIndex >= pages.length - 1} label={readerMessage(language, 'nextPage')} onPress={() => movePage('next')} /></View> : null}
      {pagesQuery.isFetchingNextPage ? <Text style={styles.loadingText}>{readerMessage(language, 'loadingMorePages')}</Text> : null}
      {pagesQuery.isFetchNextPageError ? (
        <View style={styles.inlineError}>
          <Text style={styles.placeholderText}>{readerMessage(language, 'morePagesUnavailable')}</Text>
          <ReaderButton label={readerMessage(language, 'retryMorePages')} onPress={() => { void fetchNextPage(); }} />
        </View>
      ) : null}
      <View style={styles.pageActions}><ReaderButton disabled={adjacentPrevious === null} label={readerMessage(language, 'previousEpisode')} onPress={() => { if (adjacentPrevious !== null) onOpenEpisode(adjacentPrevious.episodeId); }} /><ReaderButton disabled={adjacentNext === null} label={readerMessage(language, 'nextEpisode')} onPress={() => { if (adjacentNext !== null) onOpenEpisode(adjacentNext.episodeId); }} /></View>
      </View>
    </SafeAreaView>
  );
}

export function MangaReader(): React.JSX.Element {
  const { api, language, selection, sessionKey } = useAppState();
  const organizationId = selection.organizationId;
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const worksQuery = useInfiniteQuery({
    enabled: true,
    queryKey: worksInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getWorksPage({ organizationId, limit: MOBILE_LIST_PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: nextCursorFromPage,
  });
  const works = useMemo(() => worksQuery.data?.pages.flatMap((page) => page.works) ?? [], [worksQuery.data?.pages]);
  const selectedWork = works.find((work) => work.id === selectedWorkId) ?? null;
  const chaptersQuery = useQuery({
    enabled: selectedWork !== null,
    queryKey: chaptersQueryKey(sessionKey, selectedWork?.id ?? null, organizationId),
    queryFn: () => api.getChapters(selectedWork?.id ?? '', organizationId),
  });
  const chapters = useMemo(() => chaptersQuery.data?.chapters ?? [], [chaptersQuery.data?.chapters]);
  const episodeQueries = useQueries({
    queries: chapters.map((chapter) => ({
      enabled: selectedWork !== null,
      queryKey: episodesQueryKey(sessionKey, chapter.id, organizationId),
      queryFn: () => api.getEpisodes(chapter.id, organizationId),
    })),
  });
  const episodeQueriesReady = chaptersQuery.isSuccess && episodeQueries.length === chapters.length &&
    episodeQueries.every((query) => query.isSuccess);
  const episodeQueriesPending = chaptersQuery.isSuccess && episodeQueries.some((query) => query.isPending);
  const episodeQueriesFailed = episodeQueries.some((query) => query.isError);
  const episodesByChapter = useMemo(() => episodeQueriesReady
    ? Object.fromEntries(chapters.map((chapter, index) => [chapter.id, episodeQueries[index]?.data?.episodes ?? []]))
    : {}, [chapters, episodeQueries, episodeQueriesReady]);
  const readingOrder = useMemo(() => episodeQueriesReady
    ? buildMangaReadingOrder(chapters, episodesByChapter)
    : [], [chapters, episodeQueriesReady, episodesByChapter]);
  const selectedEpisode = readingOrder.find((entry) => entry.episodeId === selectedEpisodeId) ?? null;
  const retryFailedEpisodeQueries = useCallback((): void => {
    for (const query of episodeQueries) {
      if (query.isError) void query.refetch();
    }
  }, [episodeQueries]);

  if (selectedEpisode !== null) return <MangaEpisodeReader key={selectedEpisode.episodeId} episode={selectedEpisode} onClose={() => setSelectedEpisodeId(null)} onOpenEpisode={setSelectedEpisodeId} readingOrder={readingOrder} />;
  if (selectedWork !== null) return (
    <Screen chrome="language" title={selectedWork.title} testID="manga-reader-episodes">
      <ReaderButton label={readerMessage(language, 'close')} onPress={() => setSelectedWorkId(null)} />
      {chaptersQuery.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {chaptersQuery.isError ? <ReaderButton label={readerMessage(language, 'retry')} onPress={() => { void chaptersQuery.refetch(); }} /> : null}
      {episodeQueriesPending ? <Text style={styles.loadingText}>{readerMessage(language, 'loadingEpisodes')}</Text> : null}
      {episodeQueriesFailed ? (
        <View style={styles.inlineError}>
          <Text style={styles.placeholderText}>{readerMessage(language, 'episodesUnavailable')}</Text>
          <ReaderButton label={readerMessage(language, 'retryEpisodes')} onPress={retryFailedEpisodeQueries} />
        </View>
      ) : null}
      {!episodeQueriesReady ? null : [...chapters].sort((left, right) => left.order - right.order).map((chapter, chapterIndex) => (
        <View key={chapter.id} style={styles.chapter}>
          <Text accessibilityRole="header" style={styles.chapterTitle}>{chapterHeading(language, chapterIndex + 1, chapter.title)}</Text>
          {readingOrder.filter((entry) => entry.chapterId === chapter.id).map((entry) => <Pressable accessibilityLabel={`${readerMessage(language, 'workTotalEpisode', { number: entry.displayOrdinal })} ${entry.episode.title?.trim() || readerMessage(language, 'episodeFallback')}`} accessibilityRole="button" key={entry.episodeId} onPress={() => setSelectedEpisodeId(entry.episodeId)} style={styles.episodeCard}><Text style={styles.episodeOrdinal}>{readerMessage(language, 'workTotalEpisode', { number: entry.displayOrdinal })}</Text><Text style={styles.episodeName}>{entry.episode.title?.trim() || readerMessage(language, 'episodeFallback')}</Text><Text style={styles.read}>{readerMessage(language, 'read')}</Text></Pressable>)}
        </View>
      ))}
    </Screen>
  );
  return (
    <Screen chrome="language" title={readerMessage(language, 'read')} testID="manga-reader-library">
      {worksQuery.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {worksQuery.isError ? <ReaderButton label={readerMessage(language, 'retry')} onPress={() => { void worksQuery.refetch(); }} /> : null}
      {works.length === 0 && worksQuery.isSuccess ? <Text style={styles.empty}>{readerMessage(language, 'emptyWorks')}</Text> : null}
      {works.map((work: WorkRecord) => <Pressable accessibilityLabel={work.title} accessibilityRole="button" key={work.id} onPress={() => setSelectedWorkId(work.id)} style={styles.workCard}><Text style={styles.workTitle}>{work.title}</Text><Text style={styles.read}>{readerMessage(language, 'read')}</Text></Pressable>)}
      {worksQuery.hasNextPage ? <ReaderButton label={readerMessage(language, 'retry')} onPress={() => { void worksQuery.fetchNextPage(); }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  buttonText: { ...textStyles.caption, color: colors.inkStrong, fontWeight: '700' },
  chapter: { gap: spacing.xs, marginBottom: spacing.lg }, chapterTitle: { ...textStyles.sectionTitle, color: colors.inkStrong },
  disabledButton: { opacity: 0.4 }, empty: { ...textStyles.body, color: colors.muted }, episodeCard: { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  episodeName: { ...textStyles.body, color: colors.inkStrong, fontWeight: '700' }, episodeOrdinal: { ...textStyles.caption, color: colors.primary }, episodeTitle: { ...textStyles.sectionTitle, color: colors.inkStrong }, horizontalPages: { flex: 1 }, inlineError: { alignItems: 'center', gap: spacing.xs }, loadingText: { ...textStyles.caption, color: colors.muted, textAlign: 'center' }, pageActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }, pageImage: { backgroundColor: colors.canvas }, pageImageFrame: { alignItems: 'center', justifyContent: 'center' }, placeholder: { alignItems: 'center', borderColor: colors.controlBorder, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.sm, justifyContent: 'center', padding: spacing.md }, placeholderText: { ...textStyles.body, color: colors.muted, textAlign: 'center' }, read: { ...textStyles.caption, color: colors.primary, fontWeight: '700' }, readerHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' }, readerSafeArea: { backgroundColor: colors.canvas, flex: 1 }, readerShell: { flex: 1, gap: spacing.xs, padding: spacing.sm }, readerTitle: { ...textStyles.caption, color: colors.primary, fontWeight: '700' }, readerViewport: { flex: 1, minHeight: 1, minWidth: 1, overflow: 'hidden' }, refreshing: { position: 'absolute', right: spacing.sm, top: spacing.sm }, verticalPages: { flex: 1 }, workCard: { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm, padding: spacing.md }, workTitle: { ...textStyles.sectionTitle, color: colors.inkStrong },
});
