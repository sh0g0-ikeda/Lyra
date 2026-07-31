import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { buildEntityReferenceCandidateImageSource } from '../domain/entityReferenceCandidateImageSources';
import {
  findActiveEntityGenerationJob,
  isEntityGenerationJobForEntity,
  readCompletedEntityGenerationCandidates,
  recoverEntityGenerationJob,
  type EntityReferenceGenerationCandidate,
} from '../domain/entityReferenceGeneration';
import {
  refreshProtectedImageSource,
  type RemoteImageSource,
} from '../domain/entityReferenceImageSources';
import {
  ApiError,
  type EntityRecord,
  type EntityReferenceGenerationResponse,
  type EntityReferenceSetRecord,
  type GenerationJobRecord,
} from '../lib/api';
import {
  showEntityReferenceConfirmPrompt,
  type EntityReferenceConfirmPromptInput,
} from '../lib/entityReferenceConfirmPrompt';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import type { storyQueryKeys } from '../lib/storyQueryKeys';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';
import { ResilientAuthenticatedImage } from './ResilientAuthenticatedImage';
import {
  referenceSetFingerprint,
  type EntityReferenceImportCandidate,
  type EntityReferenceMutationApiPort,
} from './EntityReferenceImportControls';

const DEFAULT_JOB_POLL_INTERVAL_MS = 2_000;
const JOB_HISTORY_LIMIT = 100;

export interface EntityReferenceGenerationApiPort extends EntityReferenceMutationApiPort {
  generateEntityReference(
    entityId: string,
    sourceCandidateToken?: string | null,
    organizationId?: string | null,
  ): Promise<EntityReferenceGenerationResponse>;
  getJob(
    jobId: string,
    organizationId?: string | null,
  ): Promise<GenerationJobRecord>;
  getJobs(
    input: { limit: number; cursor?: string | null },
    organizationId?: string | null,
  ): Promise<{ jobs: GenerationJobRecord[]; next_cursor: string | null }>;
}

interface EntityReferenceGenerationControlsProps {
  acceptReferenceSet(referenceSet: EntityReferenceSetRecord): void;
  api: EntityReferenceGenerationApiPort;
  apiBaseUrl: string;
  authorizationHeader: string | null;
  confirmReferenceCandidate?: (
    input: EntityReferenceConfirmPromptInput,
  ) => Promise<boolean>;
  entity: EntityRecord;
  importCandidate: EntityReferenceImportCandidate | null;
  jobPollIntervalMs?: number;
  language: UiLanguage;
  onImportCandidateChange(candidate: EntityReferenceImportCandidate | null): void;
  onOperationActiveChange?(operationId: string, active: boolean): void;
  operationBlocked?(): boolean;
  externalOperationActive?: boolean;
  organizationId: string | null;
  prepareEntityForGeneration(
    sourcePromptSupplement?: string,
  ): Promise<EntityRecord | null>;
  queryKeys: ReturnType<typeof storyQueryKeys>;
  referenceSet: EntityReferenceSetRecord;
  referenceSetError: boolean;
  refreshAuthorizationHeader(): Promise<string>;
  refreshReferenceSet(): Promise<EntityReferenceSetRecord | null>;
  resetImageAuthorization(): void;
  sessionKey: string;
}

interface TrackedEntityJob {
  baselineFingerprint: string;
  jobId: string;
  operationId: string;
  promptSupplement: string | null;
}

interface GeneratedCandidateState {
  ambiguous: boolean;
  baselineFingerprint: string;
  candidates: EntityReferenceGenerationCandidate[];
  jobId: string;
  loadedIndexes: number[];
  primaryIndex: number | null;
  promptSupplement: string | null;
  revision: number;
  selectedIndexes: number[];
}

interface AmbiguousStartState {
  baselineFingerprint: string;
  promptSupplement: string | null;
  startedAt: Date;
}

interface Feedback {
  key: MessageKey;
  tone?: 'danger';
}

interface ActiveStartOperation {
  id: string;
  promise: Promise<void>;
}

type GenerationOperationKind =
  | 'confirm'
  | 'generate-current'
  | 'generate-import'
  | 'refresh';

let nextGenerationOperationSequence = 0;

