import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { SceneEditor } from '../components/SceneEditor';
import { StorySelectionSection } from '../components/StorySelectionSection';
import { colors, spacing } from '../constants/theme';
import {
  buildSceneUpdate,
  createSceneDraft,
  isSceneDraftDirty,
  type SceneDraft,
  type SceneDraftValidationReason,
} from '../domain/sceneDraft';
import {
  ApiError,
  type ChapterRecord,
  type CreateSceneInput,
  type EpisodeRecord,
  type ListWorksPageInput,
  type SceneRecord,
  type UpdateSceneInput,
  type WorkRecord,
} from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';

const MAX_SCENE_ORDER = 1000;

export interface PagesScreenHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface PagesApiPort {
  createScene(
    episodeId: string,
    body: CreateSceneInput,
    organizationId?: string | null,
  ): Promise<SceneRecord>;
  getChapters(
    workId: string,
    organizationId?: string | null,
  ): Promise<{ chapters: ChapterRecord[] }>;
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<{ episodes: EpisodeRecord[] }>;
  getScenes(
    episodeId: string,
    organizationId?: string | null,
  ): Promise<{ scenes: SceneRecord[] }>;
  getWorksPage(
    input: ListWorksPageInput,
    organizationId?: string | null,
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }>;
  updateScene(
    sceneId: string,
    body: UpdateSceneInput,
    organizationId?: string | null,
  ): Promise<SceneRecord>;
}

