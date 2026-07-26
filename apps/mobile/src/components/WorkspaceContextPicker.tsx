import { useEffect, useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { RecordPicker } from '@/components/RecordPicker';
import { Section } from '@/components/Section';
import { colors, textStyles } from '@/constants/theme';
import type { ChapterRecord, EpisodeRecord, WorkRecord } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  chaptersQueryKey,
  episodesQueryKey,
  workDetailQueryKey,
  worksInfiniteQueryKey,
} from '@/lib/queryKeys';
import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';
import { navigationRef } from '@/navigation/navigationRef';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';

export interface WorkspaceContextSelection {
  selectedWorkId: string | null;
  selectedChapterId: string | null;
  selectedEpisodeId: string | null;
}

export interface WorkspaceContextData extends WorkspaceContextSelection {
  works: WorkRecord[];
  chapters: ChapterRecord[];
  episodes: EpisodeRecord[];
  error: unknown;
  hasMoreWorks: boolean;
  isFetchingMoreWorks: boolean;
  loadMoreWorks: () => void;
  retry: () => void;
}

interface WorkspaceContextPickerProps {
  context: WorkspaceContextData;
}

export function useWorkspaceContextSelection(): WorkspaceContextData {
  const { api, selection, sessionKey, updateSelection } = useAppState();
  const organizationId = selection.organizationId;
  const worksQuery = useInfiniteQuery({
    queryKey: worksInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getWorksPage({
      organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const loadedWorks = useMemo(
    () => flattenUniqueRecords(worksQuery.data?.pages.map((page) => page.works) ?? []),
    [worksQuery.data?.pages],
  );
  const fetchNextWorksPage = worksQuery.fetchNextPage;
  const hasNextWorksPage = worksQuery.hasNextPage;
  const isFetchingNextWorksPage = worksQuery.isFetchingNextPage;
  const selectedWorkFromList =
    loadedWorks.find((work) => work.id === selection.workId) ?? null;
  const shouldFetchSelectedWorkDetail =
    worksQuery.isSuccess &&
    selection.workId !== null &&
    selectedWorkFromList === null;
  const selectedWorkQuery = useQuery({
    enabled: shouldFetchSelectedWorkDetail,
    queryKey: workDetailQueryKey(sessionKey, selection.workId, organizationId),
    queryFn: () => api.getWork(selection.workId ?? '', organizationId),
  });
  const selectedWork = selectedWorkFromList ?? selectedWorkQuery.data ?? null;
  const selectedWorkDetailNotFound =
    shouldFetchSelectedWorkDetail &&
    selectedWorkQuery.error instanceof ApiError &&
    selectedWorkQuery.error.status === 404;
  const selectedWorkListIncomplete =
    hasNextWorksPage || isFetchingNextWorksPage;
  const selectedWorkDetailError =
    shouldFetchSelectedWorkDetail &&
    !(selectedWorkDetailNotFound && selectedWorkListIncomplete)
      ? selectedWorkQuery.error
      : null;
  const selectedWorkNotFound =
    selection.workId !== null &&
    selectedWork === null &&
    selectedWorkDetailNotFound &&
    !selectedWorkListIncomplete;
  const works = useMemo(
    () => selectedWork === null || loadedWorks.some((work) => work.id === selectedWork.id)
      ? loadedWorks
      : [selectedWork, ...loadedWorks],
    [loadedWorks, selectedWork],
  );

  const chaptersQuery = useQuery({
    enabled: selectedWork !== null,
    queryKey: chaptersQueryKey(sessionKey, selectedWork?.id ?? null, organizationId),
    queryFn: () => api.getChapters(selectedWork?.id ?? '', organizationId)
  });
  const chapters = useMemo(() => chaptersQuery.data?.chapters ?? [], [chaptersQuery.data?.chapters]);
  const selectedChapter = chapters.find((chapter) => chapter.id === selection.chapterId) ?? null;

  const episodesQuery = useQuery({
    enabled: selectedChapter !== null,
    queryKey: episodesQueryKey(sessionKey, selectedChapter?.id ?? null, organizationId),
    queryFn: () => api.getEpisodes(selectedChapter?.id ?? '', organizationId)
  });
  const episodes = useMemo(() => episodesQuery.data?.episodes ?? [], [episodesQuery.data?.episodes]);
  const selectedEpisode = episodes.find((episode) => episode.id === selection.episodeId) ?? null;

  useEffect(() => {
    if (
      !selectedWorkDetailNotFound ||
      !hasNextWorksPage ||
      isFetchingNextWorksPage
    ) {
      return;
    }
    void fetchNextWorksPage();
  }, [
    fetchNextWorksPage,
    hasNextWorksPage,
    isFetchingNextWorksPage,
    selectedWorkDetailNotFound,
  ]);

  useEffect(() => {
    if (!worksQuery.isSuccess) {
      return;
    }
    if (selectedWorkNotFound) {
      void updateSelection(
        { workId: null, chapterId: null, episodeId: null, pageId: null, entityId: null },
        { skipDirtyCheck: true }
      );
      return;
    }
    if (selectedWork !== null && chaptersQuery.isSuccess && selection.chapterId !== null && selectedChapter === null) {
      void updateSelection(
        { chapterId: null, episodeId: null, pageId: null },
        { skipDirtyCheck: true }
      );
      return;
    }
    if (selectedChapter !== null && episodesQuery.isSuccess && selection.episodeId !== null && selectedEpisode === null) {
      void updateSelection(
        { episodeId: null, pageId: null },
        { skipDirtyCheck: true }
      );
    }
  }, [
    chaptersQuery.isSuccess,
    episodesQuery.isSuccess,
    selectedChapter,
    selectedEpisode,
    selectedWork,
    selectedWorkNotFound,
    selection.chapterId,
    selection.episodeId,
    selection.workId,
    updateSelection,
    worksQuery.isSuccess
  ]);

  return {
    works,
    chapters,
    episodes,
    selectedWorkId: selectedWorkNotFound ? null : selection.workId,
    selectedChapterId: selectedChapter?.id ?? null,
    selectedEpisodeId: selectedEpisode?.id ?? null,
    error:
      worksQuery.error ??
      selectedWorkDetailError ??
      chaptersQuery.error ??
      episodesQuery.error,
    hasMoreWorks: worksQuery.hasNextPage,
    isFetchingMoreWorks: worksQuery.isFetchingNextPage,
    loadMoreWorks: () => {
      void worksQuery.fetchNextPage();
    },
    retry: () => {
      void worksQuery.refetch();
      if (shouldFetchSelectedWorkDetail) {
        void selectedWorkQuery.refetch();
      }
      if (selectedWork !== null) {
        void chaptersQuery.refetch();
      }
      if (selectedChapter !== null) {
        void episodesQuery.refetch();
      }
    },
  };
}

export function WorkspaceContextPicker({ context }: WorkspaceContextPickerProps): React.JSX.Element {
  const { language, logout, updateSelection } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();

  return (
    <Section
      collapsible
      persistKey="workspace:current-episode"
      subtitle={t(language, "generated.components.WorkspaceContextPicker.choose.the.work.chapter.and.episode.to.e.2f66fcff")}
      title={t(language, "generated.components.WorkspaceContextPicker.current.episode.selection.97428a78")}
    >
      {context.error === null ? null : (
        <ActionableErrorNotice
          actions={{
            login: () => {
              void logout();
            },
            retry: context.retry,
            workspace: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave && navigationRef.isReady()) {
                  navigationRef.navigate('Account');
                }
              });
            },
          }}
          error={context.error}
          language={language}
        />
      )}
      <Text style={styles.label}>{t(language, 'works')}</Text>
      <RecordPicker
        emptyLabel={t(language, 'emptyWorks')}
        hasNextPage={context.hasMoreWorks}
        isFetchingNextPage={context.isFetchingMoreWorks}
        items={context.works}
        language={language}
        labelForItem={(work) => work.title}
        onEndReached={context.loadMoreWorks}
        onSelect={(workId) => {
          void updateSelection({ workId, chapterId: null, episodeId: null, pageId: null, entityId: null });
        }}
        selectedId={context.selectedWorkId}
      />
      {context.selectedWorkId === null ? null : (
        <>
          <Text style={styles.label}>{t(language, 'chapters')}</Text>
          <RecordPicker
            emptyLabel={t(language, 'emptyChapters')}
            items={context.chapters}
            language={language}
            labelForItem={(chapter) => `${chapter.order}. ${chapter.title ?? t(language, 'chapter')}`}
            onSelect={(chapterId) => {
              void updateSelection({ chapterId, episodeId: null, pageId: null });
            }}
            selectedId={context.selectedChapterId}
          />
        </>
      )}
      {context.selectedChapterId === null ? null : (
        <>
          <Text style={styles.label}>{t(language, 'episodes')}</Text>
          <RecordPicker
            emptyLabel={t(language, 'emptyEpisodes')}
            items={context.episodes}
            language={language}
            labelForItem={(episode) => `${episode.order}. ${episode.title ?? t(language, 'episode')}`}
            onSelect={(episodeId) => {
              void updateSelection({ episodeId, pageId: null });
            }}
            selectedId={context.selectedEpisodeId}
          />
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  }
});
