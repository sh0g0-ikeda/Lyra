import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AccountDeletionPanel } from '../components/AccountDeletionPanel';
import { LoadingState } from '../components/LoadingState';
import { MobileStoreBillingPanel } from '../components/MobileStoreBillingPanel';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, spacing } from '../constants/theme';
import type {
  AccountDeletionPreviewRecord,
  AccountDeletionRequestInput,
  AccountDeletionResultRecord,
  CurrentSession,
  GenerationJobRecord,
  ListJobsPageInput,
  MobilePurchaseAccountBindingRecord,
  MobileStoreProductCatalogRecord,
  MobileStorePurchaseResultRecord,
  MobileStoreRestoreResultRecord,
  RestoreMobilePurchasesInput,
  VerifyAppleMobilePurchaseInput,
  VerifyGoogleMobilePurchaseInput,
} from '../lib/api';
import { config } from '../lib/config';
import { createExpoIapSdk } from '../lib/expoIapSdk';
import { t, type UiLanguage } from '../lib/i18n';
import {
  createMobileStoreBillingBackend,
  toNativeStoreProductDefinitions,
} from '../lib/mobileStoreBillingBridge';
import {
  createNativeStoreBillingAdapter,
  type NativeStoreBillingAdapter,
  type NativeStoreName,
} from '../lib/nativeStoreBilling';
import { storyQueryKeys } from '../lib/storyQueryKeys';
import { userErrorMessage } from '../lib/userMessages';

const JOB_PAGE_LIMIT = 25;

interface AccountJobsPage {
  jobs: GenerationJobRecord[];
  next_cursor: string | null;
}

export interface AccountScreenApiPort {
  getAccountDeletionPreview(): Promise<AccountDeletionPreviewRecord>;
  getJobs(
    input: ListJobsPageInput,
    organizationId?: string | null,
  ): Promise<AccountJobsPage>;
  getCurrentSession(): Promise<CurrentSession>;
  getMobilePurchaseBinding(): Promise<MobilePurchaseAccountBindingRecord>;
  getMobileStoreProductCatalog(store: NativeStoreName): Promise<MobileStoreProductCatalogRecord>;
  restoreMobilePurchases(
    input: RestoreMobilePurchasesInput,
  ): Promise<MobileStoreRestoreResultRecord>;
  requestAccountDeletion(
    input: AccountDeletionRequestInput,
  ): Promise<AccountDeletionResultRecord>;
  verifyAppleMobilePurchase(
    input: VerifyAppleMobilePurchaseInput,
  ): Promise<MobileStorePurchaseResultRecord>;
  verifyGoogleMobilePurchase(
    input: VerifyGoogleMobilePurchaseInput,
  ): Promise<MobileStorePurchaseResultRecord>;
}

interface AccountScreenProps {
  accountDeletionEnabled?: boolean;
  api: AccountScreenApiPort;
  language: UiLanguage;
  onOrganizationChange(organizationId: string | null): void;
  onSessionRefresh?(): Promise<void>;
  onSignOut?(): Promise<void>;
  organizationId: string | null;
  session: CurrentSession;
  mobileStoreBillingEnabled?: boolean;
}

