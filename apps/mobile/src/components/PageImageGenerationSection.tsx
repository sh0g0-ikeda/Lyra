import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import {
  buildPageGeneratedImageSources,
  refreshPageGeneratedImageSource,
} from '../domain/pageGeneratedImageSources';
import type { RemoteImageSource } from '../domain/entityReferenceImageSources';
import {
  ApiError,
  type GenerationJobRecord,
  type ListJobsPageInput,
  type PageJobAcceptedResponse,
  type PageRecord,
} from '../lib/api';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { colors, radius, spacing } from '../constants/theme';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { ResilientAuthenticatedImage } from './ResilientAuthenticatedImage';
import { StorySelectionSection } from './StorySelectionSection';

type PageGenerationJobRecord = Extract<GenerationJobRecord, { job_type: 'page_generate' }>;

export interface PageImageGenerationApiPort {
  generatePage(
    pageId: string,
    organizationId?: string | null,
  ): Promise<PageJobAcceptedResponse>;
  getJob(
    jobId: string,
    organizationId?: string | null,
  ): Promise<GenerationJobRecord>;
  getJobs(
    input: ListJobsPageInput,
    organizationId?: string | null,
  ): Promise<{ jobs: GenerationJobRecord[]; next_cursor: string | null }>;
  refreshImageAuthorizationHeader(): Promise<string>;
}

interface PageImageGenerationSectionProps {
  api: PageImageGenerationApiPort;
  episodeId: string;
  externalOperationActive: boolean;
  imageApiBaseUrl: string;
  imageAuthorizationHeader: string | null;
  jobPollIntervalMs?: number;
  language: UiLanguage;
  onOperationActiveChange(operationId: string, active: boolean): void;
  organizationId: string | null;
  pageListReady: boolean;
  pages: readonly PageRecord[];
  prepareForGeneration(pageId: string): Promise<PageRecord | null>;
  refreshPages(): Promise<readonly PageRecord[]>;
  sessionKey: string;
}

interface TrackedPageGenerationJob {
  episodeId: string;
  jobId: string;
  operationId: string;
  pageId: string;
  scopeKey: string;
}

interface UnknownGenerationOutcome {
  baselineGeneratedAt: string | null;
  baselineJobIds: string[];
  expectedJobId: string | null;
  operationId: string;
  pageId: string;
  scopeKey: string;
}

const JOB_HISTORY_LIMIT = 50;

