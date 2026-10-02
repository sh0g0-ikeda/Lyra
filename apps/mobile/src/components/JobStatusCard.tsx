import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { JobCreditSettlement } from '@/components/JobCreditSettlement';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { CompatibleGenerationJobRecord } from '@/domain/generationJobCompatibility';
import { jobStatusPollingInterval, refundStatusRefreshWindowMs } from '@/domain/jobStatusPolling';
import { assetQuoteMessages } from '@/lib/assetQuoteMessages';
import { commonGuidanceMessages } from '@/lib/commonGuidanceMessages';
import type { GenerationJobRecord } from '@/domain/types';
import type { LyraMobileApiClient } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';
import { recordOperationalMetric } from '@/lib/operationalEvents';
import { jobQueryKey } from '@/lib/queryKeys';
import { isApiNotFoundError } from '@/lib/queryErrorPolicy';
import { userErrorMessage } from '@/lib/userMessages';

interface JobStatusCardProps {
  api: LyraMobileApiClient;
  sessionKey: string;
  jobId: string | null;
  job?: CompatibleGenerationJobRecord;
  organizationId?: string | null;
  language: 'ja' | 'en';
  onCompleted?: () => void | Promise<void>;
  onFailed?: () => void | Promise<void>;
  onCanceled?: () => void | Promise<void>;
  onMissing?: () => void | Promise<void>;
  onCancel?: (job: GenerationJobRecord) => void | Promise<void>;
  onHide?: (job: GenerationJobRecord) => void | Promise<void>;
  onRetry?: (job: GenerationJobRecord) => void | Promise<void>;
  cancelLoading?: boolean;
  hideLoading?: boolean;
  retryLoading?: boolean;
}

