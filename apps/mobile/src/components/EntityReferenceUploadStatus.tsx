import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import {
  DirectEntityUploadError,
  type DirectEntityUploadStage
} from '@/lib/directEntityReferenceUpload';
import { t } from '@/lib/i18n';

interface EntityReferenceUploadStatusProps {
  error: DirectEntityUploadError | null;
  isPending: boolean;
  language: 'ja' | 'en';
  onCancel: () => void;
  onRetry: () => void;
  progress: number;
  stage: DirectEntityUploadStage | null;
}

export function EntityReferenceUploadStatus({
  error,
  isPending,
  language,
  onCancel,
  onRetry,
  progress,
  stage
}: EntityReferenceUploadStatusProps): React.JSX.Element | null {
  if (stage === null && error === null) {
    return null;
  }

  const normalizedProgress = Math.min(100, Math.max(0, Math.round(progress)));
  const showProgress = stage === 'upload' && error === null;
  const canCancel = isPending && stage !== 'finalize';

  return (
    <View style={styles.container}>
      <Text
        accessibilityLiveRegion="polite"
        style={error === null ? styles.status : styles.error}
      >
        {statusMessage(stage, error, language)}
      </Text>
      {showProgress ? (
        <>
          <View
            accessibilityLabel={t(language, "generated.components.EntityReferenceUploadStatus.image.upload.progress.b438d111")}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: normalizedProgress }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${normalizedProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{normalizedProgress}%</Text>
        </>
      ) : null}
      {canCancel ? (
        <PrimaryButton
          label={t(language, "generated.components.EntityReferenceUploadStatus.cancel.upload.5f5cbd30")}
          onPress={onCancel}
          variant="ghost"
        />
      ) : null}
      {error?.retryable === true ? (
        <PrimaryButton
          label={t(language, "generated.components.EntityReferenceUploadStatus.retry.upload.60a90669")}
          onPress={onRetry}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

function statusMessage(
  stage: DirectEntityUploadStage | null,
  error: DirectEntityUploadError | null,
  language: 'ja' | 'en'
): string {
  if (error?.code === 'UPLOAD_CANCELED') {
    return t(language, "generated.components.EntityReferenceUploadStatus.the.upload.was.canceled.e893590d");
  }
  if (error?.retryable === true) {
    return t(language, "generated.components.EntityReferenceUploadStatus.the.upload.failed.check.your.connection.b39b5507");
  }
  if (error?.stage === 'finalize') {
    return t(language, "generated.components.EntityReferenceUploadStatus.the.analysis.result.could.not.be.confirm.38d44edf");
  }
  if (error !== null) {
    return t(language, "generated.components.EntityReferenceUploadStatus.the.image.could.not.be.uploaded.select.a.ccbea7ee");
  }
  if (stage === 'presign') {
    return t(language, "generated.components.EntityReferenceUploadStatus.preparing.the.upload.60ec7a83");
  }
  if (stage === 'upload') {
    return t(language, "generated.components.EntityReferenceUploadStatus.uploading.the.image.2e1ea206");
  }
  return t(language, "generated.components.EntityReferenceUploadStatus.upload.complete.analyzing.the.image.d90e3258");
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm
  },
  error: {
    ...textStyles.body,
    color: colors.danger
  },
  progressFill: {
    backgroundColor: colors.primary,
    height: '100%'
  },
  progressText: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'right'
  },
  progressTrack: {
    backgroundColor: colors.field,
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    width: '100%'
  },
  status: {
    ...textStyles.body,
    color: colors.ink
  }
});
