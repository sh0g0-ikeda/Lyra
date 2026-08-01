import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { PagePlanningSection } from '../components/PagePlanningSection';
import {
  PageSettingsSection,
  type PageSettingsApiPort,
  type PageSettingsSectionHandle,
} from '../components/PageSettingsSection';
import {
  PanelEditingSection,
  type PanelEditingApiPort,
  type PanelEditingSectionHandle,
} from '../components/PanelEditingSection';
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
  type GeneratePageSkeletonInput,
  type GenerationJobRecord,
  type ListJobsPageInput,
  type ListWorksPageInput,
  type PageRecord,
  type PageJobAcceptedResponse,
  type PageSkeletonResponse,
  type SceneRecord,
  type UpdateSceneInput,
  type WorkRecord,
} from '../lib/api';
import { showDirtyStoryPrompt, type DirtyStoryAction } from '../lib/dirtyStoryPrompt';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';

const MAX_SCENE_ORDER = 1000;

type EpisodePlanningJobType = 'episode_page_skeleton' | 'episode_story_autofill';
type EpisodePlanningJobRecord = Extract<
  GenerationJobRecord,
  { job_type: 'episode_page_skeleton' }
> | Extract<
  GenerationJobRecord,
  { job_type: 'episode_story_autofill' }
>;

export interface PagesScreenHandle {
  prepareToLeave(): Promise<boolean>;
}

export interface PagesApiPort extends PanelEditingApiPort, PageSettingsApiPort {
  autofillEpisodePagesFromStory(
    episodeId: string,
    language: UiLanguage,
    organizationId?: string | null,
  ): Promise<PageJobAcceptedResponse>;
  createScene(
    episodeId: string,
    body: CreateSceneInput,
    organizationId?: string | null,
  ): Promise<SceneRecord>;
  generatePageSkeleton(
    episodeId: string,
    body: GeneratePageSkeletonInput,
    organizationId?: string | null,
  ): Promise<PageSkeletonResponse>;
  getChapters(
    workId: string,
    organizationId?: string | null,
  ): Promise<{ chapters: ChapterRecord[] }>;
  getEpisodes(
    chapterId: string,
    organizationId?: string | null,
  ): Promise<{ episodes: EpisodeRecord[] }>;
  getJob(
    jobId: string,
    organizationId?: string | null,
  ): Promise<GenerationJobRecord>;
  getJobs(
    input: ListJobsPageInput,
    organizationId?: string | null,
  ): Promise<{ jobs: GenerationJobRecord[]; next_cursor: string | null }>;
  getPages(
    episodeId: string,
    organizationId?: string | null,
  ): Promise<{ pages: PageRecord[]; next_cursor?: string | null }>;
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
  jobPollIntervalMs?: number;
  language: UiLanguage;
  organizationId: string | null;
  resolveDirtyAction?: () => Promise<DirtyStoryAction>;
  sessionKey: string;
}