export function AccountScreen({
  accountDeletionEnabled = config.accountDeletionEnabled,
  api,
  language,
  mobileStoreBillingEnabled = config.mobileStoreBillingEnabled,
  onOrganizationChange,
  onSessionRefresh,
  onSignOut,
  organizationId,
  session,
}: AccountScreenProps): React.JSX.Element {
  const [deletionOpen, setDeletionOpen] = useState(false);
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
  const nativeStore = storeForPlatform();
  const purchaseEnabled = mobileStoreBillingEnabled
    && organizationId === null
    && nativeStore !== null;
  const catalogQuery = useQuery({
    enabled: purchaseEnabled,
    queryFn: async () => {
      if (nativeStore === null) throw new Error('Store unavailable');
      return api.getMobileStoreProductCatalog(nativeStore);
    },
    queryKey: ['mobile-store-product-catalog', session.user.id, nativeStore],
  });
  const deletionAvailable = accountDeletionEnabled && onSignOut !== undefined;
  const deletionQuery = useQuery({
    enabled: deletionAvailable && deletionOpen,
    queryFn: () => api.getAccountDeletionPreview(),
    queryKey: ['account-deletion-preview', session.user.id],
  });
  const billingAdapter = useMemo<NativeStoreBillingAdapter | null>(() => {
    if (!purchaseEnabled || catalogQuery.data === undefined) return null;
    try {
      const products = toNativeStoreProductDefinitions(catalogQuery.data, language);
      if (products.length === 0) return null;
      return createNativeStoreBillingAdapter({
        backend: createMobileStoreBillingBackend(api),
        products,
        sdk: createExpoIapSdk(),
      });
    } catch {
      return null;
    }
  }, [api, catalogQuery.data, language, purchaseEnabled]);
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
        {organizationId === null && mobileStoreBillingEnabled ? (
          <PurchaseContent
            adapter={billingAdapter}
            catalog={catalogQuery.data}
            catalogError={catalogQuery.isError}
            catalogLoading={catalogQuery.isLoading}
            language={language}
            nativeStore={nativeStore}
            onRetryCatalog={() => void catalogQuery.refetch()}
            onVerified={onSessionRefresh}
          />
        ) : null}
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

      {deletionAvailable ? (
        <AccountSection title={t(language, 'accountDeletionSection')}>
          <RetryButton
            label={deletionOpen
              ? t(language, 'accountDeletionClose')
              : t(language, 'accountDeletionOpen')}
            onPress={() => setDeletionOpen((current) => !current)}
          />
          {deletionOpen ? (
            <AccountDeletionContent
              api={api}
              language={language}
              onCompleted={onSignOut}
              preview={deletionQuery.data}
              previewError={deletionQuery.isError}
              previewLoading={deletionQuery.isLoading}
              reloadPreview={async () => {
                const refreshed = await deletionQuery.refetch();
                if (refreshed.error !== null) throw refreshed.error;
              }}
            />
          ) : null}
        </AccountSection>
      ) : null}

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

function AccountDeletionContent({
  api,
  language,
  onCompleted,
  preview,
  previewError,
  previewLoading,
  reloadPreview,
}: {
  api: AccountScreenApiPort;
  language: UiLanguage;
  onCompleted(): Promise<void>;
  preview: AccountDeletionPreviewRecord | undefined;
  previewError: boolean;
  previewLoading: boolean;
  reloadPreview(): Promise<void>;
}): React.JSX.Element {
  if (previewLoading) {
    return <LoadingState label={t(language, 'accountDeletionReloadPreview')} />;
  }
  if (previewError || preview === undefined) {
    return (
      <View style={styles.errorBlock}>
        <Notice message={t(language, 'accountDeletionUnavailable')} tone="danger" />
        <RetryButton
          label={t(language, 'accountDeletionReloadPreview')}
          onPress={() => void reloadPreview().catch(() => undefined)}
        />
      </View>
    );
  }
  return (
    <AccountDeletionPanel
      api={api}
      language={language}
      onCompleted={onCompleted}
      onReloadPreview={reloadPreview}
      preview={preview}
    />
  );
}

function PurchaseContent({
  adapter,
  catalog,
  catalogError,
  catalogLoading,
  language,
  nativeStore,
  onRetryCatalog,
  onVerified,
}: {
  adapter: NativeStoreBillingAdapter | null;
  catalog: MobileStoreProductCatalogRecord | undefined;
  catalogError: boolean;
  catalogLoading: boolean;
  language: UiLanguage;
  nativeStore: NativeStoreName | null;
  onRetryCatalog(): void;
  onVerified?(): Promise<void>;
}): React.JSX.Element {
  let content: React.ReactNode;
  if (nativeStore === null) {
    content = <Notice message={t(language, 'purchaseUnavailablePlatform')} />;
  } else if (catalogLoading) {
    content = <LoadingState label={t(language, 'purchaseLoading')} />;
  } else if (catalogError) {
    content = (
      <View style={styles.errorBlock}>
        <Notice message={t(language, 'purchaseDisabled')} tone="danger" />
        <RetryButton label={t(language, 'purchaseRetryCatalog')} onPress={onRetryCatalog} />
      </View>
    );
  } else if (catalog?.products.length === 0) {
    content = <Notice message={t(language, 'purchaseEmpty')} />;
  } else if (adapter === null) {
    content = <Notice message={t(language, 'purchaseDisabled')} tone="danger" />;
  } else {
    content = (
      <MobileStoreBillingPanel
        adapter={adapter}
        language={language}
        onVerified={onVerified === undefined ? undefined : async () => onVerified()}
      />
    );
  }
  return (
    <View style={styles.purchaseSection}>
      <Text style={styles.subsectionTitle}>{t(language, 'purchaseSection')}</Text>
      {content}
    </View>
  );
}

function storeForPlatform(): NativeStoreName | null {
  if (Platform.OS === 'ios') return 'apple';
  if (Platform.OS === 'android') return 'google';
  return null;
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
  purchaseSection: {
    gap: spacing.sm,
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
  subsectionTitle: {
    color: colors.ink,
    fontSize: 17,
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
