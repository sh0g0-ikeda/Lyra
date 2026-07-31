import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { StoryEditor } from '../components/StoryEditor';
import { StoryHierarchyActions } from '../components/StoryHierarchyActions';
import { StorySelectionSection } from '../components/StorySelectionSection';
import { colors, spacing } from '../constants/theme';
import {
  buildEpisodeStoryUpdate,
  createEpisodeStoryDraft,
  isEpisodeStoryDraftDirty,
  type EpisodeStoryDraft,
  type EpisodeStoryUpdatePayload,
  type EpisodeStoryValidationReason,
} from '../domain/episodeStoryDraft';
import {
  canMoveOrderedItem,
  nextStoryOrder,
  resolveEpisodeMove,
  validateStoryHierarchyTitle,
  type StoryItemMoveDirection,
} from '../domain/storyHierarchyPolicy';
import {
  ApiError,
  type ChapterRecord,
  type CreateStoryItemInput,
  type EpisodeRecord,
  type ListWorksPageInput,
  type WorkRecord,
} from '../lib/api';
import {
  showDirtyStoryPrompt,
  type DirtyStoryAction,
} from '../lib/dirtyStoryPrompt';
import { t, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';

export interface StoryScreenHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface StoryApiPort {
  createWork(title: string, organizationId?: string | null): Promise<WorkRecord>;
  updateWork(
    workId: string,
    title: string,
    organizationId?: string | null,
  ): Promise<WorkRecord>;
  getWorksPage(
    input: ListWorksPageInput,
    organizationId?: string | null,
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }>;
  getChapters(
    workId: string,
    organizationId?: string | null,
  ): Promise<{ chapters: ChapterRecord[] }>;
  createChapter(
    workId: string,
    body: CreateStoryItemInput,
    organizationId?: string | null,
  ): Promise<ChapterRecord>;
  updateChapter(
    chapterId: string,
    title: string,
    organizationId?: string | null,
  ): Promise<ChapterRecord>;
  moveChapter(
    chapterId: string,
    direction: StoryItemMoveDirection,
    organizationId?: string | null,
  ): Promise<ChapterRecord>;
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<{ episodes: EpisodeRecord[] }>;
  createEpisode(
    chapterId: string,
    body: CreateStoryItemInput,
    organizationId?: string | null,
  ): Promise<EpisodeRecord>;
  moveEpisode(
    episodeId: string,
    direction: StoryItemMoveDirection,
    crossChapter?: boolean,
    organizationId?: string | null,
  ): Promise<EpisodeRecord>;
  updateEpisode(
    episodeId: string,
    body: EpisodeStoryUpdatePayload,
    organizationId?: string | null,
  ): Promise<EpisodeRecord>;
}

interface StoryScreenProps {
  api: StoryApiPort;
  language: UiLanguage;
  organizationId: string | null;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

export const StoryScreen = forwardRef<StoryScreenHandle, StoryScreenProps>(
  function StoryScreen(
    {
      api,
      language,
      organizationId,
      resolveDirtyAction,
      sessionKey,
    },
    ref,
  ): React.JSX.Element {
    const queryClient = useQueryClient();
    const queryKeys = useMemo(
      () => storyQueryKeys(sessionKey, organizationId),
      [organizationId, sessionKey],
    );
    const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
    const [selectedEpisode, setSelectedEpisode] = useState<EpisodeRecord | null>(null);
    const [savedDraft, setSavedDraft] = useState<EpisodeStoryDraft | null>(null);
    const [draft, setDraft] = useState<EpisodeStoryDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveNotice, setSaveNotice] = useState<string | null>(null);
    const [hierarchyBusy, setHierarchyBusy] = useState(false);
    const [hierarchyError, setHierarchyError] = useState<string | null>(null);
    const [hierarchyNotice, setHierarchyNotice] = useState<string | null>(null);
    const saveOperation = useRef<Promise<boolean> | null>(null);
    const hierarchyOperation = useRef<Promise<boolean> | null>(null);
    const transitionActive = useRef(false);

    const worksQuery = useQuery({
      queryKey: queryKeys.works(),
      queryFn: () => api.getWorksPage({ limit: 50 }, organizationId),
    });
    const chaptersQuery = useQuery({
      enabled: selectedWorkId !== null,
      queryKey: selectedWorkId === null
        ? [...queryKeys.works(), 'chapters-disabled']
        : queryKeys.chapters(selectedWorkId),
      queryFn: () => api.getChapters(selectedWorkId!, organizationId),
    });
    const episodesQuery = useQuery({
      enabled: selectedChapterId !== null,
      queryKey: selectedChapterId === null
        ? [...queryKeys.works(), 'episodes-disabled']
        : queryKeys.episodes(selectedChapterId),
      queryFn: () => api.getEpisodes(selectedChapterId!, organizationId),
    });

    const works = useMemo(
      () => worksQuery.data?.works ?? [],
      [worksQuery.data?.works],
    );
    const chapters = useMemo(
      () => chaptersQuery.data?.chapters ?? [],
      [chaptersQuery.data?.chapters],
    );
    const episodes = useMemo(
      () => episodesQuery.data?.episodes ?? [],
      [episodesQuery.data?.episodes],
    );
    const selectedWork = works.find((work) => work.id === selectedWorkId) ?? null;
    const selectedChapter = chapters.find(
      (chapter) => chapter.id === selectedChapterId,
    ) ?? null;

    const dirty = savedDraft !== null
      && draft !== null
      && isEpisodeStoryDraftDirty(savedDraft, draft);

    const saveCurrentDraft = useCallback((): Promise<boolean> => {
      if (hierarchyOperation.current !== null) {
        return Promise.resolve(false);
      }
      if (saveOperation.current !== null) {
        return saveOperation.current;
      }
      if (selectedEpisode === null || savedDraft === null || draft === null) {
        return Promise.resolve(!dirty);
      }
      const update = buildEpisodeStoryUpdate(savedDraft, draft);
      if (!update.ok) {
        setSaveNotice(null);
        setSaveError(validationMessage(language, update.reason));
        return Promise.resolve(false);
      }

      setSaving(true);
      setSaveError(null);
      setSaveNotice(null);
      const operation = (async (): Promise<boolean> => {
        try {
          const updatedEpisode = await api.updateEpisode(
            selectedEpisode.id,
            update.payload,
            organizationId,
          );
          const nextSavedDraft = createEpisodeStoryDraft(updatedEpisode);
          queryClient.setQueryData<{ episodes: EpisodeRecord[] }>(
            queryKeys.episodes(updatedEpisode.chapter_id),
            (current) => current === undefined
              ? current
              : {
                  episodes: current.episodes.map((episode) =>
                    episode.id === updatedEpisode.id ? updatedEpisode : episode),
                },
          );
          setSelectedEpisode(updatedEpisode);
          setSavedDraft(nextSavedDraft);
          setDraft(nextSavedDraft);
          setSaveNotice(t(language, 'storySaved'));
          return true;
        } catch {
          setSaveError(t(language, 'storySaveError'));
          return false;
        } finally {
          setSaving(false);
        }
      })();
      saveOperation.current = operation;
      void operation.finally(() => {
        if (saveOperation.current === operation) {
          saveOperation.current = null;
        }
      });
      return operation;
    }, [
      api,
      dirty,
      draft,
      language,
      organizationId,
      queryClient,
      queryKeys,
      savedDraft,
      selectedEpisode,
    ]);

    const resolvePendingChanges = useCallback(async (): Promise<boolean> => {
      if (hierarchyOperation.current !== null) {
        return false;
      }
      if (saveOperation.current !== null) {
        return saveOperation.current;
      }
      if (!dirty) {
        return true;
      }
      const action = resolveDirtyAction === undefined
        ? await showDirtyStoryPrompt(language)
        : await resolveDirtyAction();
      if (action === 'cancel') {
        return false;
      }
      if (action === 'discard') {
        return true;
      }
      return saveCurrentDraft();
    }, [dirty, language, resolveDirtyAction, saveCurrentDraft]);

    useImperativeHandle(ref, () => ({
      prepareToLeave: resolvePendingChanges,
    }), [resolvePendingChanges]);

    const transition = useCallback(async (
      changeSelection: () => void | boolean | Promise<void | boolean>,
    ): Promise<boolean> => {
      if (transitionActive.current) {
        return false;
      }
      transitionActive.current = true;
      try {
        if (await resolvePendingChanges()) {
          setSaveError(null);
          setSaveNotice(null);
          setHierarchyError(null);
          setHierarchyNotice(null);
          return (await changeSelection()) !== false;
        }
        return false;
      } finally {
        transitionActive.current = false;
      }
    }, [resolvePendingChanges]);

    const selectWork = (workId: string): void => {
      if (workId === selectedWorkId) {
        return;
      }
      void transition(() => {
        setSelectedWorkId(workId);
        setSelectedChapterId(null);
        setSelectedEpisode(null);
        setSavedDraft(null);
        setDraft(null);
      });
    };

    const selectChapter = (chapterId: string): void => {
      if (chapterId === selectedChapterId) {
        return;
      }
      void transition(() => {
        setSelectedChapterId(chapterId);
        setSelectedEpisode(null);
        setSavedDraft(null);
        setDraft(null);
      });
    };

    const selectEpisode = (episode: EpisodeRecord): void => {
      if (episode.id === selectedEpisode?.id) {
        return;
      }
      void transition(() => {
        const nextDraft = createEpisodeStoryDraft(episode);
        setSelectedEpisode(episode);
        setSavedDraft(nextDraft);
        setDraft(nextDraft);
      });
    };

    const validateHierarchyTitle = useCallback((input: string): string | null => {
      const validation = validateStoryHierarchyTitle(input);
      if (validation.ok) {
        return validation.value;
      }
      setHierarchyNotice(null);
      setHierarchyError(validation.reason === 'required'
        ? t(language, 'storyHierarchyTitleRequired')
        : t(language, 'storyTitleTooLong'));
      return null;
    }, [language]);

    const runHierarchyMutation = useCallback((
      mutation: () => Promise<boolean>,
    ): Promise<boolean> => {
      if (hierarchyOperation.current !== null) {
        return hierarchyOperation.current;
      }
      setHierarchyBusy(true);
      setHierarchyError(null);
      setHierarchyNotice(null);
      const operation = (async (): Promise<boolean> => {
        try {
          const activeSave = saveOperation.current;
          if (activeSave !== null && !(await activeSave)) {
            return false;
          }
          const changed = await mutation();
          if (changed) {
            setHierarchyNotice(t(language, 'storyHierarchyUpdated'));
          }
          return changed;
        } catch {
          setHierarchyError(t(language, 'storyHierarchyUpdateError'));
          return false;
        } finally {
          setHierarchyBusy(false);
        }
      })();
      hierarchyOperation.current = operation;
      void operation.finally(() => {
        if (hierarchyOperation.current === operation) {
          hierarchyOperation.current = null;
        }
      });
      return operation;
    }, [language]);

    const rejectOrderLimit = useCallback((): false => {
      setHierarchyNotice(null);
      setHierarchyError(t(language, 'storyHierarchyOrderLimit'));
      return false;
    }, [language]);

    const createWork = useCallback((input: string): Promise<boolean> => {
      const title = validateHierarchyTitle(input);
      if (title === null) {
        return Promise.resolve(false);
      }
      return runHierarchyMutation(() => transition(async () => {
        await queryClient.cancelQueries({
          exact: true,
          queryKey: queryKeys.works(),
        });
        const created = await api.createWork(title, organizationId);
        queryClient.setQueryData<{ works: WorkRecord[]; next_cursor: string | null }>(
          queryKeys.works(),
          (current) => ({
            works: upsertById(current?.works ?? [], created, true),
            next_cursor: current?.next_cursor ?? null,
          }),
        );
        setSelectedWorkId(created.id);
        setSelectedChapterId(null);
        setSelectedEpisode(null);
        setSavedDraft(null);
        setDraft(null);
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.works(),
          refetchType: 'none',
        });
        return true;
      }));
    }, [
      api,
      organizationId,
      queryClient,
      queryKeys,
      runHierarchyMutation,
      transition,
      validateHierarchyTitle,
    ]);

    const renameWork = useCallback((input: string): Promise<boolean> => {
      const title = validateHierarchyTitle(input);
      if (title === null || selectedWork === null) {
        return Promise.resolve(false);
      }
      if (selectedWork.title === title) {
        return Promise.resolve(false);
      }
      return runHierarchyMutation(async () => {
        await queryClient.cancelQueries({
          exact: true,
          queryKey: queryKeys.works(),
        });
        const updated = await api.updateWork(selectedWork.id, title, organizationId);
        queryClient.setQueryData<{ works: WorkRecord[]; next_cursor: string | null }>(
          queryKeys.works(),
          (current) => current === undefined
            ? current
            : { ...current, works: upsertById(current.works, updated) },
        );
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.works(),
          refetchType: 'none',
        });
        return true;
      });
    }, [
      api,
      organizationId,
      queryClient,
      queryKeys,
      runHierarchyMutation,
      selectedWork,
      validateHierarchyTitle,
    ]);

    const createChapter = useCallback((input: string): Promise<boolean> => {
      const title = validateHierarchyTitle(input);
      if (title === null || selectedWorkId === null) {
        return Promise.resolve(false);
      }
      const initialOrder = nextStoryOrder(chapters);
      if (!initialOrder.ok) {
        return Promise.resolve(rejectOrderLimit());
      }
      return runHierarchyMutation(() => transition(async () => {
        const chaptersKey = queryKeys.chapters(selectedWorkId);
        await queryClient.cancelQueries({ exact: true, queryKey: chaptersKey });
        let created: ChapterRecord;
        try {
          created = await api.createChapter(
            selectedWorkId,
            { order: initialOrder.order, title },
            organizationId,
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) {
            throw error;
          }
          const refreshed = await chaptersQuery.refetch();
          if (refreshed.isError) {
            throw refreshed.error;
          }
          const retryOrder = nextStoryOrder(refreshed.data?.chapters ?? []);
          if (!retryOrder.ok) {
            return rejectOrderLimit();
          }
          created = await api.createChapter(
            selectedWorkId,
            { order: retryOrder.order, title },
            organizationId,
          );
        }
        queryClient.setQueryData<{ chapters: ChapterRecord[] }>(
          chaptersKey,
          (current) => ({ chapters: sortByOrder(upsertById(current?.chapters ?? [], created)) }),
        );
        setSelectedChapterId(created.id);
        setSelectedEpisode(null);
        setSavedDraft(null);
        setDraft(null);
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: chaptersKey,
          refetchType: 'none',
        });
        return true;
      }));
    }, [
      api,
      chapters,
      chaptersQuery,
      organizationId,
      queryClient,
      queryKeys,
      rejectOrderLimit,
      runHierarchyMutation,
      selectedWorkId,
      transition,
      validateHierarchyTitle,
    ]);

    const renameChapter = useCallback((input: string): Promise<boolean> => {
      const title = validateHierarchyTitle(input);
      if (title === null || selectedChapter === null || selectedWorkId === null) {
        return Promise.resolve(false);
      }
      if (selectedChapter.title === title) {
        return Promise.resolve(false);
      }
      return runHierarchyMutation(async () => {
        const chaptersKey = queryKeys.chapters(selectedWorkId);
        await queryClient.cancelQueries({ exact: true, queryKey: chaptersKey });
        const updated = await api.updateChapter(
          selectedChapter.id,
          title,
          organizationId,
        );
        queryClient.setQueryData<{ chapters: ChapterRecord[] }>(
          chaptersKey,
          (current) => current === undefined
            ? current
            : { chapters: sortByOrder(upsertById(current.chapters, updated)) },
        );
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: chaptersKey,
          refetchType: 'none',
        });
        return true;
      });
    }, [
      api,
      organizationId,
      queryClient,
      queryKeys,
      runHierarchyMutation,
      selectedChapter,
      selectedWorkId,
      validateHierarchyTitle,
    ]);

    const moveChapter = useCallback((
      direction: StoryItemMoveDirection,
    ): Promise<boolean> => {
      if (
        selectedChapter === null
        || selectedWorkId === null
        || !canMoveOrderedItem(chapters, selectedChapter.id, direction)
      ) {
        return Promise.resolve(false);
      }
      return runHierarchyMutation(async () => {
        await api.moveChapter(selectedChapter.id, direction, organizationId);
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.chapters(selectedWorkId),
        });
        return true;
      });
    }, [
      api,
      chapters,
      organizationId,
      queryClient,
      queryKeys,
      runHierarchyMutation,
      selectedChapter,
      selectedWorkId,
    ]);

    const createEpisode = useCallback((input: string): Promise<boolean> => {
      const title = validateHierarchyTitle(input);
      if (title === null || selectedChapterId === null) {
        return Promise.resolve(false);
      }
      const initialOrder = nextStoryOrder(episodes);
      if (!initialOrder.ok) {
        return Promise.resolve(rejectOrderLimit());
      }
      return runHierarchyMutation(() => transition(async () => {
        const episodesKey = queryKeys.episodes(selectedChapterId);
        await queryClient.cancelQueries({ exact: true, queryKey: episodesKey });
        let created: EpisodeRecord;
        try {
          created = await api.createEpisode(
            selectedChapterId,
            { order: initialOrder.order, title },
            organizationId,
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) {
            throw error;
          }
          const refreshed = await episodesQuery.refetch();
          if (refreshed.isError) {
            throw refreshed.error;
          }
          const retryOrder = nextStoryOrder(refreshed.data?.episodes ?? []);
          if (!retryOrder.ok) {
            return rejectOrderLimit();
          }
          created = await api.createEpisode(
            selectedChapterId,
            { order: retryOrder.order, title },
            organizationId,
          );
        }
        queryClient.setQueryData<{ episodes: EpisodeRecord[] }>(
          episodesKey,
          (current) => ({ episodes: sortByOrder(upsertById(current?.episodes ?? [], created)) }),
        );
        const nextDraft = createEpisodeStoryDraft(created);
        setSelectedEpisode(created);
        setSavedDraft(nextDraft);
        setDraft(nextDraft);
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: episodesKey,
          refetchType: 'none',
        });
        return true;
      }));
    }, [
      api,
      episodes,
      episodesQuery,
      organizationId,
      queryClient,
      queryKeys,
      rejectOrderLimit,
      runHierarchyMutation,
      selectedChapterId,
      transition,
      validateHierarchyTitle,
    ]);

    const moveEpisode = useCallback((
      direction: StoryItemMoveDirection,
    ): Promise<boolean> => {
      if (selectedChapterId === null || selectedEpisode === null) {
        return Promise.resolve(false);
      }
      const resolution = resolveEpisodeMove(
        chapters,
        selectedChapterId,
        episodes,
        selectedEpisode.id,
        direction,
      );
      if (!resolution.allowed || resolution.destinationChapterId === null) {
        return Promise.resolve(false);
      }
      return runHierarchyMutation(async () => {
        const sourceChapterId = selectedChapterId;
        const updated = await api.moveEpisode(
          selectedEpisode.id,
          direction,
          resolution.crossChapter,
          organizationId,
        );
        setSelectedEpisode(updated);
        if (updated.chapter_id !== sourceChapterId) {
          queryClient.setQueryData<{ episodes: EpisodeRecord[] }>(
            queryKeys.episodes(sourceChapterId),
            (current) => current === undefined
              ? current
              : {
                  episodes: current.episodes.filter(
                    (episode) => episode.id !== updated.id,
                  ),
                },
          );
          queryClient.setQueryData<{ episodes: EpisodeRecord[] }>(
            queryKeys.episodes(updated.chapter_id),
            (current) => ({
              episodes: sortByOrder(upsertById(current?.episodes ?? [], updated)),
            }),
          );
          setSelectedChapterId(updated.chapter_id);
        }
        const affectedChapterIds = new Set([sourceChapterId, updated.chapter_id]);
        await Promise.all([...affectedChapterIds].map((chapterId) =>
          queryClient.invalidateQueries({
            exact: true,
            queryKey: queryKeys.episodes(chapterId),
          })));
        return true;
      });
    }, [
      api,
      chapters,
      episodes,
      organizationId,
      queryClient,
      queryKeys,
      runHierarchyMutation,
      selectedChapterId,
      selectedEpisode,
    ]);

    const episodeMoveUp = selectedChapterId === null || selectedEpisode === null
      ? { allowed: false }
      : resolveEpisodeMove(
          chapters,
          selectedChapterId,
          episodes,
          selectedEpisode.id,
          'up',
        );
    const episodeMoveDown = selectedChapterId === null || selectedEpisode === null
      ? { allowed: false }
      : resolveEpisodeMove(
          chapters,
          selectedChapterId,
          episodes,
          selectedEpisode.id,
          'down',
        );

    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{t(language, 'story')}</Text>
        <StorySelectionSection
          emptyMessage={t(language, 'storyNoWorks')}
          error={worksQuery.isError}
          errorMessage={t(language, 'storyWorksError')}
          heading={t(language, 'works')}
          items={works.map((work) => ({
            id: work.id,
            label: work.title,
          }))}
          loading={worksQuery.isLoading}
          loadingMessage={t(language, 'storyWorksLoading')}
          onRetry={() => void worksQuery.refetch()}
          onSelect={selectWork}
          retryLabel={t(language, 'retry')}
          selectedId={selectedWorkId}
          selectSuffix={t(language, 'storySelectSuffix')}
        />

        {selectedWorkId === null ? null : (
          <StorySelectionSection
            emptyMessage={t(language, 'storyNoChapters')}
            error={chaptersQuery.isError}
            errorMessage={t(language, 'storyChaptersError')}
            heading={t(language, 'chapters')}
            items={chapters.map((chapter) => ({
              id: chapter.id,
              label: chapter.title ?? `${t(language, 'chapter')} ${chapter.order}`,
            }))}
            loading={chaptersQuery.isLoading}
            loadingMessage={t(language, 'storyChaptersLoading')}
            onRetry={() => void chaptersQuery.refetch()}
            onSelect={selectChapter}
            retryLabel={t(language, 'retry')}
            selectedId={selectedChapterId}
            selectSuffix={t(language, 'storySelectSuffix')}
          />
        )}

        {selectedChapterId === null ? null : (
          <StorySelectionSection
            emptyMessage={t(language, 'storyNoEpisodes')}
            error={episodesQuery.isError}
            errorMessage={t(language, 'storyEpisodesError')}
            heading={t(language, 'episodes')}
            items={episodes.map((episode) => ({
              id: episode.id,
              label: episode.title ?? `${t(language, 'episode')} ${episode.order}`,
            }))}
            loading={episodesQuery.isLoading}
            loadingMessage={t(language, 'storyEpisodesLoading')}
            onRetry={() => void episodesQuery.refetch()}
            onSelect={(episodeId) => {
              const episode = episodes.find(
                (candidate) => candidate.id === episodeId,
              );
              if (episode !== undefined) {
                selectEpisode(episode);
              }
            }}
            retryLabel={t(language, 'retry')}
            selectedId={selectedEpisode?.id ?? null}
            selectSuffix={t(language, 'storySelectSuffix')}
          />
        )}

        <StoryHierarchyActions
          busy={hierarchyBusy
            || saving
            || worksQuery.isFetching
            || chaptersQuery.isFetching
            || episodesQuery.isFetching}
          canMoveChapterDown={selectedChapter !== null
            && canMoveOrderedItem(chapters, selectedChapter.id, 'down')}
          canMoveChapterUp={selectedChapter !== null
            && canMoveOrderedItem(chapters, selectedChapter.id, 'up')}
          canMoveEpisodeDown={episodeMoveDown.allowed}
          canMoveEpisodeUp={episodeMoveUp.allowed}
          errorMessage={hierarchyError}
          language={language}
          noticeMessage={hierarchyNotice}
          onCreateChapter={createChapter}
          onCreateEpisode={createEpisode}
          onCreateWork={createWork}
          onMoveChapter={moveChapter}
          onMoveEpisode={moveEpisode}
          onRenameChapter={renameChapter}
          onRenameWork={renameWork}
          selectedChapter={selectedChapter}
          selectedEpisode={selectedEpisode}
          selectedWork={selectedWork}
        />

        {draft === null ? null : (
          <StoryEditor
            dirty={dirty}
            draft={draft}
            errorMessage={saveError}
            language={language}
            noticeMessage={saveNotice}
            operationActive={hierarchyBusy}
            onChangeEstimatedPages={(estimatedPages) => setDraft((current) =>
              current === null ? current : { ...current, estimatedPages })}
            onChangeStory={(story) => setDraft((current) =>
              current === null ? current : { ...current, story })}
            onChangeTitle={(title) => setDraft((current) =>
              current === null ? current : { ...current, title })}
            onSave={() => void saveCurrentDraft()}
            saving={saving}
          />
        )}
      </View>
    );
  },
);

function validationMessage(
  language: UiLanguage,
  reason: EpisodeStoryValidationReason,
): string {
  switch (reason) {
    case 'title_too_long':
      return t(language, 'storyTitleTooLong');
    case 'story_too_long':
      return t(language, 'storyBodyTooLong');
    case 'estimated_pages_out_of_range':
      return t(language, 'storyEstimatedPagesInvalid');
  }
}

function upsertById<T extends { id: string }>(
  items: readonly T[],
  item: T,
  prepend = false,
): T[] {
  if (items.some((candidate) => candidate.id === item.id)) {
    return items.map((candidate) => candidate.id === item.id ? item : candidate);
  }
  const withoutItem = items.filter((candidate) => candidate.id !== item.id);
  return prepend ? [item, ...withoutItem] : [...withoutItem, item];
}

function sortByOrder<T extends { id: string; order: number }>(items: readonly T[]): T[] {
  return [...items].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  heading: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
});
