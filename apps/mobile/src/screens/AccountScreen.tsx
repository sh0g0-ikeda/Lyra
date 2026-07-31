import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadingState } from '../components/LoadingState';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, spacing } from '../constants/theme';
import type {
  CurrentSession,
  GenerationJobRecord,
  ListJobsPageInput,
} from '../lib/api';
import { t, type UiLanguage } from '../lib/i18n';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { userErrorMessage } from '../lib/userMessages';

const JOB_PAGE_LIMIT = 25;

interface AccountJobsPage {
  jobs: GenerationJobRecord[];
  next_cursor: string | null;
}

export interface AccountScreenApiPort {
  getJobs(
    input: ListJobsPageInput,
    organizationId?: string | null,
  ): Promise<AccountJobsPage>;
}

interface AccountScreenProps {
  api: AccountScreenApiPort;
  language: UiLanguage;
  onOrganizationChange(organizationId: string | null): void;
  onSignOut?(): Promise<void>;
  organizationId: string | null;
  session: CurrentSession;
}

export function AccountScreen({
  api,
  language,
  onOrganizationChange,
  onSignOut,
  organizationId,
  session,
}: AccountScreenProps): React.JSX.Element {
  const queryKeys = useMemo(
    () => storyQueryKeys(session.user.id, organizationId),
    [organizationId, session.user.id],
  );
  const activeOrganization = session.organizations.find(
    (organization) => organization.id === organizationId
      && organization.membership_status === 'active',
  ) ?? null;
  const availableOrganizations = session.organizations.filter(
    (organization) => organization.membership_status === 'active',
  );
  const jobsQuery = useQuery({
    queryFn: () => api.getJobs({ limit: JOB_PAGE_LIMIT }, organizationId),
    queryKey: queryKeys.jobs(),
  });
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const displayedCredits = organizationId === null
    ? session.personal_credits?.total_credits ?? 0
    : activeOrganization?.total_credits ?? 0;
  const jobs = jobsQuery.data?.jobs ?? [];
  const showEmptyJobs = jobsQuery.isSuccess && jobs.length === 0;
  const showJobsError = jobsQuery.isError && !jobsQuery.isFetching;

  const handleSignOut = async (): Promise<void> => {
    if (onSignOut === undefined || signingOut) {
      return;
    }
    setSigningOut(true);
    setSignOutError(null);
    try {
      await onSignOut();
    } catch (error: unknown) {
      setSignOutError(userErrorMessage(error, language));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <AccountSection title={t(language, 'accountProfile')}>
        <Text style={styles.metric}>{session.user.email}</Text>
        <Text style={styles.caption}>{session.user.display_name ?? session.user.id}</Text>
      </AccountSection>

      <AccountSection
        subtitle={t(language, 'accountWorkspaceHelp')}
        title={t(language, 'accountWorkspace')}
      >
        <View style={styles.workspaceList}>
          <WorkspaceButton
            active={organizationId === null}
            label={t(language, 'accountPersonalWorkspace')}
            language={language}
            onPress={() => onOrganizationChange(null)}
          />
          {availableOrganizations.map((organization) => (
            <WorkspaceButton
              active={organization.id === organizationId}
              key={organization.id}
              label={organization.name}
              language={language}
              onPress={() => onOrganizationChange(organization.id)}
            />
          ))}
        </View>
      </AccountSection>

      <AccountSection title={t(language, 'accountBilling')}>
        <Text style={styles.metric}>
          {t(language, 'accountCredits', { count: String(displayedCredits) })}
        </Text>
      </AccountSection>

      <AccountSection title={t(language, 'accountJobs')}>
        {jobsQuery.isLoading ? (
          <LoadingState label={t(language, 'accountJobsLoading')} />
        ) : null}
        {showJobsError ? (
          <View style={styles.errorBlock}>
            <Notice message={t(language, 'accountJobsError')} tone="danger" />
            <RetryButton
              label={t(language, 'accountJobsRetry')}
              onPress={() => void jobsQuery.refetch()}
            />
          </View>
        ) : null}
        {jobs.map((job) => (
          <View key={job.id} style={styles.jobRow}>
            <Text style={styles.metric}>{job.job_type}</Text>
            <Text style={styles.caption}>{job.status}</Text>
          </View>
        ))}
        {showEmptyJobs ? (
          <Text style={styles.caption}>{t(language, 'accountNoJobs')}</Text>
        ) : null}
      </AccountSection>

      {signOutError === null ? null : (
        <Notice message={signOutError} tone="danger" />
      )}
      {onSignOut === undefined ? null : (
        <PrimaryButton
          label={t(language, 'logout')}
          loading={signingOut}
          onPress={() => void handleSignOut()}
          tone="danger"
        />
      )}
    </View>
  );
}

function AccountSection({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle?: string;
  title: string;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle === undefined ? null : (
        <Text style={styles.caption}>{subtitle}</Text>
      )}
      {children}
    </View>
  );
}

function WorkspaceButton({
  active,
  label,
  language,
  onPress,
}: {
  active: boolean;
  label: string;
  language: UiLanguage;
  onPress(): void;
}): React.JSX.Element {
  const accessibilityLabel = language === 'ja'
    ? `${label}に切り替え`
    : `Switch to ${label}`;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.workspaceButton,
        active && styles.workspaceButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.workspaceLabel, active && styles.workspaceLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function RetryButton({
  label,
  onPress,
}: {
  label: string;
  onPress(): void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
    >
      <Text style={styles.retryLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  caption: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  container: {
    gap: spacing.md,
  },
  errorBlock: {
    gap: spacing.sm,
  },
  jobRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  metric: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderColor: colors.accent,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryLabel: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  workspaceButton: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  workspaceButtonActive: {
    borderColor: colors.accent,
  },
  workspaceLabel: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  workspaceLabelActive: {
    color: colors.accent,
  },
  workspaceList: {
    gap: spacing.sm,
  },
});
