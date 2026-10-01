import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { EpisodeStartingStatesEditor } from '@/components/EpisodeStartingStatesEditor';
import { startingStateDraftIsDirty, type EpisodeStartingState } from '@/domain/episodeStartingStates';
import { EpisodeImprovementPanel } from '@/components/EpisodeImprovementPanel';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { StoryCollaborationPanel } from '@/components/StoryCollaborationPanel';
import { WorkspaceHierarchyNavigator } from '@/components/WorkspaceHierarchyNavigator';
import { useWorkspaceContextSelection } from '@/components/WorkspaceContextPicker';
import { colors, spacing, textStyles } from '@/constants/theme';
import { extractImprovedFullStory } from '@/domain/storyWorkflow';
import { storyEditorIsDirty } from '@/domain/editorDirtyPolicy';
import {
  buildEpisodeMobileUpdatePayload,
  episodeMobileDraft
} from '@/domain/episodeMobileDraft';
import {
  replaceEpisodeInResponse,
  runStoryAiAfterEpisodeSave,
  upsertSceneInResponse
} from '@/domain/storyEditorSavePolicy';
import type {
  EpisodeRecord,
  SceneRecord,
  StoryEpisodeImprovementRecord
} from '@/domain/types';
import { confirmStaleDraftReload } from '@/lib/confirmStaleDraftReload';
import { confirmAction, confirmDestructiveAction } from '@/lib/confirm';
import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';
import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';
import {
  chaptersQueryKey,
  entitiesInfiniteQueryKey,
  entitiesQueryKey,
  episodesQueryKey,
  scenesQueryKey,
  workDetailQueryKey,
  worksInfiniteQueryKey,
  worksQueryKey
} from '@/lib/queryKeys';
import { t } from '@/lib/i18n';
import { editorMessage } from '@/lib/editorUiMessages';
import { ApiError } from '@/lib/api';
import { userErrorMessage } from '@/lib/userMessages';
import { collectOperationFailures, operationFailure } from '@/lib/operationErrorContext';
import { useResetOnScopeChange } from '@/hooks/useResetOnScopeChange';
import { navigationRef } from '@/navigation/navigationRef';
import { useAppState } from '@/state/appState';
import { useDirtyEditorRegistration, useDirtyState } from '@/state/dirtyState';

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const MAX_ESTIMATED_PAGES = 32;
const MAX_STORY_ORDER = 1000;
const sameStringArray = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseIntInRange = (value: string, min: number, max: number): number | null => {
  const parsed = parsePositiveInt(value);
  return parsed === null || parsed < min || parsed > max ? null : parsed;
};

const isResourceStaleError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'RESOURCE_STALE';

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