export function PageImageGenerationSection({
  api,
  episodeId,
  externalOperationActive,
  imageApiBaseUrl,
  imageAuthorizationHeader,
  jobPollIntervalMs = 8_000,
  language,
  onOperationActiveChange,
  organizationId,
  pageListReady,
  pages,
  prepareForGeneration,
  refreshPages,
  sessionKey,
}: PageImageGenerationSectionProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKeys = useMemo(
    () => storyQueryKeys(sessionKey, organizationId),
    [organizationId, sessionKey],
  );
  const orderedPages = useMemo(
    () => [...pages].sort((left, right) => left.page_number - right.page_number || left.id.localeCompare(right.id)),
    [pages],
  );
  const scopeKey = [sessionKey, organizationId ?? 'personal', episodeId].join(':');
  const currentScope = useRef(scopeKey);
  const mounted = useRef(true);
  const [requestedPageId, setRequestedPageId] = useState<string | null>(null);
  const [authoritativePage, setAuthoritativePage] = useState<PageRecord | null>(null);
  const [trackedJob, setTrackedJobState] = useState<TrackedPageGenerationJob | null>(null);
  const trackedJobRef = useRef<TrackedPageGenerationJob | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState<UnknownGenerationOutcome | null>(null);
  const [startPhase, setStartPhase] = useState<'idle' | 'preparing' | 'submitting'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [jobStatusCheckFailed, setJobStatusCheckFailed] = useState(false);
  const [imageAttemptState, setImageAttemptState] = useState<{
    attempt: number;
    failed: boolean;
    identity: string | null;
  }>({ attempt: 0, failed: false, identity: null });
  const [imageRetrying, setImageRetrying] = useState(false);
  const startOperation = useRef<Promise<boolean> | null>(null);
  const operationSequence = useRef(0);
  const activeOperationIds = useRef(new Set<string>());
  const handledTerminalJobIds = useRef(new Set<string>());
  const settlingJobIds = useRef(new Set<string>());
  const jobPollInFlight = useRef(false);

  const jobsQuery = useQuery({
    enabled: pageListReady,
    queryKey: [...queryKeys.jobs(), episodeId],
    queryFn: () => api.getJobs({ limit: JOB_HISTORY_LIMIT }, organizationId),
    staleTime: 0,
  });
  const trackedJobMatchesScope = trackedJob !== null && trackedJob.scopeKey === scopeKey;
  const jobQuery = useQuery({
    enabled: trackedJobMatchesScope,
    queryKey: trackedJobMatchesScope
      ? queryKeys.job(trackedJob.jobId)
      : [...queryKeys.jobs(), episodeId, 'page-image-job-disabled'],
    queryFn: () => api.getJob(trackedJob!.jobId, organizationId),
    staleTime: 0,
  });

  const selectedPageId = requestedPageId !== null
    && orderedPages.some((page) => page.id === requestedPageId)
    ? requestedPageId
    : orderedPages[0]?.id ?? null;
  const propSelectedPage = orderedPages.find((page) => page.id === selectedPageId) ?? null;
  const selectedPage = authoritativePage?.id === selectedPageId
    && authoritativePage.episode_id === episodeId
    && shouldPreferAuthoritativePage(authoritativePage, propSelectedPage)
    ? authoritativePage
    : propSelectedPage;

  const registerOperation = useCallback((operationId: string): void => {
    if (!mounted.current || activeOperationIds.current.has(operationId)) {
      return;
    }
    activeOperationIds.current.add(operationId);
    onOperationActiveChange(operationId, true);
  }, [onOperationActiveChange]);

  const releaseOperation = useCallback((operationId: string): void => {
    if (!activeOperationIds.current.delete(operationId)) {
      return;
    }
    onOperationActiveChange(operationId, false);
  }, [onOperationActiveChange]);

  const releaseAllOperations = useCallback((): void => {
    for (const operationId of activeOperationIds.current) {
      onOperationActiveChange(operationId, false);
    }
    activeOperationIds.current.clear();
  }, [onOperationActiveChange]);

  const setTrackedJob = useCallback((next: TrackedPageGenerationJob | null): void => {
    trackedJobRef.current = next;
    setTrackedJobState(next);
  }, []);

  const trackExactJob = useCallback((
    pageId: string,
    jobId: string,
    transferredOperationId: string | null = null,
  ): void => {
    if (!mounted.current || currentScope.current !== scopeKey) {
      return;
    }
    const operationId = [
      'page-image-job',
      scopeKey,
      pageId,
      jobId,
    ].map(encodeURIComponent).join(':');
    registerOperation(operationId);
    if (transferredOperationId !== null && transferredOperationId !== operationId) {
      releaseOperation(transferredOperationId);
    }
    handledTerminalJobIds.current.delete(jobId);
    setTrackedJob({ episodeId, jobId, operationId, pageId, scopeKey });
    setUnknownOutcome(null);
    setRequestedPageId(pageId);
    setErrorMessage(null);
    setNoticeMessage(t(language, 'pageImageQueued'));
    setJobStatusCheckFailed(false);
  }, [episodeId, language, registerOperation, releaseOperation, scopeKey, setTrackedJob]);

  const enterUnknownOutcome = useCallback((outcome: UnknownGenerationOutcome): void => {
    if (!mounted.current || currentScope.current !== outcome.scopeKey) {
      return;
    }
    const currentTracked = trackedJobRef.current;
    if (currentTracked !== null && currentTracked.operationId !== outcome.operationId) {
      releaseOperation(currentTracked.operationId);
    }
    setTrackedJob(null);
    setUnknownOutcome(outcome);
    registerOperation(outcome.operationId);
    setNoticeMessage(t(language, 'pageImageOutcomeUnknown'));
    setErrorMessage(null);
    setJobStatusCheckFailed(false);
  }, [language, registerOperation, releaseOperation, setTrackedJob]);

  const settleJob = useCallback(async (
    job: GenerationJobRecord,
    tracked: TrackedPageGenerationJob,
  ): Promise<void> => {
    if (
      !mounted.current
      || currentScope.current !== tracked.scopeKey
      || settlingJobIds.current.has(tracked.jobId)
    ) {
      return;
    }
    if (!matchesTrackedPageJob(job, tracked)) {
      enterUnknownOutcome({
        baselineGeneratedAt: selectedPage?.generated_image?.generated_at ?? null,
        baselineJobIds: [],
        expectedJobId: tracked.jobId,
        operationId: tracked.operationId,
        pageId: tracked.pageId,
        scopeKey: tracked.scopeKey,
      });
      setNoticeMessage(null);
      setErrorMessage(t(language, 'pageImageIdentityError'));
      return;
    }
    if (isActiveJob(job)) {
      setErrorMessage(null);
      setNoticeMessage(t(language, 'pageImageQueued'));
      setJobStatusCheckFailed(false);
      return;
    }
    if (handledTerminalJobIds.current.has(job.id)) {
      return;
    }

    settlingJobIds.current.add(job.id);
    try {
      const refreshedPages = await refreshPages();
      if (
        !mounted.current
        || currentScope.current !== tracked.scopeKey
        || trackedJobRef.current?.jobId !== tracked.jobId
      ) {
        return;
      }
      const refreshedPage = refreshedPages.find(
        (page) => page.id === tracked.pageId && page.episode_id === tracked.episodeId,
      ) ?? null;
      if (refreshedPage !== null) {
        setAuthoritativePage(refreshedPage);
      }

      if (job.status === 'completed') {
        if (!completedJobMatchesPage(job, refreshedPage)) {
          setErrorMessage(t(language, 'pageImageIdentityError'));
          setNoticeMessage(null);
        } else {
          setErrorMessage(null);
          setNoticeMessage(t(language, 'pageImageCompleted'));
        }
      } else if (job.status === 'failed') {
        setErrorMessage(t(language, 'pageImageFailed'));
        setNoticeMessage(null);
      } else {
        setErrorMessage(null);
        setNoticeMessage(t(language, 'pageImageCancelled'));
      }

      handledTerminalJobIds.current.add(job.id);
      setJobStatusCheckFailed(false);
      setTrackedJob(null);
      releaseOperation(tracked.operationId);
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: [...queryKeys.jobs(), tracked.episodeId],
      });
    } catch {
      if (mounted.current && currentScope.current === tracked.scopeKey) {
        setJobStatusCheckFailed(true);
        setErrorMessage(t(language, 'pageImageStatusError'));
      }
    } finally {
      settlingJobIds.current.delete(job.id);
    }
  }, [
    enterUnknownOutcome,
    language,
    queryClient,
    queryKeys,
    refreshPages,
    releaseOperation,
    selectedPage?.generated_image?.generated_at,
    setTrackedJob,
  ]);

  const reconcileUnknownOutcome = useCallback(async (
    outcome: UnknownGenerationOutcome,
    explicit: boolean,
  ): Promise<boolean> => {
    if (!mounted.current || currentScope.current !== outcome.scopeKey) {
      return false;
    }
    setJobStatusCheckFailed(false);
    try {
      const [jobsResult, refreshedPages] = await Promise.all([
        jobsQuery.refetch(),
        refreshPages(),
      ]);
      if (
        !mounted.current
        || currentScope.current !== outcome.scopeKey
        || jobsResult.isError
        || jobsResult.data === undefined
      ) {
        throw new Error('PAGE_IMAGE_RECONCILIATION_FAILED');
      }
      const refreshedPage = refreshedPages.find(
        (page) => page.id === outcome.pageId && page.episode_id === episodeId,
      ) ?? null;
      if (refreshedPage !== null) {
        setAuthoritativePage(refreshedPage);
      }
      const refreshedRevision = refreshedPage?.generated_image?.generated_at ?? null;
      if (
        refreshedPage?.generated_image !== null
        && refreshedPage?.generated_image !== undefined
        && refreshedRevision !== outcome.baselineGeneratedAt
      ) {
        setUnknownOutcome(null);
        releaseOperation(outcome.operationId);
        setErrorMessage(null);
        setNoticeMessage(t(language, 'pageImageCompleted'));
        return true;
      }

      const baselineIds = new Set(outcome.baselineJobIds);
      const exactCandidates = jobsResult.data.jobs.filter(
        (job): job is PageGenerationJobRecord => isPageJobForPage(job, outcome.pageId)
          && !baselineIds.has(job.id)
          && !handledTerminalJobIds.current.has(job.id),
      );
      const expectedCandidates = outcome.expectedJobId === null
        ? exactCandidates
        : exactCandidates.filter((job) => job.id === outcome.expectedJobId);
      const candidates = explicit
        ? expectedCandidates
        : expectedCandidates.filter(isActiveJob);
      if (candidates.length === 1) {
        trackExactJob(outcome.pageId, candidates[0]!.id, outcome.operationId);
        return true;
      }
      if (explicit && candidates.length === 0 && expectedCandidates.length === 0) {
        setUnknownOutcome(null);
        releaseOperation(outcome.operationId);
        setErrorMessage(null);
        setNoticeMessage(t(language, 'pageImageNotStarted'));
        return true;
      }

      setUnknownOutcome(outcome);
      setErrorMessage(null);
      setNoticeMessage(t(language, 'pageImageOutcomeUnknown'));
      return false;
    } catch {
      if (mounted.current && currentScope.current === outcome.scopeKey) {
        setUnknownOutcome(outcome);
        setJobStatusCheckFailed(true);
        setErrorMessage(t(language, 'pageImageStatusError'));
      }
      return false;
    }
  }, [
    episodeId,
    jobsQuery,
    language,
    refreshPages,
    releaseOperation,
    trackExactJob,
  ]);

  const startGeneration = useCallback((): Promise<boolean> => {
    if (startOperation.current !== null) {
      return startOperation.current;
    }
    const target = selectedPage;
    if (
      target === null
      || target.episode_id !== episodeId
      || externalOperationActive
      || trackedJobRef.current !== null
      || unknownOutcome !== null
      || startPhase !== 'idle'
      || jobsQuery.isLoading
      || jobsQuery.isFetching
      || jobsQuery.isError
      || readinessMessageKey(target) !== null
    ) {
      return Promise.resolve(false);
    }

    const capturedScope = scopeKey;
    const targetPageId = target.id;
    operationSequence.current += 1;
    const submissionOperationId = [
      'page-image-start',
      capturedScope,
      targetPageId,
      String(operationSequence.current),
    ].map(encodeURIComponent).join(':');
    registerOperation(submissionOperationId);
    const operation = (async (): Promise<boolean> => {
      setStartPhase('preparing');
      setErrorMessage(null);
      setNoticeMessage(null);
      let registeredOperationId: string | null = submissionOperationId;
      try {
        const prepared = await prepareForGeneration(targetPageId);
        if (prepared === null || !mounted.current || currentScope.current !== capturedScope) {
          return false;
        }
        if (prepared.id !== targetPageId || prepared.episode_id !== episodeId) {
          setErrorMessage(t(language, 'pageImageIdentityError'));
          return false;
        }
        const blocker = readinessMessageKey(prepared);
        if (blocker !== null) {
          setAuthoritativePage(prepared);
          setErrorMessage(t(language, blocker));
          return false;
        }
        setAuthoritativePage(prepared);

        const history = await jobsQuery.refetch();
        if (
          !mounted.current
          || currentScope.current !== capturedScope
          || history.isError
          || history.data === undefined
        ) {
          setErrorMessage(t(language, 'pageImageStatusError'));
          return false;
        }
        const exactActiveJobs = history.data.jobs.filter(
          (job): job is PageGenerationJobRecord => isPageJobForPage(job, targetPageId)
            && isActiveJob(job)
            && !handledTerminalJobIds.current.has(job.id),
        );
        if (exactActiveJobs.length === 1) {
          trackExactJob(targetPageId, exactActiveJobs[0]!.id, submissionOperationId);
          registeredOperationId = null;
          return true;
        }
        if (exactActiveJobs.length > 1) {
          setErrorMessage(t(language, 'pageImageIdentityError'));
          return false;
        }
        const baselineJobIds = history.data.jobs
          .filter((job) => isPageJobForPage(job, targetPageId))
          .map((job) => job.id);

        setStartPhase('submitting');
        try {
          const accepted = await api.generatePage(targetPageId, organizationId);
          if (!mounted.current || currentScope.current !== capturedScope) {
            releaseOperation(submissionOperationId);
            return false;
          }
          trackExactJob(targetPageId, accepted.job_id, submissionOperationId);
          registeredOperationId = null;
          return true;
        } catch (error: unknown) {
          if (!mounted.current || currentScope.current !== capturedScope) {
            releaseOperation(submissionOperationId);
            return false;
          }
          if (!isAmbiguousStartError(error)) {
            releaseOperation(submissionOperationId);
            registeredOperationId = null;
            setErrorMessage(startErrorMessage(language, error));
            return false;
          }
          const outcome: UnknownGenerationOutcome = {
            baselineGeneratedAt: prepared.generated_image?.generated_at ?? null,
            baselineJobIds,
            expectedJobId: null,
            operationId: submissionOperationId,
            pageId: targetPageId,
            scopeKey: capturedScope,
          };
          registeredOperationId = null;
          enterUnknownOutcome(outcome);
          await reconcileUnknownOutcome(outcome, false);
          return true;
        }
      } catch (error: unknown) {
        if (registeredOperationId !== null) {
          releaseOperation(registeredOperationId);
          registeredOperationId = null;
        }
        if (mounted.current && currentScope.current === capturedScope) {
          setErrorMessage(startErrorMessage(language, error));
        }
        return false;
      } finally {
        if (registeredOperationId !== null) {
          releaseOperation(registeredOperationId);
        }
        if (mounted.current && currentScope.current === capturedScope) {
          setStartPhase('idle');
        }
      }
    })();
    startOperation.current = operation;
    void operation.finally(() => {
      if (startOperation.current === operation) {
        startOperation.current = null;
      }
    });
    return operation;
  }, [
    api,
    enterUnknownOutcome,
    episodeId,
    externalOperationActive,
    jobsQuery,
    language,
    organizationId,
    prepareForGeneration,
    reconcileUnknownOutcome,
    registerOperation,
    releaseOperation,
    scopeKey,
    selectedPage,
    startPhase,
    trackExactJob,
    unknownOutcome,
  ]);

  useEffect(() => {
    mounted.current = true;
    currentScope.current = scopeKey;
    return () => {
      mounted.current = false;
      releaseAllOperations();
    };
  }, [releaseAllOperations, scopeKey]);

  useEffect(() => {
    if (jobsQuery.data === undefined || trackedJobRef.current !== null || unknownOutcome !== null) {
      return;
    }
    const pageIds = new Set(orderedPages.map((page) => page.id));
    const activeJobs = jobsQuery.data.jobs.filter(
      (job): job is PageGenerationJobRecord => job.job_type === 'page_generate'
        && typeof job.params.page_id === 'string'
        && pageIds.has(job.params.page_id)
        && isActiveJob(job)
        && !handledTerminalJobIds.current.has(job.id),
    );
    if (activeJobs.length === 1) {
      trackExactJob(activeJobs[0]!.params.page_id!, activeJobs[0]!.id);
    } else if (activeJobs.length > 1) {
      setErrorMessage(t(language, 'pageImageIdentityError'));
    }
  }, [jobsQuery.data, language, orderedPages, trackExactJob, unknownOutcome]);

  useEffect(() => {
    const job = jobQuery.data;
    const tracked = trackedJobRef.current;
    if (job === undefined || tracked === null || tracked.scopeKey !== scopeKey) {
      return;
    }
    void settleJob(job, tracked);
  }, [jobQuery.data, scopeKey, settleJob]);

  const handleTrackedJobQueryError = useCallback((
    error: unknown,
    tracked: TrackedPageGenerationJob,
  ): void => {
    if (error instanceof ApiError && error.status === 404) {
      enterUnknownOutcome({
        baselineGeneratedAt: selectedPage?.generated_image?.generated_at ?? null,
        baselineJobIds: [],
        expectedJobId: tracked.jobId,
        operationId: tracked.operationId,
        pageId: tracked.pageId,
        scopeKey: tracked.scopeKey,
      });
      setNoticeMessage(null);
      setErrorMessage(t(language, 'pageImageIdentityError'));
      return;
    }
    setJobStatusCheckFailed(true);
    setErrorMessage(t(language, 'pageImageStatusError'));
  }, [enterUnknownOutcome, language, selectedPage?.generated_image?.generated_at]);

  useEffect(() => {
    const tracked = trackedJobRef.current;
    if (!jobQuery.isError || tracked === null || tracked.scopeKey !== scopeKey) {
      return;
    }
    handleTrackedJobQueryError(jobQuery.error, tracked);
  }, [
    handleTrackedJobQueryError,
    jobQuery.error,
    jobQuery.isError,
    scopeKey,
  ]);

  useEffect(() => {
    if (!trackedJobMatchesScope) {
      return;
    }
    const intervalId = setInterval(() => {
      if (focusManager.isFocused() && !jobQuery.isFetching && !jobPollInFlight.current) {
        jobPollInFlight.current = true;
        void jobQuery.refetch().finally(() => {
          jobPollInFlight.current = false;
        });
      }
    }, Math.max(1, Math.trunc(jobPollIntervalMs)));
    return () => clearInterval(intervalId);
  }, [jobPollIntervalMs, jobQuery, trackedJobMatchesScope]);

  const blockerKey = selectedPage === null ? null : readinessMessageKey(selectedPage);
  const localOperationActive = trackedJobMatchesScope
    || unknownOutcome !== null
    || startPhase !== 'idle';
  const generateDisabled = selectedPage === null
    || externalOperationActive
    || localOperationActive
    || blockerKey !== null
    || jobsQuery.isLoading
    || jobsQuery.isFetching
    || jobsQuery.isError;

  const imageSources = selectedPage?.generated_image === null
    || selectedPage?.generated_image === undefined
    ? null
    : buildPageGeneratedImageSources({
        apiBaseUrl: imageApiBaseUrl,
        authorizationHeader: imageAuthorizationHeader,
        cdnUrl: selectedPage.generated_image.cdn_url,
        episodeId,
        generatedAt: selectedPage.generated_image.generated_at,
        organizationId,
        pageId: selectedPage.id,
        sessionKey,
      });
  const imageIdentity = imageSources?.identity ?? null;
  const imageAttempt = imageAttemptState.identity === imageIdentity
    ? imageAttemptState.attempt
    : 0;
  const imageFailed = imageAttemptState.identity === imageIdentity
    && imageAttemptState.failed;

  const refreshProtectedSource = useCallback(async (): Promise<RemoteImageSource> => {
    if (imageSources?.protectedSource === null || imageSources === null) {
      throw new Error('PAGE_IMAGE_PROTECTED_SOURCE_UNAVAILABLE');
    }
    const nextAuthorization = await api.refreshImageAuthorizationHeader();
    return refreshPageGeneratedImageSource(imageSources.protectedSource, nextAuthorization);
  }, [api, imageSources]);

  const retryImage = useCallback(async (): Promise<void> => {
    if (imageRetrying || selectedPage === null) {
      return;
    }
    const capturedScope = scopeKey;
    const capturedPageId = selectedPage.id;
    setImageRetrying(true);
    try {
      const refreshedPages = await refreshPages();
      if (!mounted.current || currentScope.current !== capturedScope) {
        return;
      }
      const refreshed = refreshedPages.find(
        (page) => page.id === capturedPageId && page.episode_id === episodeId,
      );
      if (refreshed === undefined || refreshed.generated_image === null) {
        setImageAttemptState({ attempt: 0, failed: true, identity: imageIdentity });
        return;
      }
      setAuthoritativePage(refreshed);
      setImageAttemptState((current) => ({
        attempt: current.identity === imageIdentity ? current.attempt + 1 : 1,
        failed: false,
        identity: imageIdentity,
      }));
    } catch {
      if (mounted.current && currentScope.current === capturedScope) {
        setImageAttemptState({ attempt: 0, failed: true, identity: imageIdentity });
      }
    } finally {
      if (mounted.current && currentScope.current === capturedScope) {
        setImageRetrying(false);
      }
    }
  }, [episodeId, imageIdentity, imageRetrying, refreshPages, scopeKey, selectedPage]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'pageImageGeneration')}</Text>
      <Text style={styles.muted}>{t(language, 'pageImageHelp')}</Text>
      <StorySelectionSection
        disabled={localOperationActive || externalOperationActive}
        emptyMessage={t(language, 'pageImageNoPages')}
        error={false}
        errorMessage={t(language, 'pageLoadError')}
        heading={t(language, 'pageImageTarget')}
        items={orderedPages.map((page) => ({
          id: page.id,
          label: t(language, 'pageLabel', { number: String(page.page_number) }),
        }))}
        loading={!pageListReady}
        loadingMessage={t(language, 'pageLoading')}
        onRetry={() => undefined}
        onSelect={(pageId) => {
          if (!localOperationActive && !externalOperationActive) {
            setRequestedPageId(pageId);
            setAuthoritativePage(null);
            setErrorMessage(null);
            setNoticeMessage(null);
          }
        }}
        retryLabel={t(language, 'retry')}
        selectedId={selectedPageId}
        selectSuffix={t(language, 'pageImageSelectSuffix')}
      />
      <Notice message={t(language, 'pageImageCreditHelp')} />
      {blockerKey === null ? null : <Notice message={t(language, blockerKey)} />}
      {noticeMessage === null ? null : <Notice message={noticeMessage} />}
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      <PrimaryButton
        disabled={generateDisabled}
        label={selectedPage?.generated_image === null || selectedPage === null
          ? t(language, 'pageImageGenerate')
          : t(language, 'pageImageRegenerate')}
        loading={startPhase !== 'idle'}
        onPress={() => void startGeneration()}
      />
      {unknownOutcome === null ? null : (
        <PrimaryButton
          label={t(language, 'pageImageReconcile')}
          onPress={() => void reconcileUnknownOutcome(unknownOutcome, true)}
        />
      )}
      {trackedJobMatchesScope && jobStatusCheckFailed ? (
        <PrimaryButton
          label={t(language, 'pageImageReconcile')}
          onPress={() => {
            const tracked = trackedJobRef.current;
            const job = jobQuery.data;
            setJobStatusCheckFailed(false);
            if (tracked !== null && job !== undefined) {
              void settleJob(job, tracked);
            } else {
              void jobQuery.refetch();
            }
          }}
        />
      ) : null}
      {selectedPage?.generated_image === null || imageSources === null ? null : (
        <View style={styles.imageCard}>
          {imageFailed || (
            imageSources.publicSource === null && imageSources.protectedSource === null
          ) ? (
            <>
              <Notice message={t(language, 'pageImageImageError')} tone="danger" />
              <PrimaryButton
                label={t(language, 'pageImageImageRetry')}
                loading={imageRetrying}
                onPress={() => void retryImage()}
              />
            </>
          ) : (
            <ResilientAuthenticatedImage
              accessibilityLabel={t(language, 'pageImageImageAlt', {
                number: String(selectedPage!.page_number),
              })}
              identity={`${imageSources.identity}:attempt-${imageAttempt}`}
              onExhausted={() => setImageAttemptState({
                attempt: imageAttempt,
                failed: true,
                identity: imageIdentity,
              })}
              onLoad={() => setImageAttemptState({
                attempt: imageAttempt,
                failed: false,
                identity: imageIdentity,
              })}
              protectedSource={imageSources.protectedSource}
              publicSource={imageSources.publicSource}
              refreshProtectedSource={refreshProtectedSource}
              style={styles.image}
            />
          )}
        </View>
      )}
    </View>
  );
}

