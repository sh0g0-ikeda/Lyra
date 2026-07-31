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
import type {
  ChapterRecord,
  EpisodeRecord,
  ListWorksPageInput,
  WorkRecord,
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
  getWorksPage(
    input: ListWorksPageInput,
    organizationId?: string | null,
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }>;
  getChapters(
    workId: string,
    organizationId?: string | null,
  ): Promise<{ chapters: ChapterRecord[] }>;
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<{ episodes: EpisodeRecord[] }>;
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
    const saveOperation = useRef<Promise<boolean> | null>(null);
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

    const dirty = savedDraft !== null
      && draft !== null
      && isEpisodeStoryDraftDirty(savedDraft, draft);

    const saveCurrentDraft = useCallback((): Promise<boolean> => {
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

    const transition = useCallback(async (changeSelection: () => void): Promise<void> => {
      if (transitionActive.current) {
        return;
      }
      transitionActive.current = true;
      try {
        if (await resolvePendingChanges()) {
          setSaveError(null);
          setSaveNotice(null);
          changeSelection();
        }
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

    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{t(language, 'story')}</Text>
        <StorySelectionSection
          emptyMessage={t(language, 'storyNoWorks')}
          error={worksQuery.isError}
          errorMessage={t(language, 'storyWorksError')}
          heading={t(language, 'works')}
          items={(worksQuery.data?.works ?? []).map((work) => ({
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
            items={(chaptersQuery.data?.chapters ?? []).map((chapter) => ({
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
            items={(episodesQuery.data?.episodes ?? []).map((episode) => ({
              id: episode.id,
              label: episode.title ?? `${t(language, 'episode')} ${episode.order}`,
            }))}
            loading={episodesQuery.isLoading}
            loadingMessage={t(language, 'storyEpisodesLoading')}
            onRetry={() => void episodesQuery.refetch()}
            onSelect={(episodeId) => {
              const episode = episodesQuery.data?.episodes.find(
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

        {draft === null ? null : (
          <StoryEditor
            dirty={dirty}
            draft={draft}
            errorMessage={saveError}
            language={language}
            noticeMessage={saveNotice}
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