export function JobStatusCard({
  api,
  sessionKey,
  jobId,
  job: suppliedJob,
  organizationId = null,
  language,
  onCompleted,
  onFailed,
  onCanceled,
  onMissing,
  onCancel,
  onHide,
  onRetry,
  cancelLoading = false,
  hideLoading = false,
  retryLoading = false,
}: JobStatusCardProps): React.JSX.Element | null {
  const notifiedTerminalStateRef = useRef<string | null>(null);
  const previousJobStateRef = useRef<{
    id: string;
    status: CompatibleGenerationJobRecord['status'];
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const visible = foreground && focused;
  const copy = commonGuidanceMessages(language);
  const effectiveJobId = jobId ?? suppliedJob?.id ?? null;
  const scopeKey = `${sessionKey}:${organizationId ?? 'personal'}:${effectiveJobId ?? 'none'}`;
  const [refundWatch, setRefundWatch] = useState<{ scopeKey: string; deadline: number } | null>(null);
  const refundDeadline = refundWatch?.scopeKey === scopeKey ? refundWatch.deadline : null;
  const refundWindowExpired = refundDeadline !== null && nowMs >= refundDeadline;
  const monitorSuppliedRefund = suppliedJob?.credit_settlement?.status === 'refund_pending';
  const queryOwned = suppliedJob === undefined || monitorSuppliedRefund;
  const jobQuery = useQuery({
    enabled: queryOwned && effectiveJobId !== null && visible && !refundWindowExpired,
    queryKey: jobQueryKey(sessionKey, effectiveJobId, organizationId),
    queryFn: () => api.getJob(effectiveJobId ?? '', organizationId),
    refetchInterval: (query) => {
      if (!queryOwned || effectiveJobId === null || isApiNotFoundError(query.state.error)) return false;
      const snapshot = monitorSuppliedRefund && query.state.status === 'error'
        ? suppliedJob
        : query.state.data ?? suppliedJob;
      return jobStatusPollingInterval({
        visible,
        status: snapshot?.status,
        settlement: snapshot?.credit_settlement?.status,
        error: query.state.status === 'error',
        now: Date.now(),
        refundDeadline
      });
    },
  });

  // A supplied pending settlement may outlive the parent's generation polling.
  // Prefer this scoped fresh read until settlement resolves; never infer success.
  const job = monitorSuppliedRefund
    ? jobQuery.isFetchedAfterMount ? jobQuery.data ?? suppliedJob : suppliedJob
    : suppliedJob ?? jobQuery.data;
  const canonicalJob =
    job !== undefined && isCanonicalGenerationJob(job) ? job : null;
  const refetchJob = jobQuery.refetch;
  const status = job?.status ?? 'loading';
  const isActive = status === 'queued' || status === 'processing';
  const refundPending = job?.credit_settlement?.status === 'refund_pending';
  const queryFailed = queryOwned && jobQuery.isError;
  const jobMissing = queryFailed && isApiNotFoundError(jobQuery.error);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setForeground(nextState === 'active');
      setNowMs(Date.now());
      if (nextState === 'active' && focused && queryOwned && effectiveJobId !== null && (refundDeadline === null || Date.now() < refundDeadline)) {
        void refetchJob();
      }
    });
    return () => subscription.remove();
  }, [effectiveJobId, focused, queryOwned, refetchJob, refundDeadline]);

  // Derive a new bounded window only when the current job enters pending.
  // nowMs is a state snapshot, so rendering itself has no clock side effects.
  if (refundPending && refundDeadline === null) {
    setRefundWatch({ scopeKey, deadline: nowMs + refundStatusRefreshWindowMs });
  } else if (!refundPending && refundWatch !== null) {
    setRefundWatch(null);
  }

  useEffect(() => {
    if (!refundPending || refundDeadline === null) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(0, refundDeadline - Date.now()));
    return () => clearTimeout(timer);
  }, [refundDeadline, refundPending]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (!jobMissing || jobId === null) {
      return;
    }
    const missingStateKey = `${jobId}:missing`;
    if (notifiedTerminalStateRef.current === missingStateKey) {
      return;
    }
    notifiedTerminalStateRef.current = missingStateKey;
    void onMissing?.();
  }, [jobId, jobMissing, onMissing]);

  useEffect(() => {
    if (job === undefined) {
      return;
    }
    const previousJobState = previousJobStateRef.current;
    previousJobStateRef.current = { id: job.id, status: job.status };
    if (
      job.status !== 'completed' &&
      job.status !== 'failed' &&
      job.status !== 'canceled'
    ) {
      return;
    }
    const terminalStateKey = `${job.id}:${job.status}`;
    if (notifiedTerminalStateRef.current === terminalStateKey) {
      return;
    }
    notifiedTerminalStateRef.current = terminalStateKey;
    if (job.status === 'completed') {
      void onCompleted?.();
      return;
    }
    if (job.status === 'canceled') {
      void onCanceled?.();
      return;
    }
    if (
      previousJobState?.id === job.id &&
      (previousJobState.status === 'queued' || previousJobState.status === 'processing')
    ) {
      recordOperationalMetric({
        name: 'job_failure',
        jobId: job.id,
        requestId: job.support_id
      });
    }
    void onFailed?.();
  }, [job, onCanceled, onCompleted, onFailed]);

  if (jobId === null && suppliedJob === undefined) {
    return null;
  }
  if (jobMissing) {
    if (onMissing !== undefined) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{copy.jobUnavailable}</Text>
        <PrimaryButton label={copy.jobRefresh} onPress={() => void refetchJob()} variant="secondary" />
      </View>
    );
  }

  const displayJobId = job?.id ?? jobId ?? '';
  const progressPercent = job?.progress_percent ?? null;
  const elapsed = job === undefined ? null : formatElapsed(job.started_at ?? job.created_at, nowMs, language);
  const errorMessage = job === undefined ? null : safeJobErrorMessage(job, language);
  const canCancel = job?.actions.cancel.available ?? false;
  const cancelReason = job === undefined ? null : actionReason(job.actions.cancel.reason_key, language);
  const canHide = job?.actions.hide.available ?? false;
  const hideReason = job === undefined ? null : actionReason(job.actions.hide.reason_key, language);
  const durationEstimate = isActive
    ? jobDurationEstimate(job?.job_type, language)
    : null;

  const confirmCancel = (): void => {
    if (canonicalJob === null || onCancel === undefined || !canCancel) {
      return;
    }
    confirmAction({
      language,
      title: t(language, 'component.jobStatusCard.cancel.title'),
      message: canonicalJob.status === 'processing' ? copy.cancelProcessing : copy.cancelQueued,
      confirmLabel: t(language, 'component.jobStatusCard.cancel.confirmLabel'),
      destructive: true,
      onConfirm: () => void onCancel(canonicalJob),
    });
  };

  const confirmHide = (): void => {
    if (canonicalJob === null || onHide === undefined || !canHide) {
      return;
    }
    confirmAction({
      language,
      title: t(language, "generated.components.JobStatusCard.hide.this.job.from.history.29acca50"),
      message: t(language, "generated.components.JobStatusCard.the.result.and.audit.history.are.kept.th.46d7dc3b"),
      confirmLabel: t(language, "generated.components.JobStatusCard.hide.4c18a879"),
      destructive: true,
      onConfirm: () => void onHide(canonicalJob),
    });
  };

  return (
    <View style={[
      styles.card,
      status === 'completed' ? styles.completedCard : null,
      status === 'failed' || queryFailed ? styles.warningCard : null,
      status === 'canceled' ? styles.canceledCard : null,
    ]}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>{formatJobType(job?.job_type, language)}</Text>
          <Text style={styles.idText}>#{displayJobId.slice(0, 8)}</Text>
        </View>
        <Text style={[styles.status, statusStyle(status, queryFailed)]}>{formatStatus(status, queryFailed, language)}</Text>
      </View>

      {queryFailed ? (
        <View style={styles.failedLoad}>
          <Text style={styles.error}>{userErrorMessage(jobQuery.error, language)}</Text>
          <Text style={styles.text}>{copy.readUnknown}</Text>
          <Pressable accessibilityRole="button" onPress={() => void jobQuery.refetch()} style={styles.retryButton}>
            <Text style={styles.retryText}>{t(language, "generated.components.JobStatusCard.retry.8d32b958")}</Text>
          </Pressable>
        </View>
      ) : isActive || status === 'loading' ? (
        <>
          {status === 'loading' ? <Text style={styles.text}>{copy.statusChecking}</Text> : null}
          <View style={styles.runningRow}>
            <ActivityIndicator color={colors.primary} size="small" />
            <View style={styles.runningTextGroup}>
              <Text style={styles.text}>{progressLabel(job?.progress_stage ?? null, language)}</Text>
              {elapsed === null ? null : <Text style={styles.elapsed}>{elapsed}</Text>}
            </View>
          </View>
          {durationEstimate === null ? null : (
            <Text style={styles.estimate}>{durationEstimate}</Text>
          )}
          {progressPercent === null ? (
            <Text style={styles.indeterminate}>{t(language, "generated.components.JobStatusCard.checking.progress.8749129a")}</Text>
          ) : (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </>
          )}
        </>
      ) : (
        <View style={[styles.stateBar, status === 'failed' ? styles.stateBarWarn : status === 'canceled' ? styles.stateBarWarn : styles.stateBarGood]} />
      )}

      {refundPending ? (
        <View style={styles.failedLoad}>
          {refundWindowExpired ? <Text style={styles.text}>{copy.refundPaused}</Text> : null}
          {jobQuery.dataUpdatedAt > 0 ? <Text style={styles.elapsed}>{copy.lastChecked}: {new Date(jobQuery.dataUpdatedAt).toLocaleTimeString(language)}</Text> : null}
          <PrimaryButton label={copy.refundRefresh} loading={jobQuery.isFetching} onPress={() => void refetchJob()} variant="secondary" />
        </View>
      ) : null}

      {job === undefined || queryFailed ? null : (
        <>
          <Text style={styles.text}>{jobStatusMessage(job, language)}</Text>
          {job.credit_settlement === null ? <Text style={styles.text}>{copy.settlementUnknown}</Text> : (
            <JobCreditSettlement
              language={language}
              settlement={job.credit_settlement}
            />
          )}
          {errorMessage === null ? null : <Text style={styles.error}>{errorMessage}</Text>}
          {job.support_id === null ? null : <Text style={styles.supportId}>{t(language, "generated.components.JobStatusCard.support.id.be6bc1b5")}: {job.support_id}</Text>}
          <View style={styles.actionRow}>
            {onCancel === undefined ||
            canonicalJob === null ||
            (canonicalJob.status !== 'queued' && canonicalJob.status !== 'processing') ? null : (
              <PrimaryButton
                disabled={!canCancel}
                disabledReason={cancelReason ?? undefined}
                label={t(language, 'component.jobStatusCard.cancel.button')}
                loading={cancelLoading}
                onPress={confirmCancel}
                variant="danger"
              />
            )}
            {onRetry === undefined ||
            canonicalJob === null ||
            canonicalJob.status !== 'failed' ||
            !canonicalJob.retryable ? null : (
              <PrimaryButton
                label={t(language, "generated.components.JobStatusCard.try.again.a428737b")}
                loading={retryLoading}
                onPress={() => void onRetry(canonicalJob)}
                variant="secondary"
              />
            )}
            {onHide === undefined ||
            canonicalJob === null ||
            !isTerminal(canonicalJob.status) ? null : (
              <PrimaryButton
                disabled={!canHide}
                disabledReason={hideReason ?? undefined}
                label={t(language, "generated.components.JobStatusCard.hide.from.history.d0dd3da0")}
                loading={hideLoading}
                onPress={confirmHide}
                variant="ghost"
              />
            )}
          </View>
        </>
      )}
    </View>
  );
}