function isActiveJob(
  job: GenerationJobRecord,
): job is GenerationJobRecord & { status: 'queued' | 'processing' } {
  return job.status === 'queued' || job.status === 'processing';
}

export function hasActivePageImageJobForPages(
  jobs: readonly GenerationJobRecord[],
  pages: readonly PageRecord[],
): boolean {
  const pageIds = new Set(pages.map((page) => page.id));
  return jobs.some((job) => job.job_type === 'page_generate'
    && isActiveJob(job)
    && typeof job.params.page_id === 'string'
    && pageIds.has(job.params.page_id));
}

function isPageJobForPage(
  job: GenerationJobRecord,
  pageId: string,
): job is PageGenerationJobRecord {
  return job.job_type === 'page_generate' && job.params.page_id === pageId;
}

function matchesTrackedPageJob(
  job: GenerationJobRecord,
  tracked: TrackedPageGenerationJob,
): job is PageGenerationJobRecord {
  return job.id === tracked.jobId && isPageJobForPage(job, tracked.pageId);
}

function completedJobMatchesPage(
  job: PageGenerationJobRecord,
  page: PageRecord | null,
): boolean {
  if (page === null || page.id !== job.params.page_id || page.generated_image === null) {
    return false;
  }
  const resultGeneratedAt = job.result?.generated_image?.generated_at;
  return resultGeneratedAt === undefined
    || resultGeneratedAt === null
    || page.generated_image.generated_at === resultGeneratedAt;
}

