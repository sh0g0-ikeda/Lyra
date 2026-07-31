import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { GenerationJobRecord, PageRecord } from '../lib/api';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { LoadingState } from './LoadingState';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

interface PagePlanningSectionProps {
  activeJob: GenerationJobRecord | null;
  episodeGenerated: boolean;
  generationActive: boolean;
  generationBusy: boolean;
  generationError: string | null;
  generationNotice: string | null;
  jobStatusError: boolean;
  language: UiLanguage;
  loading: boolean;
  loadError: boolean;
  pages: readonly PageRecord[];
  onAutofill(): void;
  onGenerate(): void;
  onRetryJob(): void;
  onRetryPages(): void;
}

export function PagePlanningSection({
  activeJob,
  episodeGenerated,
  generationActive,
  generationBusy,
  generationError,
  generationNotice,
  jobStatusError,
  language,
  loading,
  loadError,
  pages,
  onAutofill,
  onGenerate,
  onRetryJob,
  onRetryPages,
}: PagePlanningSectionProps): React.JSX.Element {
  const protectedFromOverwrite = pages.length > 0 || episodeGenerated;
  const confirmedPageExists = pages.some((page) => page.status === 'confirmed');
  const generatingPageExists = pages.some((page) => page.status === 'generating');
  const pageLimitExceeded = pages.length > 32;
  const invalidPageStructureExists = pages.some(
    (page) => page.frame_count === 0 || page.panel_count !== page.frame_count,
  );
  const storyAutofillBlocked = loading
    || loadError
    || generationBusy
    || confirmedPageExists
    || generatingPageExists
    || pageLimitExceeded
    || invalidPageStructureExists;
  const progress = activeJob === null ? null : readJobProgress(activeJob);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{t(language, 'pagePlanning')}</Text>
      <Text style={styles.muted}>{t(language, 'pagePlanningHelp')}</Text>
      {loading ? <LoadingState label={t(language, 'pageLoading')} /> : null}
      {loadError ? (
        <View style={styles.noticeGroup}>
          <Notice message={t(language, 'pageLoadError')} tone="danger" />
          <PrimaryButton
            label={t(language, 'pageListRetry')}
            onPress={onRetryPages}
          />
        </View>
      ) : null}
      {!loading && !loadError && pages.length === 0 ? (
        <Text style={styles.muted}>{t(language, 'pageEmpty')}</Text>
      ) : null}
      {pages.map((page) => (
        <View key={page.id} style={styles.pageCard}>
          <Text style={styles.pageTitle}>
            {t(language, 'pageLabel', { number: String(page.page_number) })}
          </Text>
          <Text style={styles.muted}>{pageStatusLabel(language, page.status)}</Text>
          <Text style={styles.muted}>
            {t(language, 'pagePanelCount', { count: String(page.panel_count) })}
          </Text>
        </View>
      ))}
      {protectedFromOverwrite ? (
        <Notice message={t(language, 'pageOverwriteProtected')} />
      ) : (
        <PrimaryButton
          disabled={loading || loadError || generationBusy}
          label={t(language, 'pageGenerateSkeleton')}
          loading={generationBusy && !generationActive}
          onPress={onGenerate}
        />
      )}
      {pages.length === 0 ? null : (
        <View style={styles.noticeGroup}>
          <Text style={styles.muted}>{t(language, 'pageStoryAutofillHelp')}</Text>
          {confirmedPageExists ? (
            <Notice message={t(language, 'pageStoryAutofillConfirmedBlocked')} />
          ) : generatingPageExists ? (
            <Notice message={t(language, 'pageStoryAutofillGeneratingBlocked')} />
          ) : pageLimitExceeded ? (
            <Notice message={t(language, 'pageStoryAutofillPageLimitBlocked')} />
          ) : invalidPageStructureExists ? (
            <Notice message={t(language, 'pageStoryAutofillStructureBlocked')} />
          ) : null}
          <PrimaryButton
            disabled={storyAutofillBlocked}
            label={t(language, 'pageStoryAutofill')}
            loading={generationBusy && !generationActive}
            onPress={onAutofill}
          />
        </View>
      )}
      {!generationActive ? null : (
        <View style={styles.noticeGroup}>
          <Notice message={t(language, 'pageGenerationActive')} />
          {progress === null ? null : (
            <Text style={styles.muted}>
              {t(language, 'pageGenerationProgress', {
                current: String(progress.current),
                total: String(progress.total),
              })}
            </Text>
          )}
        </View>
      )}
      {jobStatusError ? (
        <View style={styles.noticeGroup}>
          <Notice message={t(language, 'pageJobStatusError')} tone="danger" />
          <PrimaryButton label={t(language, 'retry')} onPress={onRetryJob} />
        </View>
      ) : null}
      {generationError === null ? null : (
        <Notice message={generationError} tone="danger" />
      )}
      {generationNotice === null ? null : <Notice message={generationNotice} />}
    </View>
  );
}

function readJobProgress(
  job: GenerationJobRecord,
): { current: number; total: number } | null {
  if (
    job.job_type !== 'episode_page_skeleton'
    && job.job_type !== 'episode_story_autofill'
  ) {
    return null;
  }
  const current = job.result?.progress_current_chunk;
  const total = job.result?.progress_total_chunks;
  if (
    current === null
    || current === undefined
    || total === null
    || total === undefined
    || total <= 0
  ) {
    return null;
  }
  return { current, total };
}

function pageStatusLabel(
  language: UiLanguage,
  status: PageRecord['status'],
): string {
  const keys: Record<PageRecord['status'], MessageKey> = {
    confirmed: 'pageStatusConfirmed',
    designing: 'pageStatusDesigning',
    editing: 'pageStatusEditing',
    generated: 'pageStatusGenerated',
    generating: 'pageStatusGenerating',
  };
  return t(language, keys[status]);
}

const styles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  noticeGroup: {
    gap: spacing.sm,
  },
  pageCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  pageTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  section: {
    gap: spacing.sm,
  },
});