function formatJobType(jobType: string | undefined, language: 'ja' | 'en'): string {
  if (jobType === 'entity_import_analysis') return assetQuoteMessages(language).entity_import_analysis;
  const labels: Record<string, ComponentTranslationKey> = {
    page_generate: 'component.jobStatusCard.type.pageGenerate',
    entity_generate: 'component.jobStatusCard.type.entityGenerate',
    episode_story_autofill: 'component.jobStatusCard.type.episodeStoryAutofill',
    episode_page_skeleton: 'component.jobStatusCard.type.episodePageSkeleton'
  };
  const label = jobType === undefined ? undefined : labels[jobType];
  return label === undefined ? jobType ?? t(language, "generated.components.JobStatusCard.job.a047f3b5") : t(language, label);
}

function jobDurationEstimate(
  jobType: string | undefined,
  language: 'ja' | 'en'
): string | null {
  if (jobType === 'page_generate' || jobType === 'entity_generate') {
    return t(language, 'component.jobStatusCard.imageDurationEstimate');
  }
  if (jobType === 'episode_story_autofill') {
    return t(language, 'component.jobStatusCard.storyAutofillDurationEstimate');
  }
  return null;
}

function formatStatus(status: string, queryFailed: boolean, language: 'ja' | 'en'): string {
  if (queryFailed) {
    return t(language, "generated.components.JobStatusCard.load.failed.94fa0ba4");
  }
  const labels: Record<string, ComponentTranslationKey> = {
    loading: 'component.jobStatusCard.status.loading',
    queued: 'component.jobStatusCard.status.queued',
    processing: 'component.jobStatusCard.status.processing',
    completed: 'component.jobStatusCard.status.completed',
    failed: 'component.jobStatusCard.status.failed',
    canceled: 'component.jobStatusCard.status.canceled'
  };
  const label = labels[status] ?? labels.loading;
  return t(language, label);
}