export function StoryScreen({ onOpenCharacters }: { onOpenCharacters?: () => void } = {}): React.JSX.Element {
  const queryClient = useQueryClient();
  const { api, hasCapability, language, logout, selection, session, sessionKey } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const organizationId = selection.organizationId;
  const canEdit = hasCapability('edit_work');
  const [startingStateDraft, setStartingStateDraft] = useState<{ scopeKey: string; value: EpisodeStartingState[] } | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDraft, setEpisodeDraft] = useState('');
  const [estimatedPages, setEstimatedPages] = useState('4');
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneOrder, setSceneOrder] = useState('1');
  const [sceneLocation, setSceneLocation] = useState('');
  const [sceneTime, setSceneTime] = useState('');
  const [sceneAtmosphere, setSceneAtmosphere] = useState('');
  const [sceneEntityIds, setSceneEntityIds] = useState<string[]>([]);
  const [storyInstruction, setStoryInstruction] = useState('');
  const [improvement, setImprovement] = useState<StoryEpisodeImprovementRecord | null>(null);
  const [collaborationInstruction, setCollaborationInstruction] = useState('');
  const [collaborationProposal, setCollaborationProposal] = useState('');
  const [collaborationError, setCollaborationError] = useState<string | null>(null);
  const [staleResource, setStaleResource] = useState<{
    id: string;
    kind: 'episode';
  } | null>(null);
  const [dirtySaveError, setDirtySaveError] = useState<Error | null>(null);
  const lastSyncedEpisodeId = useRef<string | null>(null);
  const lastSyncedSceneId = useRef<string | null>(null);
  const collaborationAbortRef = useRef<AbortController | null>(null);
  const collaborationRequestIdRef = useRef(0);
  const workspaceContext = useWorkspaceContextSelection();

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
  const works = useMemo(
    () => flattenUniqueRecords(worksQuery.data?.pages.map((page) => page.works) ?? []),
    [worksQuery.data?.pages],
  );

  const selectedWorkFromList = useMemo(
    () => works.find((work) => work.id === selection.workId) ?? null,
    [selection.workId, works],
  );
  const selectedWorkQuery = useQuery({
    enabled: selection.workId !== null && selectedWorkFromList === null,
    queryKey: workDetailQueryKey(sessionKey, selection.workId, organizationId),
    queryFn: () => api.getWork(selection.workId ?? '', organizationId),
  });
  const selectedWork = selectedWorkFromList ?? selectedWorkQuery.data ?? null;
  const entitiesQuery = useInfiniteQuery({
    enabled: selectedWork !== null,
    queryKey: entitiesInfiniteQueryKey(sessionKey, selectedWork?.id ?? null, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getEntitiesPage(selectedWork?.id ?? '', {
      organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });

  const entities = useMemo(
    () => flattenUniqueRecords(entitiesQuery.data?.pages.map((page) => page.entities) ?? []),
    [entitiesQuery.data?.pages],
  );

  const chaptersQuery = useQuery({
    enabled: selectedWork !== null,
    queryKey: chaptersQueryKey(sessionKey, selectedWork?.id ?? null, organizationId),
    queryFn: () => api.getChapters(selectedWork?.id ?? '', organizationId)
  });

  const selectedChapter = useMemo(
    () => chaptersQuery.data?.chapters.find((chapter) => chapter.id === selection.chapterId) ?? null,
    [selection.chapterId, chaptersQuery.data?.chapters]
  );

  const episodesQuery = useQuery({
    enabled: selectedChapter !== null,
    queryKey: episodesQueryKey(sessionKey, selectedChapter?.id ?? null, organizationId),
    queryFn: () => api.getEpisodes(selectedChapter?.id ?? '', organizationId)
  });

  const selectedEpisode = useMemo(
    () => episodesQuery.data?.episodes.find((episode) => episode.id === selection.episodeId) ?? null,
    [selection.episodeId, episodesQuery.data?.episodes]
  );

  const scenesQuery = useQuery({
    enabled: selectedEpisode !== null,
    queryKey: scenesQueryKey(sessionKey, selectedEpisode?.id ?? null, organizationId),
    queryFn: () => api.getScenes(selectedEpisode?.id ?? '', organizationId)
  });

  const selectedScene = useMemo(
    () => scenesQuery.data?.scenes.find((scene) => scene.id === sceneId) ?? null,
    [sceneId, scenesQuery.data?.scenes]
  );

  const episodeScopeKey = JSON.stringify([sessionKey, organizationId, selectedEpisode?.id ?? null]);
  const startingEntityStatesDraft = startingStateDraft?.scopeKey === episodeScopeKey ? startingStateDraft.value : undefined;
  const startingStatesEnabled = session?.capabilities?.episode_state_autofill_v1 === true;
  const startingStatesDirty = startingStateDraftIsDirty(selectedEpisode?.starting_entity_states, startingEntityStatesDraft);
  const episodeDirty =
    selectedEpisode === null
      ? [episodeTitle, episodeDraft, estimatedPages].some((value) => value.trim().length > 0 && value !== '4')
      : episodeTitle !== (selectedEpisode.title ?? '') ||
        episodeDraft !== episodeMobileDraft(selectedEpisode) ||
        estimatedPages !== String(selectedEpisode.estimated_pages ?? 4) || startingStatesDirty;

  const sceneDirty =
    selectedScene === null
      ? [sceneLocation, sceneTime, sceneAtmosphere].some((value) => value.trim().length > 0) || sceneEntityIds.length > 0
      : sceneOrder !== String(selectedScene.order) ||
        sceneLocation !== (selectedScene.location ?? '') ||
        sceneTime !== (selectedScene.time ?? '') ||
        sceneAtmosphere !== (selectedScene.atmosphere ?? '') ||
        !sameStringArray(sceneEntityIds, selectedScene.involved_entity_ids ?? []);
  const storyDirty = storyEditorIsDirty({
    work: false,
    chapter: false,
    episode: episodeDirty,
    scene: sceneDirty
  });

  const storyEditorRevision = JSON.stringify({
    episode: {
      draft: episodeDraft,
      estimatedPages,
      id: selectedEpisode?.id ?? null,
      title: episodeTitle,
      startingEntityStates: startingEntityStatesDraft
    },
    scene: {
      atmosphere: sceneAtmosphere,
      entityIds: sceneEntityIds,
      id: sceneId,
      location: sceneLocation,
      order: sceneOrder,
      time: sceneTime
    }
  });

  const currentStoryDraftRef = useRef({ scope: episodeScopeKey, revision: storyEditorRevision });
  useLayoutEffect(() => {
    currentStoryDraftRef.current = { scope: episodeScopeKey, revision: storyEditorRevision };
  }, [episodeScopeKey, storyEditorRevision]);

  const storyErrorScope = JSON.stringify([sessionKey, organizationId, selectedWork?.id, selectedChapter?.id, selectedEpisode?.id, sceneId]);
  const storyErrorScopeRef = useRef(storyErrorScope);
  useLayoutEffect(() => { storyErrorScopeRef.current = storyErrorScope; }, [storyErrorScope]);

  const estimatedPagesInvalid = parseIntInRange(estimatedPages, 1, MAX_ESTIMATED_PAGES) === null;
  const sceneOrderInvalid = parseIntInRange(sceneOrder, 1, MAX_STORY_ORDER) === null;
  useEffect(() => {
    const nextId = selectedEpisode?.id ?? null;
    if (lastSyncedEpisodeId.current === nextId && episodeDirty) {
      return;
    }
    lastSyncedEpisodeId.current = nextId;
    setEpisodeTitle(selectedEpisode?.title ?? '');
    setEpisodeDraft(selectedEpisode === null ? '' : episodeMobileDraft(selectedEpisode));
    setEstimatedPages(String(selectedEpisode?.estimated_pages ?? 4));
    setImprovement(null);
    collaborationAbortRef.current?.abort();
    collaborationRequestIdRef.current += 1;
    setCollaborationProposal('');
    setCollaborationError(null);
  }, [episodeDirty, selectedEpisode]);

  useEffect(() => () => collaborationAbortRef.current?.abort(), []);

  useEffect(() => {
    const nextId = selectedScene?.id ?? null;
    if (lastSyncedSceneId.current === nextId && sceneDirty) {
      return;
    }
    lastSyncedSceneId.current = nextId;
    setSceneOrder(String(selectedScene?.order ?? (scenesQuery.data?.scenes.length ?? 0) + 1));
    setSceneLocation(selectedScene?.location ?? '');
    setSceneTime(selectedScene?.time ?? '');
    setSceneAtmosphere(selectedScene?.atmosphere ?? '');
    setSceneEntityIds(selectedScene?.involved_entity_ids ?? []);
  }, [sceneDirty, scenesQuery.data?.scenes.length, selectedScene]);

  const activeStaleResource =
    staleResource?.id === selectedEpisode?.id ? 'episode' : null;

  const invalidateWorks = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: worksQueryKey(sessionKey, organizationId) });
  };

  const invalidateEntities = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: entitiesQueryKey(sessionKey, selectedWork?.id ?? null, organizationId) });
  };

  const invalidateChapters = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: chaptersQueryKey(sessionKey, selectedWork?.id ?? null, organizationId) });
  };

  const invalidateEpisodes = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: episodesQueryKey(sessionKey, selectedChapter?.id ?? null, organizationId) });
  };

  const invalidateScenes = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scenesQueryKey(sessionKey, selectedEpisode?.id ?? null, organizationId) });
  };

  const updateEpisodeMutation = useMutation({
    mutationFn: () => {
      if (selectedEpisode === null) {
        throw new Error(t(language, "generated.screens.StoryScreen.select.an.episode.first.65b38fbb"));
      }
      return api.updateEpisode(
        selectedEpisode.id,
        buildEpisodeMobileUpdatePayload({
          draft: episodeDraft,
          episode: selectedEpisode,
          estimatedPages:
            parseIntInRange(estimatedPages, 1, MAX_ESTIMATED_PAGES) ?? 4,
          title: episodeTitle,
          startingEntityStates: startingEntityStatesDraft
        }),
        organizationId
      );
    },
    onSuccess: async (updatedEpisode) => {
      setStartingStateDraft((current) => current?.scopeKey === episodeScopeKey &&
        !startingStateDraftIsDirty(updatedEpisode.starting_entity_states, current.value) ? null : current);
      queryClient.setQueryData<{ episodes: EpisodeRecord[] }>(
        episodesQueryKey(sessionKey, selectedChapter?.id ?? null, organizationId),
        (current) => replaceEpisodeInResponse(current, updatedEpisode)
      );
      setStaleResource((current) =>
        current?.kind === 'episode' && current.id === selectedEpisode?.id ? null : current
      );
      await invalidateEpisodes();
    },
    onError: (error) => {
      if (currentStoryDraftRef.current.scope !== episodeScopeKey) return;
      if (isResourceStaleError(error)) {
        setStaleResource({ id: selectedEpisode?.id ?? '', kind: 'episode' });
      }
    }
  });

  const createSceneMutation = useMutation({
    mutationFn: () =>
      api.createScene(
        selectedEpisode?.id ?? '',
        {
          order: parseIntInRange(sceneOrder, 1, MAX_STORY_ORDER) ?? (scenesQuery.data?.scenes.length ?? 0) + 1,
          location: nullable(sceneLocation),
          time: nullable(sceneTime),
          atmosphere: nullable(sceneAtmosphere),
          involved_entity_ids: sceneEntityIds
        },
        organizationId
      ),
    onSuccess: async (createdScene) => {
      queryClient.setQueryData<{ scenes: SceneRecord[] }>(
        scenesQueryKey(sessionKey, selectedEpisode?.id ?? null, organizationId),
        (current) => upsertSceneInResponse(current, createdScene)
      );
      setSceneId(createdScene.id);
      await invalidateScenes();
    }
  });

  const updateSceneMutation = useMutation({
    mutationFn: () =>
      api.updateScene(
        selectedScene?.id ?? '',
        {
          order: parseIntInRange(sceneOrder, 1, MAX_STORY_ORDER) ?? (selectedScene?.order ?? 1),
          location: nullable(sceneLocation),
          time: nullable(sceneTime),
          atmosphere: nullable(sceneAtmosphere),
          involved_entity_ids: sceneEntityIds,
          status: selectedScene?.status ?? 'draft'
        },
        organizationId
      ),
    onSuccess: async (updatedScene) => {
      queryClient.setQueryData<{ scenes: SceneRecord[] }>(
        scenesQueryKey(sessionKey, selectedEpisode?.id ?? null, organizationId),
        (current) => upsertSceneInResponse(current, updatedScene)
      );
      await invalidateScenes();
    }
  });

  const deleteSceneMutation = useMutation({
    mutationFn: () => api.deleteScene(selectedScene?.id ?? '', organizationId),
    onSuccess: async () => {
      setSceneId(null);
      await invalidateScenes();
    }
  });
  const saveEpisodeMutation = updateEpisodeMutation.mutateAsync;
  const saveNewSceneMutation = createSceneMutation.mutateAsync;
  const saveExistingSceneMutation = updateSceneMutation.mutateAsync;

  const discardStoryDrafts = useCallback((): void => {
    setStartingStateDraft(null);
    setEpisodeTitle(selectedEpisode?.title ?? '');
    setEpisodeDraft(selectedEpisode === null ? '' : episodeMobileDraft(selectedEpisode));
    setEstimatedPages(String(selectedEpisode?.estimated_pages ?? 4));
    setSceneOrder(String(selectedScene?.order ?? (scenesQuery.data?.scenes.length ?? 0) + 1));
    setSceneLocation(selectedScene?.location ?? '');
    setSceneTime(selectedScene?.time ?? '');
    setSceneAtmosphere(selectedScene?.atmosphere ?? '');
    setSceneEntityIds(selectedScene?.involved_entity_ids ?? []);
    setImprovement(null);
    collaborationAbortRef.current?.abort();
    collaborationRequestIdRef.current += 1;
    setCollaborationProposal('');
    setCollaborationError(null);
    setDirtySaveError(null);
  }, [
    scenesQuery.data?.scenes.length,
    selectedEpisode,
    selectedScene,
    setDirtySaveError,
    setEpisodeDraft,
    setEpisodeTitle,
    setEstimatedPages,
    setImprovement,
    setSceneAtmosphere,
    setSceneEntityIds,
    setSceneLocation,
    setSceneOrder,
    setSceneTime,
  ]);

  const saveStoryDrafts = useCallback(async (): Promise<void> => {
    setDirtySaveError(null);
    try {
      if (episodeDirty) {
        if (selectedEpisode === null) {
          throw new Error(t(language, "generated.screens.StoryScreen.select.an.episode.to.save.134a75d1"));
        }
        if (estimatedPagesInvalid) {
          throw new Error(
            t(language, 'screen.story.estimatedPagesOutOfRange', {
              maximum: MAX_ESTIMATED_PAGES
            })
          );
        }
        await saveEpisodeMutation();
      }
      if (sceneDirty) {
        if (selectedEpisode === null) {
          throw new Error(t(language, "generated.screens.StoryScreen.select.an.episode.first.65b38fbb"));
        }
        if (sceneOrderInvalid) {
          throw new Error(
            t(language, 'screen.story.sceneOrderOutOfRange', { maximum: MAX_STORY_ORDER })
          );
        }
        if (selectedScene === null) {
          await saveNewSceneMutation();
        } else {
          await saveExistingSceneMutation();
        }
      }
    } catch (error) {
      if (storyErrorScopeRef.current === storyErrorScope) {
        setDirtySaveError(
          error instanceof Error
            ? error
            : new Error(t(language, "generated.screens.StoryScreen.unsaved.changes.could.not.be.saved.88963a72"))
        );
      }
      throw error;
    }
  }, [
    episodeDirty,
    storyErrorScope,
    estimatedPagesInvalid,
    language,
    sceneDirty,
    sceneOrderInvalid,
    saveEpisodeMutation,
    saveExistingSceneMutation,
    saveNewSceneMutation,
    selectedEpisode,
    selectedScene,
    setDirtySaveError,
  ]);

  useDirtyEditorRegistration({
    id: 'story-editor',
    revision: storyEditorRevision,
    dirty: storyDirty,
    discard: discardStoryDrafts,
    save: saveStoryDrafts
  });

  const saveCurrentEpisode = async (): Promise<void> => {
    if (estimatedPagesInvalid) {
      throw new Error(
        t(language, 'screen.story.estimatedPagesOutOfRange', {
          maximum: MAX_ESTIMATED_PAGES
        })
      );
    }
    await updateEpisodeMutation.mutateAsync();
  };

  const reloadStaleResource = async (): Promise<void> => {
    const stillApproved = (): boolean => currentStoryDraftRef.current.scope === episodeScopeKey &&
      currentStoryDraftRef.current.revision === storyEditorRevision;
    if (!stillApproved()) return;
    if (activeStaleResource === 'episode' && selectedEpisode !== null && selectedChapter !== null) {
      const response = await queryClient.fetchQuery({
        queryKey: episodesQueryKey(sessionKey, selectedChapter.id, organizationId),
        queryFn: () => api.getEpisodes(selectedChapter.id, organizationId),
      });
      if (!stillApproved()) return;
      const latest = response.episodes.find((episode) => episode.id === selectedEpisode.id);
      setStartingStateDraft(null);
      setEpisodeTitle(latest?.title ?? '');
      setEpisodeDraft(latest === undefined ? '' : episodeMobileDraft(latest));
      setEstimatedPages(String(latest?.estimated_pages ?? 4));
      setImprovement(null);
    }
    setStaleResource((current) => current?.kind === activeStaleResource ? null : current);
  };

  const improveEpisodeMutation = useMutation({
    mutationFn: async () => {
      if (selectedEpisode === null) {
        throw new Error(t(language, "generated.screens.StoryScreen.select.an.episode.first.65b38fbb"));
      }
      return runStoryAiAfterEpisodeSave({
        episodeDirty,
        request: () => api.improveEpisodeDraft(
          {
            episode_id: selectedEpisode.id,
            instruction: storyInstruction.trim(),
            language,
            base_draft: {
              title: nullable(episodeTitle),
              purpose: selectedEpisode.purpose ?? null,
              story_input_mode: 'full',
              story_full_draft: nullable(episodeDraft),
              introduction: null,
              middle: null,
              climax: null,
              ending_hook: null
            }
          },
          organizationId
        ),
        save: saveCurrentEpisode,
        selectedEpisodeId: selectedEpisode.id
      });
    },
    onSuccess: setImprovement
  });

  const applyImprovementToDraft = (): void => {
    if (improvement === null) {
      return;
    }
    const improvedStory = extractImprovedFullStory(improvement);
    if (improvedStory.trim().length > 0) {
      setEpisodeDraft(improvedStory);
    }
  };

  const confirmEpisodeImprovement = (): void => {
    confirmAction({
      language,
      title: t(language, 'storyAi'),
      message: appendAiProviderDisclosure(
        t(language, "generated.screens.StoryScreen.improve.the.current.episode.and.apply.it.5fc027c6"),
        language,
        'text'
      ),
      confirmLabel: t(language, 'storyAi'),
      onConfirm: () => improveEpisodeMutation.mutate()
    });
  };

  const collaborationMutation = useMutation({
    mutationFn: async () => {
      if (selectedEpisode === null) {
        return;
      }
      collaborationAbortRef.current?.abort();
      const controller = new AbortController();
      const requestId = collaborationRequestIdRef.current + 1;
      collaborationRequestIdRef.current = requestId;
      collaborationAbortRef.current = controller;
      setCollaborationProposal('');
      setCollaborationError(null);
      try {
        await api.streamStoryCollaboration(
          {
            layer: 'episode',
            target_id: selectedEpisode.id,
            instruction: collaborationInstruction.trim(),
            language,
            context: {
              current_draft: nullable(episodeDraft),
              selected_text: null,
              user_notes: null,
              focus_points: [],
              constraints: []
            }
          },
          {
            onMessage: (data) => {
              if (
                collaborationRequestIdRef.current !== requestId ||
                typeof data !== 'object' ||
                data === null ||
                Array.isArray(data)
              ) {
                return;
              }
              const text = (data as { text?: unknown }).text;
              if (typeof text === 'string') {
                setCollaborationProposal((current) => current + text);
              }
            },
            signal: controller.signal
          },
          organizationId
        );
      } catch (error) {
        if (collaborationRequestIdRef.current === requestId && !isAbortError(error)) {
          setCollaborationError(userErrorMessage(error, language));
        }
      } finally {
        if (collaborationRequestIdRef.current === requestId) {
          collaborationAbortRef.current = null;
        }
      }
    }
  });

  const confirmStoryCollaboration = (): void => {
    confirmAction({
      language,
      title: t(language, 'component.storyCollaboration.request'),
      message: appendAiProviderDisclosure(
        t(language, 'component.storyCollaboration.description'),
        language,
        'text'
      ),
      confirmLabel: t(language, 'component.storyCollaboration.request'),
      onConfirm: () => collaborationMutation.mutate()
    });
  };

  const applyCollaborationProposalToDraft = (): void => {
    if (collaborationProposal.trim().length === 0 || collaborationProposal.length > 8000) {
      return;
    }
    setEpisodeDraft(collaborationProposal);
  };

  const cancelCollaboration = (): void => {
    collaborationAbortRef.current?.abort();
  };

  const confirmDeleteScene = (): void => {
    if (selectedScene === null) {
      return;
    }
    const sceneName = `${t(language, 'scene')} ${selectedScene.order}${
      selectedScene.location === null ? '' : `: ${selectedScene.location}`
    }`;
    confirmDestructiveAction({
      language,
      title: t(language, "generated.screens.StoryScreen.delete.scene.2b9e5ad6"),
      message: t(language, 'screen.story.deleteScene', { sceneName }),
      onConfirm: () => deleteSceneMutation.mutate()
    });
  };

  const switchScene = (nextSceneId: string): void => {
    if (sceneId === nextSceneId) {
      return;
    }
    void (async () => {
      if (await resolveDirtyEditors(language)) {
        setSceneId(nextSceneId);
      }
    })();
  };

  const beginNewSceneDraft = (): void => {
    const action = (): void => {
      setSceneId(null);
      setSceneOrder(String((scenesQuery.data?.scenes.length ?? 0) + 1));
      setSceneLocation('');
      setSceneTime('');
      setSceneAtmosphere('');
      setSceneEntityIds([]);
    };
    void (async () => {
      if (await resolveDirtyEditors(language)) {
        action();
      }
    })();
  };

  useResetOnScopeChange(storyErrorScope, [
    updateEpisodeMutation.reset,
    createSceneMutation.reset,
    updateSceneMutation.reset,
    deleteSceneMutation.reset,
    improveEpisodeMutation.reset,
    () => setDirtySaveError(null)
  ]);

  const storyErrors = collectOperationFailures([
    operationFailure('loadWorks', worksQuery.error),
    operationFailure('loadWorks', selectedWorkQuery.error),
    operationFailure('loadCharacters', entitiesQuery.error),
    operationFailure('loadChapters', chaptersQuery.error),
    operationFailure('loadEpisodes', episodesQuery.error),
    operationFailure('loadScenes', scenesQuery.error),
    operationFailure('saveEpisode', updateEpisodeMutation.error, episodeDirty ? 'episode' : undefined),
    operationFailure('createScene', createSceneMutation.error, sceneDirty ? 'scene' : undefined),
    operationFailure('saveScene', updateSceneMutation.error, sceneDirty ? 'scene' : undefined),
    operationFailure('deleteScene', deleteSceneMutation.error, sceneDirty ? 'scene' : undefined),
    operationFailure('saveStoryDrafts', dirtySaveError, episodeDirty || sceneDirty ? 'story' : undefined),
    operationFailure('improveEpisode', improveEpisodeMutation.error, episodeDirty ? 'episode' : undefined)
  ]).filter((failure) => failure.error !== workspaceContext.error);

  const refreshing =
    worksQuery.isFetching ||
    entitiesQuery.isFetching ||
    chaptersQuery.isFetching ||
    episodesQuery.isFetching ||
    scenesQuery.isFetching;
  const refreshStory = (): void => {
    void invalidateWorks();
    void invalidateEntities();
    void invalidateChapters();
    void invalidateEpisodes();
    void invalidateScenes();
  };
  const navigateAfterDirtyCheck = (target: 'Account' | 'Characters'): void => {
    if (target === 'Characters' && onOpenCharacters !== undefined) {
      onOpenCharacters();
      return;
    }
    void resolveDirtyEditors(language).then((canLeave) => {
      if (canLeave && navigationRef.isReady()) {
        navigationRef.navigate(target);
      }
    });
  };

  return (
    <Screen
      onRefresh={refreshStory}
      refreshing={refreshing}
      title={editorMessage(language, 'storyTitle')}
    >
      {!canEdit ? (
        <Notice
          message={t(language, "generated.screens.StoryScreen.this.workspace.is.read.only.for.your.rol.44102b53")}
          tone="info"
        />
      ) : null}
      {storyErrors.map((failure, index) => (
        <ActionableErrorNotice
          key={`${failure.context.operation}-${index}`}
          actions={{
            characters: () => navigateAfterDirtyCheck('Characters'),
            credits: () => navigateAfterDirtyCheck('Account'),
            jobs: () => navigateAfterDirtyCheck('Account'),
            login: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave) {
                  void logout();
                }
              });
            },
            retry: refreshStory,
            workspace: () => navigateAfterDirtyCheck('Account')
          }}
          context={failure.context}
          error={failure.error}
          language={language}
          retryMode="refresh"
        />
      ))}
      {activeStaleResource === null ? null : (
        <View style={styles.buttonRow}>
          <Notice
            message={t(language, "generated.screens.StoryScreen.your.draft.is.preserved.reloading.the.la.613ed976")}
            tone="warning"
          />
          <PrimaryButton
            label={t(language, "generated.screens.StoryScreen.reload.latest.state.327b1d0e")}
            onPress={() => confirmStaleDraftReload({ language, scope: 'story', onConfirm: () => { void reloadStaleResource(); } })}
            variant="secondary"
          />
        </View>
      )}
      <WorkspaceHierarchyNavigator context={workspaceContext} />

      <Section collapsible persistKey="story:episode" title={editorMessage(language, 'storyEntry')}>
        {selectedEpisode === null ? (
          <Notice message={t(language, "generated.screens.StoryScreen.select.an.episode.from.the.hierarchy.874ba80d")} tone="info" />
        ) : (
          <>
            <FormField editable={canEdit} label={t(language, 'title')} placeholder={editorMessage(language, 'titleExample')} help={editorMessage(language, 'titleHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} maxLength={200} onChangeText={setEpisodeTitle} value={episodeTitle} />
            <FormField editable={canEdit} label={t(language, 'fullDraft')} placeholder={editorMessage(language, 'storyExample')} help={editorMessage(language, 'storyInputHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} maxLength={8000} multiline multilineMaxHeight={260} onChangeText={setEpisodeDraft} value={episodeDraft} />
            <FormField editable={canEdit} keyboardType="numeric" label={t(language, 'estimatedPages')} placeholder={editorMessage(language, 'pagesExample')} help={editorMessage(language, 'pagesHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} onChangeText={setEstimatedPages} value={estimatedPages} />
            {estimatedPagesInvalid ? <Notice message={t(language, "generated.screens.StoryScreen.estimated.pages.must.be.a.number.from.1.20301ed5")} tone="warning" /> : null}
            <View style={styles.buttonRow}>
              <PrimaryButton disabled={!canEdit || activeStaleResource === 'episode' || estimatedPagesInvalid || episodeTitle.trim().length === 0} label={t(language, 'save')} loading={updateEpisodeMutation.isPending} onPress={() => updateEpisodeMutation.mutate()} variant="secondary" />
            </View>
          </>
        )}
      </Section>

      {selectedEpisode !== null && (startingStatesEnabled || (selectedEpisode.starting_entity_states?.length ?? 0) > 0) ? (
        <EpisodeStartingStatesEditor
          language={language}
          entities={entities}
          value={startingEntityStatesDraft ?? selectedEpisode.starting_entity_states ?? []}
          onChange={(value) => setStartingStateDraft({ scopeKey: episodeScopeKey, value })}
          disabled={!canEdit || !startingStatesEnabled || activeStaleResource === 'episode' || updateEpisodeMutation.isPending}
          hasMoreEntities={entitiesQuery.hasNextPage}
          loadingEntities={entitiesQuery.isFetchingNextPage}
          onLoadMoreEntities={() => { void entitiesQuery.fetchNextPage(); }}
        />
      ) : null}

      <Section collapsible mobileDefaultCollapsed persistKey="story:story-ai" subtitle={editorMessage(language, 'storyAiHelp')} title={editorMessage(language, 'storyAi')}>
        <EpisodeImprovementPanel
          canEdit={canEdit}
          improvement={improvement}
          improveLoading={improveEpisodeMutation.isPending || updateEpisodeMutation.isPending}
          instruction={storyInstruction}
          language={language}
          onApply={applyImprovementToDraft}
          onImprove={confirmEpisodeImprovement}
          onImprovementChange={(value) =>
            setImprovement((current) =>
              current === null
                ? null
                : {
                    ...current,
                    draft: {
                      ...current.draft,
                      story_input_mode: 'full',
                      story_full_draft: nullable(value),
                      introduction: null,
                      middle: null,
                      climax: null,
                      ending_hook: null
                    }
                  }
            )
          }
          onInstructionChange={setStoryInstruction}
          selectedEpisode={selectedEpisode !== null}
        />
        <StoryCollaborationPanel
          canEdit={canEdit}
          error={collaborationError}
          instruction={collaborationInstruction}
          language={language}
          loading={collaborationMutation.isPending}
          onApply={applyCollaborationProposalToDraft}
          onCancel={cancelCollaboration}
          onInstructionChange={setCollaborationInstruction}
          onRequest={confirmStoryCollaboration}
          proposal={collaborationProposal}
          reportContentId={selectedEpisode?.id}
          selectedEpisode={selectedEpisode !== null}
        />
      </Section>

      <Section
        collapsible
        defaultCollapsed
        persistKey="story:scenes"
        title={editorMessage(language, 'scenes')}
      >
        <RecordPicker
          emptyLabel={t(language, 'emptyScenes')}
          items={scenesQuery.data?.scenes ?? []}
          language={language}
          labelForItem={(scene) => `${t(language, 'scene')} ${scene.order}${scene.location === null ? '' : `: ${scene.location}`}`}
          onSelect={switchScene}
          selectedId={sceneId}
        />
        {selectedScene === null ? (
          <Notice message={t(language, "generated.screens.StoryScreen.you.are.creating.a.new.scene.fill.the.fi.954a6862")} tone="info" />
        ) : (
          <PrimaryButton disabled={!canEdit || createSceneMutation.isPending || updateSceneMutation.isPending} label={t(language, "generated.screens.StoryScreen.create.a.new.scene.5a7af1dc")} onPress={beginNewSceneDraft} variant="ghost" />
        )}
        <FormField keyboardType="numeric" label={t(language, "generated.screens.StoryScreen.order.da168b36")} placeholder={editorMessage(language, 'orderExample')} help={editorMessage(language, 'orderHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} onChangeText={setSceneOrder} value={sceneOrder} />
        {sceneOrderInvalid ? <Notice message={t(language, "generated.screens.StoryScreen.order.must.be.a.number.from.1.to.1000.c52e4fa8")} tone="warning" /> : null}
        <FormField label={t(language, 'location')} placeholder={editorMessage(language, 'locationExample')} help={editorMessage(language, 'locationHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} maxLength={200} onChangeText={setSceneLocation} value={sceneLocation} />
        <FormField label={t(language, 'time')} placeholder={editorMessage(language, 'timeExample')} help={editorMessage(language, 'timeHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} maxLength={200} onChangeText={setSceneTime} value={sceneTime} />
        <FormField label={t(language, 'atmosphere')} placeholder={editorMessage(language, 'atmosphereExample')} help={editorMessage(language, 'atmosphereHelp')} helpDisclosureLabel={editorMessage(language, 'fieldHelp')} maxLength={2000} multiline onChangeText={setSceneAtmosphere} value={sceneAtmosphere} />
        <View style={styles.buttonRow}>
          <PrimaryButton disabled={!canEdit || selectedEpisode === null || selectedScene !== null || scenesQuery.isLoading || sceneOrderInvalid || updateSceneMutation.isPending} disabledReason={!canEdit ? t(language, "generated.screens.StoryScreen.editing.permission.is.required.6d3b86ee") : selectedEpisode === null ? t(language, "generated.screens.StoryScreen.select.an.episode.first.437356a6") : selectedScene !== null ? t(language, "generated.screens.StoryScreen.choose.create.a.new.scene.first.754b6b6c") : sceneOrderInvalid ? t(language, "generated.screens.StoryScreen.check.order.2ff9d500") : undefined} label={t(language, 'createScene')} loading={createSceneMutation.isPending} onPress={() => createSceneMutation.mutate()} variant="secondary" />
          <PrimaryButton disabled={!canEdit || selectedScene === null || sceneOrderInvalid || createSceneMutation.isPending} disabledReason={!canEdit ? t(language, "generated.screens.StoryScreen.editing.permission.is.required.6d3b86ee") : selectedScene === null ? t(language, "generated.screens.StoryScreen.select.a.scene.to.save.63d8c002") : sceneOrderInvalid ? t(language, "generated.screens.StoryScreen.check.order.2ff9d500") : undefined} label={t(language, 'saveScene')} loading={updateSceneMutation.isPending} onPress={() => updateSceneMutation.mutate()} variant="secondary" />
          <PrimaryButton disabled={!canEdit || selectedScene === null} disabledReason={!canEdit ? t(language, "generated.screens.StoryScreen.editing.permission.is.required.6d3b86ee") : selectedScene === null ? t(language, "generated.screens.StoryScreen.select.a.scene.to.delete.ec3b0582") : undefined} label={t(language, "generated.screens.StoryScreen.delete.scene.19681cb7")} loading={deleteSceneMutation.isPending} onPress={confirmDeleteScene} variant="danger" />
        </View>
      </Section>

    </Screen>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  caption: {
    ...textStyles.caption
  },
  chip: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18
  },
  chipLabelSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chipSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.14)',
    borderColor: 'rgba(229, 199, 107, 0.42)'
  },
  emptySmall: {
    ...textStyles.caption,
    color: colors.muted
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  result: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  resultText: {
    ...textStyles.body
  },
  resultTitle: {
    ...textStyles.body,
    fontWeight: '700'
  }
});