export const PagesScreen = forwardRef<PagesScreenHandle, PagesScreenProps>(
  function PagesScreen({
    api,
    jobPollIntervalMs = 8_000,
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
    const [trackedJob, setTrackedJob] = useState<{
      episodeId: string;
      jobId: string;
      jobType: EpisodePlanningJobType;
    } | null>(null);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [generationNotice, setGenerationNotice] = useState<string | null>(null);
    const [jobStatusCheckFailed, setJobStatusCheckFailed] = useState(false);
    const [panelStructureActive, setPanelStructureActive] = useState(false);
    const pageOperation = useRef<Promise<boolean> | null>(null);
    const transitionOperation = useRef<Promise<boolean> | null>(null);
    const pageSettingsRef = useRef<PageSettingsSectionHandle>(null);
    const panelEditingRef = useRef<PanelEditingSectionHandle>(null);
    const handledTerminalJobIds = useRef(new Set<string>());
    const jobsPollInFlight = useRef(false);
    const jobPollInFlight = useRef(false);

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
    const pagesQuery = useQuery({
      enabled: selectedEpisode !== null,
      queryKey: selectedEpisode === null
        ? [...queryKeys.works(), 'page-list-disabled']
        : queryKeys.pages(selectedEpisode.id),
      queryFn: () => api.getPages(selectedEpisode!.id, organizationId),
    });
    const trackedJobMatchesSelection = trackedJob !== null
      && trackedJob.episodeId === selectedEpisode?.id;
    const jobsQuery = useQuery({
      enabled: selectedEpisode !== null,
      queryKey: selectedEpisode === null
        ? [...queryKeys.works(), 'page-jobs-disabled']
        : [...queryKeys.jobs(), selectedEpisode.id],
      queryFn: () => api.getJobs({ limit: 50 }, organizationId),
      staleTime: 0,
    });
    const jobQuery = useQuery({
      enabled: trackedJobMatchesSelection,
      queryKey: trackedJobMatchesSelection
        ? queryKeys.job(trackedJob.jobId)
        : [...queryKeys.works(), 'page-job-disabled'],
      queryFn: () => api.getJob(trackedJob!.jobId, organizationId),
      staleTime: 0,
    });
    const refetchJobs = jobsQuery.refetch;
    const refetchJob = jobQuery.refetch;
    const refetchPages = pagesQuery.refetch;

    const works = worksQuery.data?.works ?? [];
    const chapters = chaptersQuery.data?.chapters ?? [];
    const episodes = useMemo(
      () => episodesQuery.data?.episodes ?? [],
      [episodesQuery.data?.episodes],
    );
    const scenes = useMemo(
      () => sortScenes(scenesQuery.data?.scenes ?? []),
      [scenesQuery.data?.scenes],
    );
    const pages = useMemo(
      () => sortPages(pagesQuery.data?.pages ?? []),
      [pagesQuery.data?.pages],
    );
    const historyActiveJob = selectedEpisode === null
      ? undefined
      : jobsQuery.data?.jobs.find(
        (job) => isActiveJob(job)
          && isEpisodePlanningJob(job, selectedEpisode.id)
          && !handledTerminalJobIds.current.has(job.id),
      );
    const exactActiveJob = trackedJobMatchesSelection
      && selectedEpisode !== null
      && isActiveJob(jobQuery.data)
      && isEpisodePlanningJob(jobQuery.data, selectedEpisode.id)
      ? jobQuery.data ?? null
      : null;
    const activeJob = exactActiveJob ?? historyActiveJob ?? null;
    const generationActive = historyActiveJob !== undefined || (trackedJobMatchesSelection
      && (
        jobQuery.data === undefined
        || (
          selectedEpisode !== null
          && isActiveJob(jobQuery.data)
          && isEpisodePlanningJob(jobQuery.data, selectedEpisode.id)
        )
      ));
    const panelEditingBlocked = generationActive
      || jobsQuery.isLoading
      || jobsQuery.isFetching
      || jobsQuery.isError
      || pagesQuery.isLoading
      || pagesQuery.isFetching
      || pagesQuery.isError;
    const normalizedJobPollIntervalMs = Math.max(1, Math.trunc(jobPollIntervalMs));
    const sceneDirty = savedSceneDraft !== null
      && sceneDraft !== null
      && isSceneDraftDirty(savedSceneDraft, sceneDraft);

    useEffect(() => {
      if (
        selectedEpisode === null
        || trackedJobMatchesSelection
      ) {
        return;
      }
      const intervalId = setInterval(() => {
        if (
          focusManager.isFocused()
          && !jobsQuery.isFetching
          && !jobsPollInFlight.current
        ) {
          jobsPollInFlight.current = true;
          void refetchJobs().finally(() => {
            jobsPollInFlight.current = false;
          });
        }
      }, normalizedJobPollIntervalMs);
      return () => clearInterval(intervalId);
    }, [
      jobsQuery.isFetching,
      normalizedJobPollIntervalMs,
      refetchJobs,
      selectedEpisode,
      trackedJobMatchesSelection,
    ]);

    useEffect(() => {
      if (!generationActive || !trackedJobMatchesSelection) {
        return;
      }
      const intervalId = setInterval(() => {
        if (
          focusManager.isFocused()
          && !jobQuery.isFetching
          && !jobPollInFlight.current
        ) {
          jobPollInFlight.current = true;
          void refetchJob().finally(() => {
            jobPollInFlight.current = false;
          });
        }
      }, normalizedJobPollIntervalMs);
      return () => clearInterval(intervalId);
    }, [
      generationActive,
      jobQuery.isFetching,
      normalizedJobPollIntervalMs,
      refetchJob,
      trackedJobMatchesSelection,
    ]);

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

    useEffect(() => {
      if (selectedEpisode === null) {
        return;
      }
      const refreshedEpisode = episodes.find(
        (candidate) => candidate.id === selectedEpisode.id,
      );
      if (refreshedEpisode !== undefined && refreshedEpisode !== selectedEpisode) {
        setSelectedEpisode(refreshedEpisode);
      }
    }, [episodes, selectedEpisode]);

    useEffect(() => {
      if (selectedEpisode === null || jobsQuery.data === undefined) {
        return;
      }
      setTrackedJob((current) => {
        if (current?.episodeId === selectedEpisode.id) {
          return current;
        }
        const recovered = jobsQuery.data.jobs.find(
          (job) => isActiveJob(job)
            && isEpisodePlanningJob(job, selectedEpisode.id)
            && !handledTerminalJobIds.current.has(job.id),
        );
        const recoveredJobType = recovered === undefined
          ? null
          : readEpisodePlanningJobType(recovered);
        return recovered === undefined || recoveredJobType === null
          ? null
          : {
              episodeId: selectedEpisode.id,
              jobId: recovered.id,
              jobType: recoveredJobType,
            };
      });
    }, [jobsQuery.data, selectedEpisode]);

    useEffect(() => {
      const job = jobQuery.data;
      if (
        selectedEpisode === null
        || trackedJob === null
        || trackedJob.episodeId !== selectedEpisode.id
        || job === undefined
      ) {
        return;
      }
      if (!matchesTrackedPlanningJob(job, trackedJob)) {
        handledTerminalJobIds.current.add(job.id);
        setGenerationNotice(null);
        setGenerationError(t(language, 'pageJobStatusError'));
        setTrackedJob(null);
        return;
      }
      if (isActiveJob(job)) {
        setJobStatusCheckFailed(false);
        setGenerationError(null);
        return;
      }
      if (handledTerminalJobIds.current.has(job.id)) {
        return;
      }
      handledTerminalJobIds.current.add(job.id);
      setGenerationError(
        job.status === 'failed'
          ? t(language, planningJobMessageKey(job.job_type, 'failed'))
          : null,
      );
      setGenerationNotice(
        job.status === 'completed'
          ? t(language, planningJobMessageKey(job.job_type, 'completed'))
          : job.status === 'cancelled'
            ? t(language, planningJobMessageKey(job.job_type, 'cancelled'))
            : null,
      );
      setTrackedJob(null);
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.pages(selectedEpisode.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.panelLists(),
      });
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.episodes(selectedEpisode.chapter_id),
      });
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: [...queryKeys.jobs(), selectedEpisode.id],
      });
    }, [jobQuery.data, language, queryClient, queryKeys, selectedEpisode, trackedJob]);

    useEffect(() => {
      if (
        !jobQuery.isError
        || !(jobQuery.error instanceof ApiError)
        || jobQuery.error.status !== 404
        || selectedEpisode === null
        || trackedJob === null
      ) {
        return;
      }
      setGenerationNotice(null);
      setJobStatusCheckFailed(false);
      setGenerationError(t(language, 'pageJobStatusError'));
      handledTerminalJobIds.current.add(trackedJob.jobId);
      setTrackedJob(null);
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.pages(selectedEpisode.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.panelLists(),
      });
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.episodes(selectedEpisode.chapter_id),
      });
    }, [jobQuery.error, jobQuery.isError, language, queryClient, queryKeys, selectedEpisode, trackedJob]);

    const runPageOperation = useCallback((task: () => Promise<boolean>): Promise<boolean> => {
      if (pageOperation.current !== null) {
        return pageOperation.current;
      }
      setSceneBusy(true);
      let operation: Promise<boolean> | null = null;
      operation = (async (): Promise<boolean> => {
        try {
          return await Promise.resolve().then(task);
        } finally {
          setSceneBusy(false);
          if (operation !== null && pageOperation.current === operation) {
            pageOperation.current = null;
          }
        }
      })();
      pageOperation.current = operation;
      return operation;
    }, []);

    const saveCurrentScene = useCallback((): Promise<boolean> => {
      if (pageOperation.current !== null) {
        return pageOperation.current;
      }
      if (
        generationActive
        || jobsQuery.isLoading
        || jobsQuery.isFetching
        || jobsQuery.isError
      ) {
        return Promise.resolve(false);
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
      return runPageOperation(async () => {
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
      generationActive,
      jobsQuery.isError,
      jobsQuery.isFetching,
      jobsQuery.isLoading,
      organizationId,
      queryClient,
      queryKeys,
      runPageOperation,
      savedSceneDraft,
      sceneDraft,
      sceneDirty,
      selectedEpisode,
      selectedSceneId,
    ]);

    const resolvePendingScene = useCallback(async (): Promise<boolean> => {
      if (pageOperation.current !== null) {
        return pageOperation.current;
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
        setSceneDraft(savedSceneDraft);
        return true;
      }
      return saveCurrentScene();
    }, [language, resolveDirtyAction, saveCurrentScene, savedSceneDraft, sceneDirty]);

    const resolvePendingPanel = useCallback(async (): Promise<boolean> => (
      panelEditingRef.current?.prepareToLeave() ?? true
    ), []);

    const resolvePendingPageSettings = useCallback(async (): Promise<boolean> => (
      pageSettingsRef.current?.prepareToLeave() ?? true
    ), []);

    const resolvePendingChanges = useCallback(async (): Promise<boolean> => {
      if (!(await resolvePendingScene())) {
        return false;
      }
      if (!(await resolvePendingPageSettings())) {
        return false;
      }
      return resolvePendingPanel();
    }, [resolvePendingPageSettings, resolvePendingPanel, resolvePendingScene]);

    useImperativeHandle(ref, () => ({
      prepareToLeave: resolvePendingChanges,
    }), [resolvePendingChanges]);

    const transition = useCallback((
      changeSelection: () => void | boolean | Promise<void | boolean>,
      includePageAndPanel = true,
    ): Promise<boolean> => {
      if (transitionOperation.current !== null) {
        return transitionOperation.current;
      }
      const operation = (async (): Promise<boolean> => {
        if (!(await resolvePendingScene())) {
          return false;
        }
        if (includePageAndPanel) {
          if (!(await resolvePendingPageSettings())) {
            return false;
          }
          if (!(await resolvePendingPanel())) {
            return false;
          }
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
    }, [resolvePendingPageSettings, resolvePendingPanel, resolvePendingScene]);

    const refreshPagesForSettings = useCallback(async (): Promise<readonly PageRecord[]> => {
      const result = await refetchPages();
      if (result.isError || result.data === undefined) {
        throw new Error('PAGE_REFRESH_FAILED');
      }
      return sortPages(result.data.pages);
    }, [refetchPages]);

    const createScene = useCallback((): Promise<boolean> => transition(async () => {
      if (
        selectedEpisode === null
        || generationActive
        || jobsQuery.isLoading
        || jobsQuery.isFetching
        || jobsQuery.isError
      ) {
        return false;
      }
      const initialOrder = nextSceneOrder(scenes);
      if (initialOrder === null) {
        setSceneError(t(language, 'sceneOrderLimit'));
        return false;
      }
      return runPageOperation(async () => {
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
    }, false), [
      api,
      applySelectedScene,
      language,
      generationActive,
      jobsQuery.isError,
      jobsQuery.isFetching,
      jobsQuery.isLoading,
      organizationId,
      queryClient,
      queryKeys,
      runPageOperation,
      scenes,
      scenesQuery,
      selectedEpisode,
      transition,
    ]);

    const trackQueuedPlanningJob = useCallback(async (
      episodeRecord: EpisodeRecord,
      accepted: PageJobAcceptedResponse,
      jobType: EpisodePlanningJobType,
    ): Promise<void> => {
      const nextTrackedJob = {
        episodeId: episodeRecord.id,
        jobId: accepted.job_id,
        jobType,
      };
      handledTerminalJobIds.current.delete(accepted.job_id);
      setTrackedJob(nextTrackedJob);
      setGenerationNotice(t(language, planningJobMessageKey(jobType, 'queued')));
      try {
        const initialJob = await queryClient.fetchQuery({
          queryFn: () => api.getJob(accepted.job_id, organizationId),
          queryKey: queryKeys.job(accepted.job_id),
        });
        setJobStatusCheckFailed(false);
        if (!matchesTrackedPlanningJob(initialJob, nextTrackedJob)) {
          handledTerminalJobIds.current.add(initialJob.id);
          setTrackedJob(null);
          setGenerationNotice(null);
          setGenerationError(t(language, 'pageJobStatusError'));
          return;
        }
        if (isActiveJob(initialJob)) {
          return;
        }
        handledTerminalJobIds.current.add(initialJob.id);
        setTrackedJob(null);
        setGenerationError(
          initialJob.status === 'failed'
            ? t(language, planningJobMessageKey(jobType, 'failed'))
            : null,
        );
        setGenerationNotice(
          initialJob.status === 'completed'
            ? t(language, planningJobMessageKey(jobType, 'completed'))
            : initialJob.status === 'cancelled'
              ? t(language, planningJobMessageKey(jobType, 'cancelled'))
              : null,
        );
        await Promise.all([
          pagesQuery.refetch(),
          episodesQuery.refetch(),
          refetchJobs(),
          queryClient.invalidateQueries({ queryKey: queryKeys.panelLists() }),
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 404) {
          handledTerminalJobIds.current.add(accepted.job_id);
          setTrackedJob(null);
          setGenerationNotice(null);
          setGenerationError(t(language, 'pageJobStatusError'));
          await Promise.all([
            pagesQuery.refetch(),
            episodesQuery.refetch(),
            refetchJobs(),
            queryClient.invalidateQueries({ queryKey: queryKeys.panelLists() }),
          ]);
          return;
        }
        setJobStatusCheckFailed(true);
      }
    }, [
      api,
      episodesQuery,
      language,
      organizationId,
      pagesQuery,
      queryClient,
      queryKeys,
      refetchJobs,
    ]);

    const recoverPlanningJobFromHistory = useCallback(async (
      episodeId: string,
    ): Promise<boolean> => {
      try {
        const refreshed = await refetchJobs();
        const recovered = refreshed.data?.jobs.find(
          (job) => isActiveJob(job)
            && isEpisodePlanningJob(job, episodeId)
            && !handledTerminalJobIds.current.has(job.id),
        );
        if (recovered === undefined) {
          return false;
        }
        const recoveredJobType = readEpisodePlanningJobType(recovered);
        if (recoveredJobType === null) {
          return false;
        }
        setTrackedJob({
          episodeId,
          jobId: recovered.id,
          jobType: recoveredJobType,
        });
        setGenerationNotice(
          t(language, planningJobMessageKey(recoveredJobType, 'queued')),
        );
        setGenerationError(null);
        setJobStatusCheckFailed(false);
        return true;
      } catch {
        return false;
      }
    }, [language, refetchJobs]);

    const generatePageSkeleton = useCallback((): Promise<boolean> => transition(async () => {
      if (
        selectedEpisode === null
        || pagesQuery.isLoading
        || pagesQuery.isError
        || jobsQuery.isLoading
        || jobsQuery.isFetching
        || jobsQuery.isError
        || generationActive
        || pages.length > 0
        || selectedEpisode.page_skeleton_generated
      ) {
        return false;
      }
      return runPageOperation(async () => {
        setGenerationError(null);
        setGenerationNotice(null);
        try {
          const response = await api.generatePageSkeleton(selectedEpisode.id, {
            apply_story_plan: false,
            language,
            overwrite_existing: false,
          }, organizationId);
          if ('job_id' in response) {
            await trackQueuedPlanningJob(
              selectedEpisode,
              response,
              'episode_page_skeleton',
            );
            return true;
          }
          await Promise.all([
            pagesQuery.refetch(),
            episodesQuery.refetch(),
          ]);
          setGenerationNotice(t(language, 'pageGenerationCompleted'));
          return true;
        } catch {
          setGenerationError(t(language, 'pageGenerationError'));
          return false;
        }
      });
    }), [
      api,
      episodesQuery,
      generationActive,
      jobsQuery.isError,
      jobsQuery.isFetching,
      jobsQuery.isLoading,
      language,
      organizationId,
      pages,
      pagesQuery,
      runPageOperation,
      selectedEpisode,
      trackQueuedPlanningJob,
      transition,
    ]);

    const autofillPagesFromStory = useCallback((): Promise<boolean> => transition(async () => {
      const storyAutofillBlocked = selectedEpisode === null
        || pagesQuery.isLoading
        || pagesQuery.isError
        || jobsQuery.isLoading
        || jobsQuery.isFetching
        || jobsQuery.isError
        || generationActive
        || pages.length === 0
        || pages.length > 32
        || pages.some((pageRecord) => (
          pageRecord.status === 'confirmed'
          || pageRecord.status === 'generating'
          || pageRecord.frame_count === 0
          || pageRecord.panel_count !== pageRecord.frame_count
        ));
      if (storyAutofillBlocked || selectedEpisode === null) {
        return false;
      }
      return runPageOperation(async () => {
        setGenerationError(null);
        setGenerationNotice(null);
        try {
          const accepted = await api.autofillEpisodePagesFromStory(
            selectedEpisode.id,
            language,
            organizationId,
          );
          await trackQueuedPlanningJob(
            selectedEpisode,
            accepted,
            'episode_story_autofill',
          );
          return true;
        } catch {
          if (await recoverPlanningJobFromHistory(selectedEpisode.id)) {
            return true;
          }
          setGenerationError(t(language, 'pageStoryAutofillError'));
          return false;
        }
      });
    }), [
      api,
      generationActive,
      jobsQuery.isError,
      jobsQuery.isFetching,
      jobsQuery.isLoading,
      language,
      organizationId,
      pages,
      pagesQuery.isError,
      pagesQuery.isLoading,
      recoverPlanningJobFromHistory,
      runPageOperation,
      selectedEpisode,
      trackQueuedPlanningJob,
      transition,
    ]);

    const clearGenerationSelection = (): void => {
      setTrackedJob(null);
      setGenerationError(null);
      setGenerationNotice(null);
      setJobStatusCheckFailed(false);
    };

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
                clearGenerationSelection();
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
                  clearGenerationSelection();
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
                  clearGenerationSelection();
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
          <PagePlanningSection
            activeJob={activeJob}
            episodeGenerated={selectedEpisode.page_skeleton_generated}
            generationActive={generationActive}
            generationBusy={
              sceneBusy
              || generationActive
              || jobsQuery.isLoading
              || jobsQuery.isFetching
              || jobsQuery.isError
            }
            generationError={generationError}
            generationNotice={generationNotice}
            jobStatusError={
              jobsQuery.isError
              || jobQuery.isError
              || jobStatusCheckFailed
            }
            language={language}
            loading={pagesQuery.isLoading}
            loadError={pagesQuery.isError}
            onAutofill={() => void autofillPagesFromStory()}
            onGenerate={() => void generatePageSkeleton()}
            onRetryJob={() => {
              if (trackedJobMatchesSelection) {
                setJobStatusCheckFailed(false);
                void jobQuery.refetch();
                return;
              }
              void jobsQuery.refetch();
            }}
            onRetryPages={() => void pagesQuery.refetch()}
            pages={pages}
          />
        )}
        {selectedEpisode === null ? null : (
          <PageSettingsSection
            api={api}
            editingBlocked={panelEditingBlocked || panelStructureActive}
            episodeId={selectedEpisode.id}
            language={language}
            organizationId={organizationId}
            pageListReady={pagesQuery.data !== undefined}
            pages={pages}
            ref={pageSettingsRef}
            refreshPages={refreshPagesForSettings}
            resolveDirtyAction={resolveDirtyAction}
            scenes={scenes}
            sessionKey={sessionKey}
          />
        )}
        {selectedEpisode === null ? null : (
          <PanelEditingSection
            api={api}
            generationActive={panelEditingBlocked}
            language={language}
            organizationId={organizationId}
            onStructureActiveChange={setPanelStructureActive}
            pageListReady={pagesQuery.data !== undefined}
            pages={pages}
            preparePageSettings={resolvePendingPageSettings}
            ref={panelEditingRef}
            refreshPages={refreshPagesForSettings}
            resolveDirtyAction={resolveDirtyAction}
            sessionKey={sessionKey}
            workId={selectedWorkId!}
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
                  void transition(() => applySelectedScene(scene), false);
                }
              }}
              retryLabel={t(language, 'retry')}
              selectedId={selectedSceneId}
              selectSuffix={t(language, 'storySelectSuffix')}
            />
            <PrimaryButton
              disabled={
                sceneBusy
                || generationActive
                || jobsQuery.isLoading
                || jobsQuery.isFetching
                || jobsQuery.isError
                || scenesQuery.isFetching
              }
              label={t(language, 'sceneAdd')}
              onPress={() => void createScene()}
            />
            {sceneDraft === null ? (
              sceneError === null ? null : <Text style={styles.error}>{sceneError}</Text>
            ) : (
              <SceneEditor
                busy={sceneBusy || generationActive}
                dirty={sceneDirty}
                draft={sceneDraft}
                errorMessage={sceneError}
                language={language}
                noticeMessage={sceneNotice}
                saveDisabled={
                  jobsQuery.isLoading
                  || jobsQuery.isFetching
                  || jobsQuery.isError
                }
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

function sortPages(pages: readonly PageRecord[]): PageRecord[] {
  return [...pages].sort(
    (left, right) => left.page_number - right.page_number || left.id.localeCompare(right.id),
  );
}

function isActiveJob(
  job: GenerationJobRecord | undefined,
): job is GenerationJobRecord & { status: 'queued' | 'processing' } {
  return job?.status === 'queued' || job?.status === 'processing';
}

function isEpisodePlanningJob(
  job: GenerationJobRecord,
  episodeId: string,
): job is EpisodePlanningJobRecord {
  return (
    job.job_type === 'episode_page_skeleton'
    || job.job_type === 'episode_story_autofill'
  ) && job.params.episode_id === episodeId;
}

function readEpisodePlanningJobType(
  job: GenerationJobRecord,
): EpisodePlanningJobType | null {
  if (
    job.job_type === 'episode_page_skeleton'
    || job.job_type === 'episode_story_autofill'
  ) {
    return job.job_type;
  }
  return null;
}

function matchesTrackedPlanningJob(
  job: GenerationJobRecord,
  trackedJob: {
    episodeId: string;
    jobId: string;
    jobType: EpisodePlanningJobType;
  },
): job is EpisodePlanningJobRecord {
  return job.id === trackedJob.jobId
    && job.job_type === trackedJob.jobType
    && isEpisodePlanningJob(job, trackedJob.episodeId);
}

function planningJobMessageKey(
  jobType: EpisodePlanningJobType,
  state: 'queued' | 'completed' | 'failed' | 'cancelled',
): MessageKey {
  const skeletonKeys: Record<typeof state, MessageKey> = {
    cancelled: 'pageGenerationCancelled',
    completed: 'pageGenerationCompleted',
    failed: 'pageGenerationFailed',
    queued: 'pageGenerationQueued',
  };
  const storyAutofillKeys: Record<typeof state, MessageKey> = {
    cancelled: 'pageStoryAutofillCancelled',
    completed: 'pageStoryAutofillCompleted',
    failed: 'pageStoryAutofillFailed',
    queued: 'pageStoryAutofillQueued',
  };
  return jobType === 'episode_page_skeleton'
    ? skeletonKeys[state]
    : storyAutofillKeys[state];
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