function progressLabel(
  stage: CompatibleGenerationJobRecord['progress_stage'],
  language: 'ja' | 'en',
): string {
  const labels: Record<NonNullable<CompatibleGenerationJobRecord['progress_stage']>, ComponentTranslationKey> = {
    queued: 'component.jobStatusCard.progress.queued',
    started: 'component.jobStatusCard.progress.started',
    compiling: 'component.jobStatusCard.progress.compiling',
    preparing_references: 'component.jobStatusCard.progress.preparingReferences',
    generating: 'component.jobStatusCard.progress.generating',
    saving: 'component.jobStatusCard.progress.saving',
    applying_story_plan: 'component.jobStatusCard.progress.applyingStoryPlan',
    planning_episode: 'component.jobStatusCard.progress.planningEpisode',
    compiling_chunk: 'component.jobStatusCard.progress.compilingChunk',
    compiled_chunk: 'component.jobStatusCard.progress.compiledChunk',
    auditing_episode: 'component.jobStatusCard.progress.auditingEpisode',
    repairing_chunk: 'component.jobStatusCard.progress.repairingChunk',
    applying: 'component.jobStatusCard.progress.applying',
    cancellation_requested: 'component.jobStatusCard.progress.cancellationRequested',
    completed: 'component.jobStatusCard.progress.completed',
    failed: 'component.jobStatusCard.status.failed',
    canceled: 'component.jobStatusCard.status.canceled'
  };
  const label = stage === null ? undefined : labels[stage];
  return label === undefined ? t(language, "generated.components.JobStatusCard.checking.status.243ad6bb") : t(language, label);
}

function jobStatusMessage(job: CompatibleGenerationJobRecord, language: 'ja' | 'en'): string {
  if (job.status === 'completed') {
    return t(language, "generated.components.JobStatusCard.generation.completed.related.screens.wil.dc316fe2");
  }
  if (job.status === 'canceled') {
    return t(language, 'component.jobStatusCard.canceledMessage');
  }
  if (job.status === 'failed') {
    return safeJobErrorMessage(job, language) ?? t(language, "generated.components.JobStatusCard.generation.failed.cbed2f2e");
  }
  return t(language, "generated.components.JobStatusCard.status.updates.automatically.until.compl.5431e6ef");
}