export function EntityReferenceGenerationControls({
  acceptReferenceSet,
  api,
  apiBaseUrl,
  authorizationHeader,
  confirmReferenceCandidate = showEntityReferenceConfirmPrompt,
  entity,
  importCandidate,
  jobPollIntervalMs = DEFAULT_JOB_POLL_INTERVAL_MS,
  language,
  onImportCandidateChange,
  onOperationActiveChange,
  operationBlocked,
  externalOperationActive = false,
  organizationId,
  prepareEntityForGeneration,
  queryKeys,
  referenceSet,
  referenceSetError,
  refreshAuthorizationHeader,
  refreshReferenceSet,
  resetImageAuthorization,
  sessionKey,
}: EntityReferenceGenerationControlsProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [checkingHistory, setCheckingHistory] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [generated, setGenerated] = useState<GeneratedCandidateState | null>(null);
  const [ambiguousStart, setAmbiguousStart] = useState<AmbiguousStartState | null>(null);
  const [trackedJob, setTrackedJob] = useState<TrackedEntityJob | null>(null);
  const [jobStatusCheckFailed, setJobStatusCheckFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [operationKind, setOperationKind] = useState<GenerationOperationKind | null>(null);
  const [initialHistoryContext] = useState(() => ({
    baselineFingerprint: referenceSetFingerprint(referenceSet),
    promptSupplement: entity.prompt_supplement,
  }));
  const mounted = useRef(true);
  const historyInFlight = useRef<Promise<GenerationJobRecord[]> | null>(null);
  const jobPollInFlight = useRef(false);
  const startOperation = useRef<ActiveStartOperation | null>(null);
  const trackedJobRef = useRef<TrackedEntityJob | null>(null);
  const operationChangeHandler = useRef(onOperationActiveChange);
  const normalizedPollIntervalMs = Math.max(1, Math.trunc(jobPollIntervalMs));

  useEffect(() => {
    operationChangeHandler.current = onOperationActiveChange;
  }, [onOperationActiveChange]);

  const finishTrackedJob = useCallback((): void => {
    const current = trackedJobRef.current;
    trackedJobRef.current = null;
    setTrackedJob(null);
    if (current !== null) {
      operationChangeHandler.current?.(current.operationId, false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const currentStart = startOperation.current;
      startOperation.current = null;
      if (currentStart !== null) {
        operationChangeHandler.current?.(currentStart.id, false);
      }
      const currentJob = trackedJobRef.current;
      trackedJobRef.current = null;
      if (currentJob !== null) {
        operationChangeHandler.current?.(currentJob.operationId, false);
      }
    };
  }, []);

  const readJobHistory = useCallback((): Promise<GenerationJobRecord[]> => {
    if (historyInFlight.current !== null) {
      return historyInFlight.current;
    }
    const operation = api.getJobs({ limit: JOB_HISTORY_LIMIT }, organizationId)
      .then((page) => page.jobs);
    historyInFlight.current = operation;
    const settle = (): void => {
      if (historyInFlight.current === operation) {
        historyInFlight.current = null;
      }
    };
    void operation.then(settle, settle);
    return operation;
  }, [api, organizationId]);

  const trackPendingJob = useCallback((
    jobId: string,
    promptSupplement: string | null,
    baselineFingerprint: string,
  ): TrackedEntityJob => {
    const current = trackedJobRef.current;
    if (current?.jobId === jobId) {
      return current;
    }
    finishTrackedJob();
    const operationId = createOperationId({
      entityId: entity.id,
      kind: 'job',
      organizationId,
      sessionKey,
      suffix: jobId,
    });
    const tracked: TrackedEntityJob = {
      baselineFingerprint,
      jobId,
      operationId,
      promptSupplement,
    };
    trackedJobRef.current = tracked;
    operationChangeHandler.current?.(operationId, true);
    setTrackedJob(tracked);
    setGenerated(null);
    return tracked;
  }, [entity.id, finishTrackedJob, organizationId, sessionKey]);

  const adoptActiveJob = useCallback((
    job: GenerationJobRecord,
    promptSupplement: string | null,
    baselineFingerprint: string,
  ): boolean => {
    if (!isEntityGenerationJobForEntity(job, entity.id) || !isActiveJob(job)) {
      return false;
    }
    if (trackedJobRef.current?.jobId === job.id) {
      setJobStatusCheckFailed(false);
      setFeedback({
        key: job.status === 'processing'
          ? 'characterReferenceGenerationProcessing'
          : 'characterReferenceGenerationQueued',
      });
      return true;
    }
    trackPendingJob(job.id, promptSupplement, baselineFingerprint);
    setJobStatusCheckFailed(false);
    setFeedback({
      key: job.status === 'processing'
        ? 'characterReferenceGenerationProcessing'
        : 'characterReferenceGenerationQueued',
    });
    return true;
  }, [entity.id, trackPendingJob]);

  const adoptCompletedJob = useCallback((
    job: GenerationJobRecord,
    promptSupplement: string | null,
    baselineFingerprint: string,
  ): boolean => {
    const candidates = readCompletedEntityGenerationCandidates(job, entity.id);
    if (candidates === null) {
      setFeedback({ key: 'characterReferenceGenerationResultError', tone: 'danger' });
      return false;
    }
    setGenerated((current) => ({
      ambiguous: false,
      baselineFingerprint,
      candidates,
      jobId: job.id,
      loadedIndexes: [],
      primaryIndex: candidates[0]?.index ?? null,
      promptSupplement,
      revision: (current?.revision ?? 0) + 1,
      selectedIndexes: candidates.map((candidate) => candidate.index),
    }));
    setJobStatusCheckFailed(false);
    setFeedback({ key: 'characterReferenceGenerationCompleted' });
    return true;
  }, [entity.id]);

  const handleInspectedJob = useCallback((
    job: GenerationJobRecord,
    context: {
      baselineFingerprint: string;
      jobId: string;
      promptSupplement: string | null;
    },
  ): boolean => {
    if (
      job.id !== context.jobId
      || !isEntityGenerationJobForEntity(job, entity.id)
    ) {
      setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
      setJobStatusCheckFailed(true);
      return false;
    }
    if (isActiveJob(job)) {
      return adoptActiveJob(
        job,
        context.promptSupplement,
        context.baselineFingerprint,
      );
    }
    finishTrackedJob();
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
    if (job.status === 'completed') {
      return adoptCompletedJob(
        job,
        context.promptSupplement,
        context.baselineFingerprint,
      );
    }
    setGenerated(null);
    setFeedback({
      key: job.status === 'cancelled'
        ? 'characterReferenceGenerationCancelled'
        : 'characterReferenceGenerationFailed',
      ...(job.status === 'failed' ? { tone: 'danger' as const } : {}),
    });
    return true;
  }, [
    adoptActiveJob,
    adoptCompletedJob,
    entity.id,
    finishTrackedJob,
    queryClient,
    queryKeys,
  ]);

  const inspectExactJob = useCallback(async (
    jobId: string,
    context: {
      baselineFingerprint: string;
      promptSupplement: string | null;
    },
  ): Promise<boolean> => {
    const job = await api.getJob(jobId, organizationId);
    if (!mounted.current) {
      return false;
    }
    return handleInspectedJob(job, { ...context, jobId });
  }, [api, handleInspectedJob, organizationId]);

  useEffect(() => {
    let cancelled = false;
    void readJobHistory().then(
      async (jobs) => {
        if (cancelled || !mounted.current || trackedJobRef.current !== null) {
          return;
        }
        const active = findActiveEntityGenerationJob(jobs, entity.id);
        if (active !== null) {
          const context = {
            baselineFingerprint: initialHistoryContext.baselineFingerprint,
            promptSupplement: initialHistoryContext.promptSupplement,
          };
          trackPendingJob(active.id, context.promptSupplement, context.baselineFingerprint);
          try {
            await inspectExactJob(active.id, context);
          } catch {
            if (!cancelled && mounted.current) {
              setJobStatusCheckFailed(true);
              setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
            }
          }
        }
      },
      () => {
        if (!cancelled && mounted.current) {
          setFeedback({ key: 'characterReferenceGenerationHistoryError', tone: 'danger' });
        }
      },
    ).finally(() => {
      if (!cancelled && mounted.current) {
        setCheckingHistory(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    entity.id,
    initialHistoryContext,
    inspectExactJob,
    readJobHistory,
    trackPendingJob,
  ]);

  useEffect(() => {
    if (trackedJob === null) {
      return;
    }
    const poll = (): void => {
      if (!focusManager.isFocused() || jobPollInFlight.current) {
        return;
      }
      jobPollInFlight.current = true;
      void inspectExactJob(trackedJob.jobId, trackedJob)
        .then((accepted) => {
          if (mounted.current && accepted) {
            setJobStatusCheckFailed(false);
          }
        })
        .catch((error: unknown) => {
          if (!mounted.current) {
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            setJobStatusCheckFailed(true);
            setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
            return;
          }
          setJobStatusCheckFailed(true);
          setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
        })
        .finally(() => {
          jobPollInFlight.current = false;
        });
    };
    const intervalId = setInterval(poll, normalizedPollIntervalMs);
    return () => clearInterval(intervalId);
  }, [finishTrackedJob, inspectExactJob, normalizedPollIntervalMs, trackedJob]);

  const runStartExclusive = useCallback((
    nextOperationKind: GenerationOperationKind,
    work: () => Promise<void>,
  ): void => {
    if (
      startOperation.current !== null
      || trackedJobRef.current !== null
      || confirming
      || operationBlocked?.() === true
    ) {
      return;
    }
    const operationId = createOperationId({
      entityId: entity.id,
      kind: 'start',
      organizationId,
      sessionKey,
    });
    operationChangeHandler.current?.(operationId, true);
    setOperationKind(nextOperationKind);
    const current: ActiveStartOperation = {
      id: operationId,
      promise: Promise.resolve().then(work),
    };
    startOperation.current = current;
    const settle = (): void => {
      if (startOperation.current === current) {
        startOperation.current = null;
        if (mounted.current) {
          setOperationKind(null);
        }
        operationChangeHandler.current?.(operationId, false);
      }
    };
    void current.promise.then(settle, settle);
  }, [confirming, entity.id, operationBlocked, organizationId, sessionKey]);

  const startGeneration = useCallback((source: EntityReferenceImportCandidate | null): void => {
    if (
      checkingHistory
      || generated !== null
      || referenceSetError
      || (source !== null && (!source.previewLoaded || source.ambiguous))
    ) {
      return;
    }
    runStartExclusive(source === null ? 'generate-current' : 'generate-import', async () => {
      setFeedback(null);
      const prepared = await prepareEntityForGeneration(source?.promptSupplement);
      if (!mounted.current || prepared === null || prepared.id !== entity.id) {
        if (mounted.current) {
          setFeedback({ key: 'characterReferenceGenerationSaveError', tone: 'danger' });
        }
        return;
      }
      const latestReferenceSet = await refreshReferenceSet();
      if (!mounted.current) {
        return;
      }
      if (latestReferenceSet === null) {
        setFeedback({ key: 'characterReferenceLoadError', tone: 'danger' });
        return;
      }
      acceptReferenceSet(latestReferenceSet);
      const baselineFingerprint = referenceSetFingerprint(latestReferenceSet);

      let history: GenerationJobRecord[];
      try {
        history = await readJobHistory();
      } catch {
        if (mounted.current) {
          setFeedback({ key: 'characterReferenceGenerationHistoryError', tone: 'danger' });
        }
        return;
      }
      if (!mounted.current) {
        return;
      }
      const active = findActiveEntityGenerationJob(history, entity.id);
      if (active !== null) {
        await inspectExactJob(active.id, {
          baselineFingerprint,
          promptSupplement: prepared.prompt_supplement,
        });
        return;
      }

      const startedAt = new Date();
      let accepted: EntityReferenceGenerationResponse;
      try {
        accepted = await api.generateEntityReference(
          entity.id,
          source?.token ?? null,
          organizationId,
        );
      } catch (error) {
        const recovered = await recoverAfterStartFailure({
          api,
          entityId: entity.id,
          organizationId,
          startedAt,
        });
        if (!mounted.current) {
          return;
        }
        if (recovered.status === 'recovered') {
          trackPendingJob(
            recovered.job.id,
            prepared.prompt_supplement,
            baselineFingerprint,
          );
          try {
            await inspectExactJob(recovered.job.id, {
              baselineFingerprint,
              promptSupplement: prepared.prompt_supplement,
            });
          } catch {
            if (mounted.current) {
              setJobStatusCheckFailed(true);
              setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
            }
          }
          return;
        }
        if (recovered.status === 'ambiguous') {
          setAmbiguousStart({
            baselineFingerprint,
            promptSupplement: prepared.prompt_supplement,
            startedAt,
          });
        }
        setFeedback({
          key: generationStartErrorMessageKey(error, recovered.status === 'ambiguous'),
          tone: 'danger',
        });
        return;
      }
      if (!mounted.current) {
        return;
      }
      if (source !== null) {
        onImportCandidateChange(null);
      }
      trackPendingJob(
        accepted.job_id,
        prepared.prompt_supplement,
        baselineFingerprint,
      );
      try {
        await inspectExactJob(accepted.job_id, {
          baselineFingerprint,
          promptSupplement: prepared.prompt_supplement,
        });
      } catch {
        if (mounted.current) {
          setJobStatusCheckFailed(true);
          setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
        }
      }
    });
  }, [
    acceptReferenceSet,
    api,
    checkingHistory,
    entity.id,
    generated,
    inspectExactJob,
    onImportCandidateChange,
    organizationId,
    prepareEntityForGeneration,
    readJobHistory,
    referenceSetError,
    refreshReferenceSet,
    runStartExclusive,
    trackPendingJob,
  ]);

  const reconcileAmbiguousStart = useCallback((): void => {
    if (ambiguousStart === null) {
      return;
    }
    runStartExclusive('refresh', async () => {
      let page: { jobs: GenerationJobRecord[]; next_cursor: string | null };
      try {
        page = await api.getJobs({ limit: JOB_HISTORY_LIMIT }, organizationId);
      } catch {
        if (mounted.current) {
          setFeedback({ key: 'characterReferenceGenerationAmbiguous', tone: 'danger' });
        }
        return;
      }
      if (!mounted.current) {
        return;
      }
      const recovered = recoverEntityGenerationJob({
        jobs: page.jobs,
        entityId: entity.id,
        startedAt: ambiguousStart.startedAt,
      });
      if (recovered.status === 'ambiguous') {
        setFeedback({ key: 'characterReferenceGenerationAmbiguous', tone: 'danger' });
        return;
      }
      if (recovered.status === 'none') {
        setAmbiguousStart(null);
        setFeedback({ key: 'characterReferenceGenerationStartError', tone: 'danger' });
        return;
      }
      trackPendingJob(
        recovered.job.id,
        ambiguousStart.promptSupplement,
        ambiguousStart.baselineFingerprint,
      );
      try {
        const acceptedRecoveredJob = await inspectExactJob(recovered.job.id, {
          baselineFingerprint: ambiguousStart.baselineFingerprint,
          promptSupplement: ambiguousStart.promptSupplement,
        });
        if (acceptedRecoveredJob) {
          setAmbiguousStart(null);
        }
      } catch {
        if (mounted.current) {
          setJobStatusCheckFailed(true);
          setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
        }
      }
    });
  }, [
    ambiguousStart,
    api,
    entity.id,
    inspectExactJob,
    organizationId,
    runStartExclusive,
    trackPendingJob,
  ]);

  const confirmGenerated = useCallback((): void => {
    if (!canConfirmGenerated(generated) || confirming) {
      return;
    }
    const current = generated;
    runStartExclusive('confirm', async () => {
      setConfirming(true);
      setFeedback(null);
      let confirmDispatched = false;
      try {
        const latest = await refreshReferenceSet();
        if (!mounted.current) {
          return;
        }
        if (latest === null) {
          setFeedback({ key: 'characterReferenceLoadError', tone: 'danger' });
          return;
        }
        acceptReferenceSet(latest);
        const latestFingerprint = referenceSetFingerprint(latest);
        if (latestFingerprint !== current.baselineFingerprint) {
          setGenerated({ ...current, baselineFingerprint: latestFingerprint });
          setFeedback({ key: 'characterReferenceRemoteChanged', tone: 'danger' });
          return;
        }
        if (!(await confirmReferenceCandidate({
          existingCount: latest.reference_images.length,
          language,
        })) || !mounted.current) {
          return;
        }
        const selectedTokens = current.candidates
          .filter((candidate) => current.selectedIndexes.includes(candidate.index))
          .map((candidate) => candidate.token);
        const primaryToken = current.candidates.find(
          (candidate) => candidate.index === current.primaryIndex,
        )?.token;
        if (selectedTokens.length === 0 || primaryToken === undefined) {
          setFeedback({ key: 'characterReferenceGenerationSelectionError', tone: 'danger' });
          return;
        }
        confirmDispatched = true;
        const confirmed = await api.confirmEntityReference(
          entity.id,
          {
            selected_candidate_tokens: selectedTokens as [string, ...string[]],
            primary_candidate_token: primaryToken,
            prompt_supplement: current.promptSupplement,
          },
          organizationId,
        );
        if (!mounted.current) {
          return;
        }
        acceptReferenceSet(confirmed);
        setGenerated(null);
        setFeedback({ key: 'characterReferenceGenerationConfirmed' });
        const refreshed = await refreshReferenceSet().catch(() => null);
        if (mounted.current && refreshed !== null) {
          acceptReferenceSet(
            refreshed.updated_at >= confirmed.updated_at ? refreshed : confirmed,
          );
        }
      } catch (error) {
        if (!mounted.current) {
          return;
        }
        if (!confirmDispatched || isDefinitiveRequestRejection(error)) {
          setFeedback({ key: 'characterReferenceConfirmRejected', tone: 'danger' });
          return;
        }
        const refreshed = await refreshReferenceSet().catch(() => null);
        if (!mounted.current) {
          return;
        }
        if (refreshed !== null) {
          acceptReferenceSet(refreshed);
        }
        setGenerated({ ...current, ambiguous: true });
        setFeedback({ key: 'characterReferenceConfirmAmbiguous', tone: 'danger' });
      } finally {
        if (mounted.current) {
          setConfirming(false);
        }
      }
    });
  }, [
    acceptReferenceSet,
    api,
    confirmReferenceCandidate,
    confirming,
    entity.id,
    generated,
    language,
    organizationId,
    refreshReferenceSet,
    runStartExclusive,
  ]);

  const refreshGeneratedCandidates = useCallback((): void => {
    if (generated === null || startOperation.current !== null || confirming) {
      return;
    }
    runStartExclusive('refresh', async () => {
      try {
        const job = await api.getJob(generated.jobId, organizationId);
        if (!mounted.current) {
          return;
        }
        const candidates = readCompletedEntityGenerationCandidates(job, entity.id);
        if (candidates === null || job.id !== generated.jobId) {
          setFeedback({ key: 'characterReferenceGenerationResultError', tone: 'danger' });
          return;
        }
        const availableIndexes = new Set(candidates.map((candidate) => candidate.index));
        const selectedIndexes = generated.selectedIndexes.filter((index) => availableIndexes.has(index));
        const normalizedSelected = selectedIndexes.length > 0
          ? selectedIndexes
          : candidates.map((candidate) => candidate.index);
        setGenerated({
          ...generated,
          ambiguous: false,
          candidates,
          loadedIndexes: [],
          primaryIndex: generated.primaryIndex !== null && normalizedSelected.includes(generated.primaryIndex)
            ? generated.primaryIndex
            : normalizedSelected[0] ?? null,
          revision: generated.revision + 1,
          selectedIndexes: normalizedSelected,
        });
        resetImageAuthorization();
        setFeedback(null);
      } catch {
        if (mounted.current) {
          setFeedback({ key: 'characterReferenceGenerationResultError', tone: 'danger' });
        }
      }
    });
  }, [
    api,
    confirming,
    entity.id,
    generated,
    organizationId,
    resetImageAuthorization,
    runStartExclusive,
  ]);

  const busy = checkingHistory
    || operationKind !== null
    || trackedJob !== null
    || confirming
    || externalOperationActive;
  const genericGenerateDisabled = busy
    || generated !== null
    || ambiguousStart !== null
    || referenceSetError;
  const sourceGenerateDisabled = genericGenerateDisabled
    || importCandidate === null
    || !importCandidate.previewLoaded
    || importCandidate.ambiguous;

  return (
    <View style={styles.controls}>
      <Text style={styles.heading}>{t(language, 'characterReferenceGenerationHeading')}</Text>
      <Text style={styles.muted}>{t(language, 'characterReferenceGenerationHelp')}</Text>
      <PrimaryButton
        disabled={genericGenerateDisabled}
        label={t(language, 'characterReferenceGenerateAction')}
        loading={operationKind === 'generate-current'}
        onPress={() => startGeneration(null)}
      />
      {importCandidate === null ? null : (
        <PrimaryButton
          disabled={sourceGenerateDisabled}
          label={t(language, 'characterReferenceGenerateFromImportAction')}
          loading={operationKind === 'generate-import'}
          onPress={() => startGeneration(importCandidate)}
        />
      )}
      {checkingHistory ? (
        <Notice message={t(language, 'characterReferenceGenerationChecking')} />
      ) : null}
      {feedback === null ? null : (
        <Notice message={t(language, feedback.key)} tone={feedback.tone} />
      )}
      {jobStatusCheckFailed && trackedJob !== null ? (
        <PrimaryButton
          label={t(language, 'characterReferenceGenerationRetryStatus')}
          onPress={() => {
            if (!jobPollInFlight.current) {
              jobPollInFlight.current = true;
              void inspectExactJob(trackedJob.jobId, trackedJob)
                .then((accepted) => {
                  if (mounted.current && accepted) {
                    setJobStatusCheckFailed(false);
                  }
                })
                .catch(() => {
                  if (mounted.current) {
                    setJobStatusCheckFailed(true);
                    setFeedback({ key: 'characterReferenceGenerationStatusError', tone: 'danger' });
                  }
                })
                .finally(() => {
                  jobPollInFlight.current = false;
                });
            }
          }}
        />
      ) : null}
      {ambiguousStart === null ? null : (
        <PrimaryButton
          disabled={busy}
          label={t(language, 'characterReferenceGenerationRetryStatus')}
          loading={operationKind === 'refresh'}
          onPress={reconcileAmbiguousStart}
        />
      )}
      {generated === null ? null : (
        <GeneratedCandidateGallery
          apiBaseUrl={apiBaseUrl}
          authorizationHeader={authorizationHeader}
          entityId={entity.id}
          entityName={entity.name}
          generated={generated}
          language={language}
          onCandidateLoaded={(index) => setGenerated((current) => current === null ? null : {
            ...current,
            loadedIndexes: uniqueNumbers([...current.loadedIndexes, index]),
          })}
          onCandidateUnavailable={(index) => setGenerated((current) => current === null ? null : {
            ...current,
            loadedIndexes: current.loadedIndexes.filter((candidateIndex) => candidateIndex !== index),
          })}
          onConfirm={confirmGenerated}
          onDiscard={() => {
            if (!busy) {
              setGenerated(null);
              setFeedback(null);
            }
          }}
          onRefresh={refreshGeneratedCandidates}
          onSetPrimary={(index) => setGenerated((current) => current === null ? null : {
            ...current,
            primaryIndex: index,
            selectedIndexes: uniqueNumbers([...current.selectedIndexes, index]),
          })}
          onToggleSelected={(index) => setGenerated((current) => {
            if (current === null) {
              return null;
            }
            const selectedIndexes = current.selectedIndexes.includes(index)
              ? current.selectedIndexes.filter((candidateIndex) => candidateIndex !== index)
              : uniqueNumbers([...current.selectedIndexes, index]);
            return {
              ...current,
              primaryIndex: current.primaryIndex !== null && selectedIndexes.includes(current.primaryIndex)
                ? current.primaryIndex
                : selectedIndexes[0] ?? null,
              selectedIndexes,
            };
          })}
          operationActive={busy}
          organizationId={organizationId}
          refreshAuthorizationHeader={refreshAuthorizationHeader}
          resetImageAuthorization={resetImageAuthorization}
          sessionKey={sessionKey}
        />
      )}
    </View>
  );
}

interface GeneratedCandidateGalleryProps {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  entityId: string;
  entityName: string;
  generated: GeneratedCandidateState;
  language: UiLanguage;
  onCandidateLoaded(index: number): void;
  onCandidateUnavailable(index: number): void;
  onConfirm(): void;
  onDiscard(): void;
  onRefresh(): void;
  onSetPrimary(index: number): void;
  onToggleSelected(index: number): void;
  operationActive: boolean;
  organizationId: string | null;
  refreshAuthorizationHeader(): Promise<string>;
  resetImageAuthorization(): void;
  sessionKey: string;
}

function GeneratedCandidateGallery({
  apiBaseUrl,
  authorizationHeader,
  entityId,
  entityName,
  generated,
  language,
  onCandidateLoaded,
  onCandidateUnavailable,
  onConfirm,
  onDiscard,
  onRefresh,
  onSetPrimary,
  onToggleSelected,
  operationActive,
  organizationId,
  refreshAuthorizationHeader,
  resetImageAuthorization,
  sessionKey,
}: GeneratedCandidateGalleryProps): React.JSX.Element {
  return (
    <View style={styles.gallery}>
      <Text style={styles.heading}>
        {t(language, 'characterReferenceGeneratedCandidateCount', {
          count: String(generated.candidates.length),
        })}
      </Text>
      {generated.candidates.map((candidate) => (
        <GeneratedCandidateCard
          apiBaseUrl={apiBaseUrl}
          authorizationHeader={authorizationHeader}
          candidate={candidate}
          entityId={entityId}
          entityName={entityName}
          key={`${generated.jobId}:${candidate.index}`}
          language={language}
          onLoaded={() => onCandidateLoaded(candidate.index)}
          onSetPrimary={() => onSetPrimary(candidate.index)}
          onToggleSelected={() => onToggleSelected(candidate.index)}
          onUnavailable={() => onCandidateUnavailable(candidate.index)}
          operationActive={operationActive}
          organizationId={organizationId}
          primary={generated.primaryIndex === candidate.index}
          refreshAuthorizationHeader={refreshAuthorizationHeader}
          resetImageAuthorization={resetImageAuthorization}
          revision={`${generated.jobId}:${candidate.index}:${generated.revision}`}
          selected={generated.selectedIndexes.includes(candidate.index)}
          sessionKey={sessionKey}
        />
      ))}
      <PrimaryButton
        disabled={!canConfirmGenerated(generated) || operationActive}
        label={t(language, 'characterReferenceGeneratedConfirmAction')}
        loading={operationActive}
        onPress={onConfirm}
      />
      <PrimaryButton
        disabled={operationActive}
        label={t(language, 'characterReferenceGeneratedRefreshAction')}
        onPress={onRefresh}
      />
      <PrimaryButton
        disabled={operationActive}
        label={t(language, 'characterReferenceCandidateDiscard')}
        onPress={onDiscard}
      />
    </View>
  );
}

interface GeneratedCandidateCardProps {
  apiBaseUrl: string;
  authorizationHeader: string | null;
  candidate: EntityReferenceGenerationCandidate;
  entityId: string;
  entityName: string;
  language: UiLanguage;
  onLoaded(): void;
  onSetPrimary(): void;
  onToggleSelected(): void;
  onUnavailable(): void;
  operationActive: boolean;
  organizationId: string | null;
  primary: boolean;
  refreshAuthorizationHeader(): Promise<string>;
  resetImageAuthorization(): void;
  revision: string;
  selected: boolean;
  sessionKey: string;
}

function GeneratedCandidateCard({
  apiBaseUrl,
  authorizationHeader,
  candidate,
  entityId,
  entityName,
  language,
  onLoaded,
  onSetPrimary,
  onToggleSelected,
  onUnavailable,
  operationActive,
  organizationId,
  primary,
  refreshAuthorizationHeader,
  resetImageAuthorization,
  revision,
  selected,
  sessionKey,
}: GeneratedCandidateCardProps): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => buildEntityReferenceCandidateImageSource({
    apiBaseUrl,
    authorizationHeader,
    candidateToken: candidate.token,
    entityId,
    organizationId,
    revision,
    sessionKey,
  }), [
    apiBaseUrl,
    authorizationHeader,
    candidate.token,
    entityId,
    organizationId,
    revision,
    sessionKey,
  ]);
  const refreshProtectedSource = useCallback(async (): Promise<RemoteImageSource> => {
    if (source.protectedSource === null) {
      throw new Error('Candidate image source is unavailable');
    }
    return refreshProtectedImageSource(
      source.protectedSource,
      await refreshAuthorizationHeader(),
    );
  }, [refreshAuthorizationHeader, source.protectedSource]);

  return (
    <View style={styles.candidateCard}>
      {failed || source.protectedSource === null ? (
        <View style={styles.imagePlaceholder}>
          <Notice
            message={t(language, 'characterReferenceGeneratedPreviewError')}
            tone="danger"
          />
          <PrimaryButton
            label={t(language, 'characterReferenceCandidateRetry')}
            onPress={() => {
              resetImageAuthorization();
              onUnavailable();
              setFailed(false);
              setAttempt((current) => current + 1);
            }}
          />
        </View>
      ) : (
        <ResilientAuthenticatedImage
          accessibilityLabel={t(language, 'characterReferenceGeneratedCandidateAlt', {
            name: entityName,
            number: String(candidate.index + 1),
          })}
          identity={`${source.identity}:attempt-${attempt}`}
          onExhausted={() => {
            onUnavailable();
            setFailed(true);
          }}
          onLoad={onLoaded}
          protectedSource={source.protectedSource}
          publicSource={null}
          refreshProtectedSource={refreshProtectedSource}
          style={styles.image}
        />
      )}
      {primary ? (
        <Text style={styles.primary}>{t(language, 'characterReferenceGeneratedPrimary')}</Text>
      ) : null}
      <PrimaryButton
        disabled={operationActive}
        label={t(
          language,
          selected
            ? 'characterReferenceGeneratedUnselect'
            : 'characterReferenceGeneratedSelect',
          { number: String(candidate.index + 1) },
        )}
        onPress={onToggleSelected}
      />
      <PrimaryButton
        disabled={operationActive || primary}
        label={t(language, 'characterReferenceGeneratedSetPrimary', {
          number: String(candidate.index + 1),
        })}
        onPress={onSetPrimary}
      />
    </View>
  );
}

function canConfirmGenerated(generated: GeneratedCandidateState | null): generated is GeneratedCandidateState {
  if (
    generated === null
    || generated.ambiguous
    || generated.primaryIndex === null
    || generated.selectedIndexes.length === 0
    || !generated.selectedIndexes.includes(generated.primaryIndex)
  ) {
    return false;
  }
  return generated.selectedIndexes.every((index) => generated.loadedIndexes.includes(index));
}

async function recoverAfterStartFailure(input: {
  api: Pick<EntityReferenceGenerationApiPort, 'getJobs'>;
  entityId: string;
  organizationId: string | null;
  startedAt: Date;
}): Promise<ReturnType<typeof recoverEntityGenerationJob>> {
  try {
    const page = await input.api.getJobs({ limit: JOB_HISTORY_LIMIT }, input.organizationId);
    return recoverEntityGenerationJob({
      jobs: page.jobs,
      entityId: input.entityId,
      startedAt: input.startedAt,
    });
  } catch {
    return { status: 'ambiguous' };
  }
}

function generationStartErrorMessageKey(
  error: unknown,
  ambiguous: boolean,
): MessageKey {
  if (ambiguous) {
    return 'characterReferenceGenerationAmbiguous';
  }
  if (!(error instanceof ApiError)) {
    return 'characterReferenceGenerationStartError';
  }
  if (error.status === 402) {
    return 'characterReferenceGenerationInsufficientCredits';
  }
  if (error.status === 409) {
    return 'characterReferenceGenerationConflict';
  }
  if (error.status === 429) {
    return 'characterReferenceGenerationRateLimited';
  }
  return 'characterReferenceGenerationStartError';
}

function isDefinitiveRequestRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function isActiveJob(job: GenerationJobRecord): boolean {
  return job.status === 'queued' || job.status === 'processing';
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function createOperationId(input: {
  entityId: string;
  kind: 'job' | 'start';
  organizationId: string | null;
  sessionKey: string;
  suffix?: string;
}): string {
  nextGenerationOperationSequence += 1;
  return [
    'entity-reference-generation',
    input.sessionKey,
    input.organizationId ?? 'personal',
    input.entityId,
    input.kind,
    input.suffix ?? String(nextGenerationOperationSequence),
  ].map(encodeURIComponent).join(':');
}

const styles = StyleSheet.create({
  candidateCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  controls: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  gallery: {
    gap: spacing.md,
  },
  heading: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  image: {
    aspectRatio: 0.72,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    width: '100%',
  },
  imagePlaceholder: {
    aspectRatio: 0.72,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
    width: '100%',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  primary: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
  },
});