function shouldPreferAuthoritativePage(
  authoritative: PageRecord,
  fromProps: PageRecord | null,
): boolean {
  if (fromProps === null || authoritative.updated_at > fromProps.updated_at) {
    return true;
  }
  return authoritative.updated_at === fromProps.updated_at
    && authoritative.generated_image?.generated_at !== fromProps.generated_image?.generated_at;
}

function readinessMessageKey(page: PageRecord): MessageKey | null {
  if (page.status === 'confirmed') {
    return 'pageImageConfirmedBlocked';
  }
  if (page.status === 'generating') {
    return 'pageImageGeneratingBlocked';
  }
  if (page.panel_count === 0 || page.frame_count === 0) {
    return 'pageImageStructureMissing';
  }
  if (page.panel_count !== page.frame_count) {
    return 'pageImageStructureMismatch';
  }
  return null;
}

function isAmbiguousStartError(error: unknown): boolean {
  return !(error instanceof ApiError)
    || error.status === 0
    || error.status >= 500
    || error.code === 'INVALID_API_RESPONSE';
}

function startErrorMessage(language: UiLanguage, error: unknown): string {
  if (error instanceof ApiError && error.status === 402) {
    return t(language, 'pageImageInsufficientCredits');
  }
  return t(language, 'pageImageStartError');
}

const styles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  image: {
    aspectRatio: 2 / 3,
    borderRadius: radius.sm,
    width: '100%',
  },
  imageCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  section: {
    gap: spacing.sm,
  },
});
