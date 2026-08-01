import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { ExportFormat, ExportJobRecord } from '@/domain/types';
import type { LyraMobileApiClient } from '@/lib/api';
import { fileTransferErrorMessage } from '@/lib/fileTransferError';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';
import { exportJobQueryKey } from '@/lib/queryKeys';
import { isApiNotFoundError } from '@/lib/queryErrorPolicy';

interface ExportJobCardProps {
  api: LyraMobileApiClient;
  filename: string;
  format: ExportFormat;
  sessionKey: string;
  jobId: string | null;
  job?: ExportJobRecord;
  organizationId?: string | null;
  language: 'ja' | 'en';
  onDownload?: (jobId: string) => void | Promise<void>;
}

export function ExportJobCard({
  api,
  filename,
  format,
  sessionKey,
  jobId,
  job: suppliedJob,
  organizationId = null,
  language,
  onDownload
}: ExportJobCardProps): React.JSX.Element | null {
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const jobQuery = useQuery({
    enabled: suppliedJob === undefined && jobId !== null,
    queryKey: exportJobQueryKey(sessionKey, jobId, organizationId),
    queryFn: () => api.getExportJob(jobId ?? '', organizationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return suppliedJob === undefined && (status === 'queued' || status === 'processing') ? 2500 : false;
    }
  });
  const job = suppliedJob ?? jobQuery.data;

  if (jobId === null && suppliedJob === undefined) {
    return null;
  }
  if (isApiNotFoundError(jobQuery.error)) {
    return null;
  }
  if (job === undefined && jobQuery.isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.text}>{t(language, "generated.components.ExportJobCard.checking.export.status.7f6c2815")}</Text>
      </View>
    );
  }
  if (job === undefined || (jobQuery.error !== null && jobQuery.error !== undefined)) {
    return (
      <View style={[styles.card, styles.failedCard]}>
        <Text style={styles.error}>{t(language, "generated.components.ExportJobCard.export.status.could.not.be.loaded.b74442ee")}</Text>
      </View>
    );
  }

  const isCompleted = job.status === 'completed';
  const canDownload = isCompleted && job.download_ready && onDownload !== undefined;
  const startDownload = async (): Promise<void> => {
    if (!canDownload || onDownload === undefined) {
      return;
    }
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      await onDownload(job.job_id);
    } catch (error) {
      setDownloadError(fileTransferErrorMessage(error, language));
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <View style={[styles.card, job.status === 'failed' ? styles.failedCard : null, isCompleted ? styles.completedCard : null]}>
      <View style={styles.header}>
        <Text style={styles.title}>{filename}</Text>
        <Text style={[styles.status, statusStyle(job.status)]}>{statusLabel(job.status, language)}</Text>
      </View>
      <Text style={styles.text}>{formatLabel(format, language)}</Text>
      {isCompleted || job.status === 'failed' || job.status === 'canceled' ? null : (
        <>
          <Text style={styles.text}>{stageLabel(job.progress.stage, language)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${job.progress.percent}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{job.progress.percent}%</Text>
        </>
      )}
      {job.status === 'failed' ? <Text style={styles.error}>{failureMessage(language)}</Text> : null}
      {isCompleted && !job.download_ready ? (
        <Text style={styles.text}>{t(language, "generated.components.ExportJobCard.export.finished.but.its.download.link.is.8471ea4b")}</Text>
      ) : null}
      {downloadError === null ? null : <Text style={styles.error}>{downloadError}</Text>}
      {canDownload ? (
        <PrimaryButton
          label={downloadLabel(format, language)}
          loading={downloadLoading}
          onPress={() => void startDownload()}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

function downloadLabel(format: ExportFormat, language: 'ja' | 'en'): string {
  return t(
    language,
    format === 'pdf' ? 'component.exportJobCard.savePdf' : 'component.exportJobCard.saveZip'
  );
}

function formatLabel(format: ExportFormat, language: 'ja' | 'en'): string {
  return format === 'pdf'
    ? t(language, "generated.components.ExportJobCard.pdf.beb82eae")
    : t(language, "generated.components.ExportJobCard.zip.6c74e08c");
}

function statusLabel(status: ExportJobRecord['status'], language: 'ja' | 'en'): string {
  const labels: Record<ExportJobRecord['status'], ComponentTranslationKey> = {
    queued: 'component.exportJobCard.status.queued',
    processing: 'component.exportJobCard.status.processing',
    completed: 'component.exportJobCard.status.completed',
    failed: 'component.exportJobCard.status.failed',
    canceled: 'component.exportJobCard.status.canceled'
  };
  const label = labels[status];
  return t(language, label);
}

function stageLabel(stage: string, language: 'ja' | 'en'): string {
  const labels: Record<string, ComponentTranslationKey> = {
    queued: 'component.exportJobCard.stage.queued',
    processing: 'component.exportJobCard.stage.processing',
    downloading: 'component.exportJobCard.stage.downloading',
    building: 'component.exportJobCard.stage.building',
    uploading: 'component.exportJobCard.stage.uploading'
  };
  const label = labels[stage];
  return label === undefined
    ? t(language, "generated.components.ExportJobCard.processing.export.c3107efe")
    : t(language, label);
}

function failureMessage(language: 'ja' | 'en'): string {
  return t(language, "generated.components.ExportJobCard.export.failed.try.again.shortly.86d7d749");
}

function statusStyle(status: ExportJobRecord['status']): object {
  if (status === 'failed') return styles.statusWarn;
  if (status === 'completed') return styles.statusGood;
  if (status === 'canceled') return styles.statusWarn;
  return styles.statusInfo;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  completedCard: { borderColor: 'rgba(120, 215, 123, 0.44)' },
  error: { ...textStyles.body, color: '#FFD56A' },
  failedCard: { borderColor: 'rgba(255, 193, 7, 0.44)' },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  progressFill: { backgroundColor: colors.primary, height: '100%' },
  progressPercent: { ...textStyles.caption, color: colors.primary, fontWeight: '700', textAlign: 'right' },
  progressTrack: { backgroundColor: colors.field, borderRadius: radius.sm, height: 6, overflow: 'hidden', width: '100%' },
  status: { borderRadius: radius.sm, fontSize: 12, fontWeight: '700', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusGood: { backgroundColor: colors.successSurface, color: '#78D77B' },
  statusInfo: { backgroundColor: colors.infoSurface, color: '#7CE2F0' },
  statusWarn: { backgroundColor: colors.warningSurface, color: '#FFD56A' },
  text: { ...textStyles.caption },
  title: { ...textStyles.body, flex: 1, fontWeight: '700', minWidth: 0 }
});