interface PagesScreenProps {
  api: PagesApiPort;
  language: UiLanguage;
  organizationId: string | null;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

export const PagesScreen = forwardRef<PagesScreenHandle, PagesScreenProps>(
  function PagesScreen({
    api,
    language,
    organizationId,
    resolveDirtyAction,
    sessionKey,
  }, ref): React.JSX.Element {
    const queryClient = useQueryClient();
    const queryKeys = useMemo(
      () => storyQueryKeys(sessionKey, organizationId),
      [organizationId, sessionKey],
    );
    const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
    const [selectedEpisode, setSelectedEpisode] = useState<EpisodeRecord | null>(null);
    const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
    const [savedSceneDraft, setSavedSceneDraft] = useState<SceneDraft | null>(null);
    const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
    const [sceneBusy, setSceneBusy] = useState(false);
    const [sceneError, setSceneError] = useState<string | null>(null);
    const [sceneNotice, setSceneNotice] = useState<string | null>(null);
    const sceneOperation = useRef<Promise<boolean> | null>(null);
    const transitionOperation = useRef<Promise<boolean> | null>(null);

    const worksQuery = useQuery({
      queryKey: queryKeys.works(),
      queryFn: () => api.getWorksPage({ limit: 50 }, organizationId),
    });
    const chaptersQuery = useQuery({
      enabled: selectedWorkId !== null,
      queryKey: selectedWorkId === null
        ? [...queryKeys.works(), 'page-chapters-disabled']
        : queryKeys.chapters(selectedWorkId),
      queryFn: () => api.getChapters(selectedWorkId!, organizationId),
    });
    const episodesQuery = useQuery({
      enabled: selectedChapterId !== null,
      queryKey: selectedChapterId === null
        ? [...queryKeys.works(), 'page-episodes-disabled']
        : queryKeys.episodes(selectedChapterId),
      queryFn: () => api.getEpisodes(selectedChapterId!, organizationId),
    });
    const scenesQuery = useQuery({
      enabled: selectedEpisode !== null,
      queryKey: selectedEpisode === null
        ? [...queryKeys.works(), 'page-scenes-disabled']
        : queryKeys.scenes(selectedEpisode.id),
      queryFn: () => api.getScenes(selectedEpisode!.id, organizationId),
    });

    const works = worksQuery.data?.works ?? [];
    const chapters = chaptersQuery.data?.chapters ?? [];
    const episodes = episodesQuery.data?.episodes ?? [];
    const scenes = useMemo(
      () => sortScenes(scenesQuery.data?.scenes ?? []),
      [scenesQuery.data?.scenes],
    );
    const sceneDirty = savedSceneDraft !== null
      && sceneDraft !== null
      && isSceneDraftDirty(savedSceneDraft, sceneDraft);

    const applySelectedScene = useCallback((scene: SceneRecord | null): void => {
      setSelectedSceneId(scene?.id ?? null);
      const nextDraft = scene === null ? null : createSceneDraft(scene);
      setSavedSceneDraft(nextDraft);
      setSceneDraft(nextDraft);
    }, []);

    useEffect(() => {
      if (selectedEpisode === null || scenesQuery.isLoading || sceneDirty) {
        return;
      }
      const selected = scenes.find((scene) => scene.id === selectedSceneId);
      if (selected !== undefined) {
        if (sceneDraft === null || savedSceneDraft === null) {
          applySelectedScene(selected);
        }
        return;
      }
      applySelectedScene(scenes[0] ?? null);
    }, [
      applySelectedScene,
      savedSceneDraft,
      sceneDraft,
      sceneDirty,
      scenes,
      scenesQuery.isLoading,
      selectedEpisode,
      selectedSceneId,
    ]);

    const runSceneOperation = useCallback((task: () => Promise<boolean>): Promise<boolean> => {
      if (sceneOperation.current !== null) {
        return sceneOperation.current;
      }
      setSceneBusy(true);
      const operation = task().finally(() => {
        setSceneBusy(false);
      });
      sceneOperation.current = operation;
      void operation.finally(() => {
        if (sceneOperation.current === operation) {
          sceneOperation.current = null;
        }
      });
      return operation;
    }, []);

    const saveCurrentScene = useCallback((): Promise<boolean> => {
      if (sceneOperation.current !== null) {
        return sceneOperation.current;
      }
      if (
        selectedSceneId === null
        || selectedEpisode === null
        || savedSceneDraft === null
        || sceneDraft === null
        || !sceneDirty
      ) {
        return Promise.resolve(true);
      }
      const update = buildSceneUpdate(savedSceneDraft, sceneDraft);
      if (!update.ok) {
        setSceneNotice(null);
        setSceneError(sceneValidationMessage(language, update.reason));
        return Promise.resolve(false);
      }
      return runSceneOperation(async () => {
        setSceneError(null);
        setSceneNotice(null);
        try {
          const updated = await api.updateScene(selectedSceneId, update.payload, organizationId);
          queryClient.setQueryData<{ scenes: SceneRecord[] }>(
            queryKeys.scenes(selectedEpisode.id),
            (current) => current === undefined
              ? current
              : { scenes: sortScenes(upsertScene(current.scenes, updated)) },
          );
          applySelectedScene(updated);
          setSceneNotice(t(language, 'sceneSaved'));
          return true;
        } catch {
          setSceneError(t(language, 'sceneSaveError'));
          return false;
        }
      });
    }, [
      api,
      applySelectedScene,
      language,
      organizationId,
      queryClient,
      queryKeys,
      runSceneOperation,
      savedSceneDraft,
      sceneDraft,
      sceneDirty,
      selectedEpisode,
      selectedSceneId,
    ]);

    const resolvePendingScene = useCallback(async (): Promise<boolean> => {
      if (sceneOperation.current !== null) {
        return sceneOperation.current;
      }
      if (!sceneDirty) {
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
      return saveCurrentScene();
    }, [language, resolveDirtyAction, saveCurrentScene, sceneDirty]);

    useImperativeHandle(ref, () => ({
      prepareToLeave: resolvePendingScene,
    }), [resolvePendingScene]);

    const transition = useCallback((
      changeSelection: () => void | boolean | Promise<void | boolean>,
    ): Promise<boolean> => {
      if (transitionOperation.current !== null) {
        return transitionOperation.current;
      }
      const operation = (async (): Promise<boolean> => {
        if (!(await resolvePendingScene())) {
          return false;
        }
        setSceneError(null);
        setSceneNotice(null);
        return (await changeSelection()) !== false;
      })();
      transitionOperation.current = operation;
      void operation.finally(() => {
        if (transitionOperation.current === operation) {
          transitionOperation.current = null;
        }
      });
      return operation;
    }, [resolvePendingScene]);

    const createScene = useCallback((): Promise<boolean> => transition(async () => {
      if (selectedEpisode === null) {
        return false;
      }
      const initialOrder = nextSceneOrder(scenes);
      if (initialOrder === null) {
        setSceneError(t(language, 'sceneOrderLimit'));
        return false;
      }
      return runSceneOperation(async () => {
        setSceneError(null);
        setSceneNotice(null);
        const createAtOrder = (order: number): Promise<SceneRecord> => api.createScene(
          selectedEpisode.id,
          { order, location: null, time: null, atmosphere: null },
          organizationId,
        );
        try {
          let created: SceneRecord;
          try {
            created = await createAtOrder(initialOrder);
          } catch (error: unknown) {
            if (!(error instanceof ApiError) || error.status !== 422) {
              throw error;
            }
            const refreshed = await scenesQuery.refetch();
            const latest = sortScenes(refreshed.data?.scenes ?? []);
            const retryOrder = nextSceneOrder(latest);
            if (retryOrder === null || retryOrder <= initialOrder) {
              throw error;
            }
            created = await createAtOrder(retryOrder);
          }
          queryClient.setQueryData<{ scenes: SceneRecord[] }>(
            queryKeys.scenes(selectedEpisode.id),
            (current) => ({ scenes: sortScenes(upsertScene(current?.scenes ?? [], created)) }),
          );
          applySelectedScene(created);
          setSceneNotice(t(language, 'sceneCreated'));
          return true;
        } catch {
          setSceneError(t(language, 'sceneCreateError'));
          return false;
        }
      });
    }), [
      api,
      applySelectedScene,
      language,
      organizationId,
      queryClient,
      queryKeys,
      runSceneOperation,
      scenes,
      scenesQuery,
      selectedEpisode,
      transition,
    ]);

    const clearSceneSelection = (): void => {
      applySelectedScene(null);
    };

    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{t(language, 'pages')}</Text>
        <StorySelectionSection
          emptyMessage={t(language, 'storyNoWorks')}
          error={worksQuery.isError}
          errorMessage={t(language, 'storyWorksError')}
          heading={t(language, 'works')}
          items={works.map((work) => ({ id: work.id, label: work.title }))}
          loading={worksQuery.isLoading}
          loadingMessage={t(language, 'storyWorksLoading')}
          onRetry={() => void worksQuery.refetch()}
          onSelect={(workId) => {
            if (workId !== selectedWorkId) {
              void transition(() => {
                setSelectedWorkId(workId);
                setSelectedChapterId(null);
                setSelectedEpisode(null);
                clearSceneSelection();
              });
            }
          }}
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
            onSelect={(chapterId) => {
              if (chapterId !== selectedChapterId) {
                void transition(() => {
                  setSelectedChapterId(chapterId);
                  setSelectedEpisode(null);
                  clearSceneSelection();
                });
              }
            }}
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
              const episode = episodes.find((candidate) => candidate.id === episodeId);
              if (episode !== undefined && episode.id !== selectedEpisode?.id) {
                void transition(() => {
                  setSelectedEpisode(episode);
                  clearSceneSelection();
                });
              }
            }}
            retryLabel={t(language, 'retry')}
            selectedId={selectedEpisode?.id ?? null}
            selectSuffix={t(language, 'storySelectSuffix')}
          />
        )}
        {selectedEpisode === null ? null : (
          <View style={styles.sceneSection}>
            <Text style={styles.subheading}>{t(language, 'scenes')}</Text>
            <Text style={styles.muted}>{t(language, 'sceneHelp')}</Text>
            <StorySelectionSection
              emptyMessage={t(language, 'sceneNoScenes')}
              error={scenesQuery.isError}
              errorMessage={t(language, 'sceneScenesError')}
              heading={t(language, 'scenes')}
              items={scenes.map((scene) => ({
                id: scene.id,
                label: sceneLabel(scene, language),
              }))}
              loading={scenesQuery.isLoading}
              loadingMessage={t(language, 'sceneScenesLoading')}
              onRetry={() => void scenesQuery.refetch()}
              onSelect={(sceneId) => {
                const scene = scenes.find((candidate) => candidate.id === sceneId);
                if (scene !== undefined && scene.id !== selectedSceneId) {
                  void transition(() => applySelectedScene(scene));
                }
              }}
              retryLabel={t(language, 'retry')}
              selectedId={selectedSceneId}
              selectSuffix={t(language, 'storySelectSuffix')}
            />
            <PrimaryButton
              disabled={sceneBusy || scenesQuery.isFetching}
              label={t(language, 'sceneAdd')}
              onPress={() => void createScene()}
            />
            {sceneDraft === null ? (
              sceneError === null ? null : <Text style={styles.error}>{sceneError}</Text>
            ) : (
              <SceneEditor
                busy={sceneBusy}
                dirty={sceneDirty}
                draft={sceneDraft}
                errorMessage={sceneError}
                language={language}
                noticeMessage={sceneNotice}
                onChangeAtmosphere={(atmosphere) => setSceneDraft((current) =>
                  current === null ? current : { ...current, atmosphere })}
                onChangeLocation={(location) => setSceneDraft((current) =>
                  current === null ? current : { ...current, location })}
                onChangeTime={(time) => setSceneDraft((current) =>
                  current === null ? current : { ...current, time })}
                onSave={() => void saveCurrentScene()}
              />
            )}
          </View>
        )}
      </View>
    );
  },
);

function sortScenes(scenes: readonly SceneRecord[]): SceneRecord[] {
  return [...scenes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function upsertScene(scenes: readonly SceneRecord[], scene: SceneRecord): SceneRecord[] {
  return scenes.some((candidate) => candidate.id === scene.id)
    ? scenes.map((candidate) => candidate.id === scene.id ? scene : candidate)
    : [...scenes, scene];
}

function nextSceneOrder(scenes: readonly SceneRecord[]): number | null {
  const maximum = scenes.reduce((current, scene) => Math.max(current, scene.order), 0);
  return maximum >= MAX_SCENE_ORDER ? null : maximum + 1;
}

function sceneLabel(scene: SceneRecord, language: UiLanguage): string {
  const base = language === 'ja' ? `シーン ${scene.order}` : `Scene ${scene.order}`;
  return scene.location === null ? base : `${base} - ${scene.location}`;
}

function sceneValidationMessage(
  language: UiLanguage,
  _reason: SceneDraftValidationReason,
): string {
  return t(language, 'sceneTextTooLong');
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  heading: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  sceneSection: {
    gap: spacing.sm,
  },
  subheading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
});