function safeJobErrorMessage(job: CompatibleGenerationJobRecord, language: 'ja' | 'en'): string | null {
  if (job.message_key === 'job.error.cancelled') {
    return t(language, "generated.components.JobStatusCard.this.generation.was.canceled.e5230588");
  }
  if (job.message_key === 'job.error.inputInvalid') {
    return t(language, "generated.components.JobStatusCard.review.the.inputs.before.trying.again.90b37195");
  }
  if (job.message_key === 'job.error.temporarilyUnavailable') {
    return t(language, "generated.components.JobStatusCard.generation.is.temporarily.unavailable.tr.46a7ef24");
  }
  if (job.message_key === 'job.error.failed') {
    return t(language, "generated.components.JobStatusCard.generation.failed.try.again.shortly.d9c487aa");
  }
  return null;
}

function actionReason(reasonKey: string | null, language: 'ja' | 'en'): string | null {
  if (reasonKey === 'job.action.cancelRequested') {
    return t(language, 'component.jobStatusCard.cancel.requested');
  }
  if (reasonKey === 'job.action.cancelProcessingUnsupported') {
    return t(language, "generated.components.JobStatusCard.processing.jobs.cannot.be.safely.stopped.63f1d345");
  }
  if (reasonKey === 'job.action.cancelOnlyQueued') {
    return t(language, "generated.components.JobStatusCard.only.queued.jobs.can.be.stopped.752a77c6");
  }
  if (reasonKey === 'job.action.hideOnlyTerminal') {
    return t(language, "generated.components.JobStatusCard.only.terminal.jobs.can.be.hidden.fe31978b");
  }
  return null;
}

function formatElapsed(startedAt: string, nowMs: number, language: 'ja' | 'en'): string {
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) {
    return '';
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return t(language, 'component.jobStatusCard.elapsed', { minutes, seconds });
}

function isTerminal(status: GenerationJobRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function isCanonicalGenerationJob(
  job: CompatibleGenerationJobRecord,
): job is GenerationJobRecord {
  return job.credit_settlement !== null;
}

function statusStyle(status: string, queryFailed: boolean): object {
  if (queryFailed || status === 'failed') {
    return styles.statusWarn;
  }
  if (status === 'completed') {
    return styles.statusGood;
  }
  if (status === 'canceled' || status === 'queued') {
    return styles.statusWarn;
  }
  return styles.statusInfo;
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  canceledCard: {
    borderColor: 'rgba(255, 213, 106, 0.44)',
  },
  card: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  completedCard: {
    borderColor: 'rgba(120, 215, 123, 0.44)',
  },
  estimate: {
    ...textStyles.caption,
    color: colors.primary,
  },
  elapsed: {
    ...textStyles.caption,
    color: colors.muted,
  },
  error: {
    ...textStyles.body,
    color: '#FFD56A',
  },
  failedLoad: {
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  idText: {
    ...textStyles.caption,
  },
  indeterminate: {
    ...textStyles.caption,
    color: colors.muted,
  },
  progressFill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: '100%',
  },
  progressPercent: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'right',
  },
  progressTrack: {
    backgroundColor: colors.field,
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  retryButton: {
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...textStyles.body,
    color: colors.ink,
    fontWeight: '700',
  },
  runningRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  runningTextGroup: {
    flex: 1,
    gap: 2,
  },
  stateBar: {
    borderRadius: 999,
    height: 5,
    width: '100%',
  },
  stateBarGood: {
    backgroundColor: colors.success,
  },
  stateBarWarn: {
    backgroundColor: '#FFD56A',
  },
  status: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusGood: {
    backgroundColor: colors.successSurface,
    color: '#78D77B',
  },
  statusInfo: {
    backgroundColor: colors.infoSurface,
    color: '#7CE2F0',
  },
  statusWarn: {
    backgroundColor: colors.warningSurface,
    color: '#FFD56A',
  },
  supportId: {
    ...textStyles.caption,
    color: colors.muted,
  },
  text: {
    ...textStyles.caption,
  },
  title: {
    ...textStyles.body,
    fontWeight: '700',
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  warningCard: {
    borderColor: 'rgba(255, 193, 7, 0.44)',
  },
});
