import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { FormField } from '@/components/FormField';
import { JobStatusCard } from '@/components/JobStatusCard';
import { MobileStoreBillingPanel } from '@/components/MobileStoreBillingPanel';
import { Notice } from '@/components/Notice';
import { OrganizationManagementModal } from '@/components/OrganizationManagementModal';
import { OrganizationManagementPanel } from '@/components/OrganizationManagementPanel';
import { PersonalBillingSummary } from '@/components/PersonalBillingSummary';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { SegmentedControl } from '@/components/SegmentedControl';
import { colors, spacing, textStyles } from '@/constants/theme';
import {
  deletionResultMessage,
  personalAssetDeletionAcknowledgement,
  personalSubscriptionDeletionAcknowledgement,
  storeBillingDeletionAcknowledgement
} from '@/domain/accountDeletionCopy';
import { config } from '@/lib/config';
import type { LyraMobileApiClient } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { downloadAuthenticatedFile } from '@/lib/download';
import { t } from '@/lib/i18n';
import type { ScreenTranslationKey } from '@/lib/i18nScreenMessages';
import { balanceQueryKey, jobsQueryKey, sessionQueryKey } from '@/lib/queryKeys';
import { userErrorMessage } from '@/lib/userMessages';
import {
  createMobileStoreBillingBackend,
  toNativeStoreProductDefinitions
} from '@/lib/mobileStoreBillingBridge';
import {
  createExpoIapSdk,
  createNativeStoreBillingAdapter
} from '@/lib/nativeStoreBilling';
import { useAppState } from '@/state/appState';
import type {
  AccountDeletionPreviewRecord,
  AccountDeletionResultRecord,
  GenerationJobRecord,
  OrganizationMemberRecord
} from '@/domain/types';

const nativeMobileStore: 'apple' | 'google' | null =
  Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'google' : null;
const nativeSubscriptionManagementUrl =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : Platform.OS === 'android'
      ? 'https://play.google.com/store/account/subscriptions'
      : null;
const legalUrls = {
  terms: 'https://app.lyra-editor.com/terms.html',
  privacy: 'https://app.lyra-editor.com/privacy.html',
  support: 'https://app.lyra-editor.com/support.html'
} as const;

const formatPlanLabel = (planCode: string, language: 'ja' | 'en'): string => {
  const labels: Record<string, ScreenTranslationKey> = {
    free: 'screen.account.plan.free',
    standard: 'screen.account.plan.standard',
    premium: 'screen.account.plan.premium',
    enterprise_a: 'screen.account.plan.enterpriseA',
    enterprise_b: 'screen.account.plan.enterpriseB',
    enterprise_c: 'screen.account.plan.enterpriseC'
  };
  const label = labels[planCode];
  return label === undefined ? planCode : t(language, label);
};

export function AccountScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    api,
    language,
    logout,
    session,
    sessionKey,
    selection,
    setLanguage,
    setSession,
    tokens,
    updateSelection
  } = useAppState();
  const [webBillingError, setWebBillingError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [organizationManagementId, setOrganizationManagementId] = useState<string | null>(null);
  const organizationManagementTriggerRef = useRef<View | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [acknowledgePersonalSubscriptions, setAcknowledgePersonalSubscriptions] = useState(false);
  const [acknowledgeStoreBilling, setAcknowledgeStoreBilling] = useState(false);
  const [acknowledgeAssets, setAcknowledgeAssets] = useState(false);
  const [deletionResult, setDeletionResult] = useState<AccountDeletionResultRecord | null>(null);
  const organizationFeaturesEnabled = config.organizationFeaturesEnabled;
  // Feature-off builds must behave as a personal-only client while a stale
  // persisted organization selection is being cleared asynchronously.
  const organizationId = organizationFeaturesEnabled ? selection.organizationId : null;
  const activeOrganization = organizationFeaturesEnabled
    ? session?.organizations.find((organization) => organization.id === organizationId) ?? null
    : null;
  const mobileStoreProductCatalogQuery = useQuery({
    enabled:
      config.mobileStoreBillingEnabled &&
      session !== null &&
      organizationId === null &&
      nativeMobileStore !== null,
    queryKey: ['mobile-store-product-catalog', sessionKey, nativeMobileStore],
    queryFn: () => {
      if (nativeMobileStore === null) {
        throw new Error('Mobile store is unavailable');
      }
      return api.getMobileStoreProductCatalog(nativeMobileStore);
    }
  });
  const mobileStoreProducts = useMemo(
    () =>
      !config.mobileStoreBillingEnabled || mobileStoreProductCatalogQuery.data === undefined
        ? null
        : toNativeStoreProductDefinitions(mobileStoreProductCatalogQuery.data, language),
    [language, mobileStoreProductCatalogQuery.data]
  );
  const mobileStoreBillingAdapter = useMemo(
    () => {
      if (mobileStoreProducts === null || mobileStoreProducts.length === 0) {
        return null;
      }
      return createNativeStoreBillingAdapter({
        backend: createMobileStoreBillingBackend(api),
        products: mobileStoreProducts,
        sdk: createExpoIapSdk()
      });
    },
    [api, mobileStoreProducts]
  );

  const balanceQuery = useQuery({
    enabled: organizationId === null,
    queryKey: balanceQueryKey(sessionKey, organizationId),
    queryFn: () => api.getBalance()
  });
  const jobsQuery = useInfiniteQuery({
    enabled: session !== null,
    queryKey: jobsQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.listJobs({
      organizationId,
      limit: 25,
      cursor: pageParam
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.jobs.some((job) => job.status === 'queued' || job.status === 'processing')
      )
        ? 5000
        : false
  });
  const deletionPreviewQuery = useQuery({
    enabled: false,
    queryKey: ['account', 'deletion-preview', sessionKey],
    queryFn: () => api.getAccountDeletionPreview()
  });
  const deletionMutation = useMutation({
    mutationFn: () =>
      api.requestAccountDeletion({
        confirmation: 'DELETE',
        acknowledge_personal_subscriptions: acknowledgePersonalSubscriptions,
        acknowledge_store_billing: acknowledgeStoreBilling,
        acknowledge_personal_assets: acknowledgeAssets
      }),
    onSuccess: async (result) => {
      setDeletionResult(result);
      if (result.status === 'completed') {
        await logout({ skipDirtyCheck: true });
      }
    }
  });
  const createOrganizationMutation = useMutation({
    mutationFn: () => api.createOrganization({ name: organizationName.trim() }),
    onSuccess: async (workspace) => {
      const refreshedSession = await api.getCurrentSession();
      const createdOrganization = refreshedSession.organizations.find(
        (organization) => organization.id === workspace.organization.id && organization.membership_status === 'active'
      );
      if (createdOrganization === undefined) {
        throw new Error('Created organization was not available in the refreshed session.');
      }
      setSession(refreshedSession);
      queryClient.setQueryData(sessionQueryKey(sessionKey), refreshedSession);
      await updateSelection({
        organizationId: createdOrganization.id,
        workId: null,
        chapterId: null,
        episodeId: null,
        pageId: null,
        entityId: null
      });
      setOrganizationName('');
    }
  });
  const refetchJobs = jobsQuery.refetch;

  const refreshJobs = useCallback(async (): Promise<void> => {
    await refetchJobs();
  }, [refetchJobs]);

  useFocusEffect(
    useCallback(() => {
      void refreshJobs();
    }, [refreshJobs])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshJobs();
      }
    });
    return () => subscription.remove();
  }, [refreshJobs]);

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: balanceQueryKey(sessionKey, organizationId) }),
      queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionKey) }),
      queryClient.invalidateQueries({ queryKey: ['organization-workspace', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-members', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-invitations', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-billing', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-invoices', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-usage', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['organization-audit-logs', sessionKey] }),
      refreshJobs()
    ]);
  }, [organizationId, queryClient, refreshJobs, sessionKey]);

  const invalidateJobResources = useCallback(async (job: GenerationJobRecord): Promise<void> => {
    if (job.job_type === 'entity_generate') {
      await queryClient.invalidateQueries({ queryKey: ['entities', sessionKey] });
      return;
    }
    if (job.job_type === 'page_generate') {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pages', sessionKey] }),
        queryClient.invalidateQueries({ queryKey: ['panels', sessionKey] }),
        queryClient.invalidateQueries({ queryKey: ['frames', sessionKey] })
      ]);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['episodes', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['pages', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['panels', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['frames', sessionKey] })
    ]);
  }, [queryClient, sessionKey]);

  const cancelJobMutation = useMutation({
    mutationFn: (job: GenerationJobRecord) => api.cancelJob(job.id, organizationId),
    onSuccess: async () => {
      await refreshJobs();
    }
  });
  const hideJobMutation = useMutation({
    mutationFn: (job: GenerationJobRecord) => api.hideJob(job.id, organizationId),
    onSuccess: async () => {
      await refreshJobs();
    }
  });
  const retryJobMutation = useMutation({
    mutationFn: (job: GenerationJobRecord) => retryGenerationJob(api, job, language, organizationId),
    onSuccess: async () => {
      await refreshJobs();
    }
  });
  const jobs = jobsQuery.data?.pages.flatMap((page) => page.jobs) ?? [];

  const loadDeletionPreview = async (): Promise<void> => {
    setDeletionResult(null);
    setDeletionConfirmation('');
    setAcknowledgePersonalSubscriptions(false);
    setAcknowledgeStoreBilling(false);
    setAcknowledgeAssets(false);
    await deletionPreviewQuery.refetch();
  };

  const confirmAccountDeletion = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.AccountScreen.delete.this.account.d8a75685"),
      message: t(language, "generated.screens.AccountScreen.this.cannot.be.undone.start.deletion.for.2271db4d"),
      confirmLabel: t(language, "generated.screens.AccountScreen.start.deletion.43ad32e4"),
      destructive: true,
      onConfirm: () => void deletionMutation.mutateAsync()
    });
  };

  const planCode =
    activeOrganization?.plan_key ??
    balanceQuery.data?.plan_code ??
    session?.user.plan_code ??
    '-';
  const totalCredits =
    activeOrganization?.total_credits ??
    balanceQuery.data?.total_credits ??
    session?.personal_credits?.total_credits ??
    0;
  const monthlyCredits =
    activeOrganization?.monthly_credits ??
    balanceQuery.data?.monthly_credits ??
    session?.personal_credits?.monthly_credits ??
    0;
  const purchasedCredits =
    activeOrganization?.purchased_credits ??
    balanceQuery.data?.purchased_credits ??
    session?.personal_credits?.purchased_credits ??
    0;
  const openExternalHttpsUrl = async (url: string): Promise<boolean> => {
    setWebBillingError(null);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new Error('External URL must use HTTPS.');
      }
      const supported = await Linking.canOpenURL(parsed.toString());
      if (!supported) {
        throw new Error('External URL is not supported.');
      }
      await Linking.openURL(parsed.toString());
      return true;
    } catch {
      setWebBillingError(t(language, "generated.screens.AccountScreen.could.not.open.the.external.management.p.cf6b7798"));
      return false;
    }
  };
  const openOrganizationManagement = async (targetOrganizationId: string): Promise<void> => {
    const selectionChanged = await updateSelection({
      organizationId: targetOrganizationId,
      workId: null,
      chapterId: null,
      episodeId: null,
      pageId: null,
      entityId: null
    });
    if (selectionChanged) {
      setOrganizationManagementId(targetOrganizationId);
    }
  };
  const confirmOrganizationMemberRemoval = (
    member: OrganizationMemberRecord,
    removeMember: () => Promise<void>
  ): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.AccountScreen.remove.member.a9c62cac"),
      message: t(language, 'screen.account.removeOrganizationMember', {
        memberName: member.display_name ?? member.email
      }),
      confirmLabel: t(language, "generated.screens.AccountScreen.remove.1d5b5e95"),
      destructive: true,
      onConfirm: () => void removeMember()
    });
  };
  const confirmLogout = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.AccountScreen.log.out.fba46481"),
      message: t(language, "generated.screens.AccountScreen.sign.in.information.will.be.removed.from.3083a7b5"),
      confirmLabel: t(language, 'logout'),
      destructive: true,
      onConfirm: () => void logout()
    });
  };

  useEffect(() => {
    if (!organizationFeaturesEnabled && selection.organizationId !== null) {
      void updateSelection({
        organizationId: null,
        workId: null,
        chapterId: null,
        episodeId: null,
        pageId: null,
        entityId: null
      }, { skipDirtyCheck: true });
    }
  }, [organizationFeaturesEnabled, selection.organizationId, updateSelection]);

  return (
    <Screen
      onRefresh={() => void refresh()}
      refreshing={balanceQuery.isFetching || deletionPreviewQuery.isFetching || jobsQuery.isFetching}
      subtitle={t(language, "generated.screens.AccountScreen.review.login.credits.and.language.994784d4")}
      title={t(language, 'account')}
    >
      <Section collapsible persistKey="account:profile" title={t(language, 'profile')}>
        <Text style={styles.metric}>{session?.user.email ?? '-'}</Text>
        <Text style={styles.caption}>{session?.user.display_name ?? session?.user.id ?? '-'}</Text>
      </Section>

      {organizationFeaturesEnabled ? (
        <Section
          collapsible
          persistKey="account:workspace"
          subtitle={t(language, "generated.screens.AccountScreen.switch.the.personal.or.organization.work.dcfa7cf6")}
          title={t(language, "generated.screens.AccountScreen.workspace.ad291af6")}
        >
          <RecordPicker
            emptyLabel={t(language, "generated.screens.AccountScreen.no.organization.workspaces.660f207d")}
            items={[
              { id: 'personal', name: t(language, "generated.screens.AccountScreen.personal.6d0aa3f4") },
              ...(session?.organizations ?? []).map((organization) => ({ id: organization.id, name: organization.name }))
            ]}
            language={language}
            labelForItem={(item) => item.name}
            onSelect={(id) => {
              setOrganizationManagementId(null);
              void updateSelection({
                organizationId: id === 'personal' ? null : id,
                workId: null,
                chapterId: null,
                episodeId: null,
                pageId: null,
                entityId: null
              });
            }}
            selectedId={selection.organizationId ?? 'personal'}
          />
          <Section
            collapsible
            defaultCollapsed
            persistKey="account:create-organization"
            subtitle={t(language, "generated.screens.AccountScreen.create.a.new.organization.workspace.plan.5be5f483")}
            title={t(language, "generated.screens.AccountScreen.create.organization.2c93e462")}
          >
            <FormField
              autoCorrect={false}
              label={t(language, "generated.screens.AccountScreen.organization.name.74237aeb")}
              maxLength={120}
              onChangeText={setOrganizationName}
              placeholder={t(language, "generated.screens.AccountScreen.example.lyra.studio.a5093748")}
              value={organizationName}
            />
            {createOrganizationMutation.isError ? (
              <Notice message={userErrorMessage(createOrganizationMutation.error, language)} tone="danger" />
            ) : null}
            <PrimaryButton
              disabled={organizationName.trim().length === 0 || createOrganizationMutation.isPending}
              disabledReason={
                organizationName.trim().length === 0
                  ? t(language, "generated.screens.AccountScreen.enter.an.organization.name.7b03658b")
                  : undefined
              }
              label={t(language, "generated.screens.AccountScreen.create.organization.2c93e462")}
              loading={createOrganizationMutation.isPending}
              onPress={() => void createOrganizationMutation.mutateAsync()}
            />
          </Section>
        </Section>
      ) : (
        <Notice
          message={t(language, "generated.screens.AccountScreen.organization.features.are.coming.soon.86e59d19")}
          tone="info"
        />
      )}

      {activeOrganization === null ? null : (
        <Section
          collapsible
          persistKey="account:organization-management"
          subtitle={t(language, "generated.screens.AccountScreen.manage.members.billing.usage.and.audit.l.e0b17c78")}
          title={t(language, "generated.screens.AccountScreen.organization.management.23edc1a9")}
        >
          <Text style={styles.metric}>{activeOrganization.name}</Text>
          <Text style={styles.caption}>
            {t(language, "generated.screens.AccountScreen.role.d6521bc4")}: {activeOrganization.role}
          </Text>
          <View collapsable={false} ref={organizationManagementTriggerRef}>
            <PrimaryButton
              label={t(language, "generated.screens.AccountScreen.open.organization.management.ea1b51b0")}
              onPress={() => setOrganizationManagementId(activeOrganization.id)}
              variant="secondary"
            />
          </View>
        </Section>
      )}
      <OrganizationManagementModal
        language={language}
        onClose={() => setOrganizationManagementId(null)}
        restoreFocusRef={organizationManagementTriggerRef}
        visible={activeOrganization !== null && organizationManagementId === activeOrganization.id}
      >
        {activeOrganization === null ? null : (
          <OrganizationManagementPanel
            allowExternalBillingActions={false}
            api={api}
            key={activeOrganization.id}
            language={language}
            onBillingHandoffComplete={refresh}
            onConfirmRemoveMember={confirmOrganizationMemberRemoval}
            onDownloadUsageCsv={async () => {
              await downloadAuthenticatedFile({
                path: `/api/organizations/${encodeURIComponent(activeOrganization.id)}/usage.csv`,
                filename: `lyra-${activeOrganization.name}-usage`,
                mimeType: 'text/csv',
                tokens
              });
            }}
            onOpenBillingUrl={openExternalHttpsUrl}
            organization={activeOrganization}
            sessionKey={sessionKey}
          />
        )}
      </OrganizationManagementModal>
      {webBillingError === null ? null : <Notice message={webBillingError} tone="danger" />}

      {activeOrganization === null ? (
        <Section
        collapsible
        defaultCollapsed={totalCredits > 0}
        persistKey="account:billing"
        subtitle={t(language, "generated.screens.AccountScreen.personal.purchases.and.restores.use.your.9bf34678")}
        title={t(language, 'billing')}
        tone="highlight"
      >
        <Notice
          message={t(language, "generated.screens.AccountScreen.this.is.your.personal.workspace.balance.28f10173")}
        />
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, 'plan')}</Text>
            <Text style={styles.metric}>{formatPlanLabel(planCode, language)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.total.de495bcb")}</Text>
            <Text style={styles.metric}>{totalCredits}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.monthly.2b188e52")}</Text>
            <Text style={styles.metric}>{monthlyCredits}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.purchased.fddd0d3f")}</Text>
            <Text style={styles.metric}>{purchasedCredits}</Text>
          </View>
        </View>
        <View style={styles.usage}>
          <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.character.preview.import.1.credit.c94447dd")}</Text>
          <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.page.generation.3.credits.c308dc72")}</Text>
          <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.text.ai.actions.0.credits.d7c4fd44")}</Text>
        </View>
        <PersonalBillingSummary
          cancelAtPeriodEnd={balanceQuery.data?.cancel_at_period_end ?? false}
          currentPeriodEnd={balanceQuery.data?.current_period_end ?? null}
          language={language}
          onManage={() => {
            if (nativeSubscriptionManagementUrl !== null) {
              void openExternalHttpsUrl(nativeSubscriptionManagementUrl);
            }
          }}
        />
        {!config.mobileStoreBillingEnabled ? null : nativeMobileStore === null ? (
          <Notice
            message={t(language, "generated.screens.AccountScreen.in.app.purchases.are.unavailable.on.this.78ae2675")}
            tone="warning"
          />
        ) : mobileStoreProductCatalogQuery.isLoading ? (
          <Notice
            message={t(language, "generated.screens.AccountScreen.loading.store.products.6107cc8e")}
          />
        ) : mobileStoreProductCatalogQuery.isError ? (
          <View style={styles.usage}>
            <Notice
              message={t(language, "generated.screens.AccountScreen.purchases.are.disabled.because.store.pro.ebe5c1eb")}
              tone="danger"
            />
            <PrimaryButton
              disabled
              disabledReason={t(language, "generated.screens.AccountScreen.reload.the.product.catalog.f0ea8b2a")}
              label={t(language, "generated.screens.AccountScreen.purchase.8ff82e16")}
              onPress={() => undefined}
            />
            <PrimaryButton
              label={t(language, "generated.screens.AccountScreen.reload.products.3b04ccb7")}
              loading={mobileStoreProductCatalogQuery.isFetching}
              onPress={() => void mobileStoreProductCatalogQuery.refetch()}
              variant="secondary"
            />
          </View>
        ) : mobileStoreBillingAdapter === null ? (
          <View style={styles.usage}>
            <Notice
              message={t(language, "generated.screens.AccountScreen.no.store.products.are.currently.availabl.815ba2a1")}
              tone="warning"
            />
            <PrimaryButton
              disabled
              disabledReason={t(language, "generated.screens.AccountScreen.no.products.are.available.d22f3b8f")}
              label={t(language, "generated.screens.AccountScreen.purchase.8ff82e16")}
              onPress={() => undefined}
            />
          </View>
        ) : (
          <MobileStoreBillingPanel
            adapter={mobileStoreBillingAdapter}
            language={language}
            onVerified={refresh}
          />
        )}
        </Section>
      ) : null}

      <Section
        collapsible
        persistKey="account:jobs"
        subtitle={t(language, "generated.screens.AccountScreen.review.generation.jobs.in.this.workspace.69eab3a5")}
        title={t(language, "generated.screens.AccountScreen.jobs.3e4ac854")}
      >
        {jobs.length === 0 && jobsQuery.isSuccess ? (
          <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.no.jobs.to.show.c491ecfe")}</Text>
        ) : (
          jobs.map((job) => (
            <JobStatusCard
              api={api}
              cancelLoading={cancelJobMutation.isPending && cancelJobMutation.variables?.id === job.id}
              hideLoading={hideJobMutation.isPending && hideJobMutation.variables?.id === job.id}
              job={job}
              jobId={job.id}
              key={job.id}
              language={language}
              onCancel={(target) => void cancelJobMutation.mutateAsync(target)}
              onCompleted={() => void invalidateJobResources(job)}
              onHide={(target) => void hideJobMutation.mutateAsync(target)}
              onRetry={
                job.retryable && job.job_type !== 'page_generate'
                  ? (target) => void retryJobMutation.mutateAsync(target)
                  : undefined
              }
              organizationId={organizationId}
              retryLoading={retryJobMutation.isPending && retryJobMutation.variables?.id === job.id}
              sessionKey={sessionKey}
            />
          ))
        )}
        {cancelJobMutation.isError ? <Notice message={userErrorMessage(cancelJobMutation.error, language)} tone="danger" /> : null}
        {hideJobMutation.isError ? <Notice message={userErrorMessage(hideJobMutation.error, language)} tone="danger" /> : null}
        {retryJobMutation.isError ? <Notice message={userErrorMessage(retryJobMutation.error, language)} tone="danger" /> : null}
        {jobsQuery.hasNextPage ? (
          <PrimaryButton
            label={t(language, "generated.screens.AccountScreen.load.more.72433fbc")}
            loading={jobsQuery.isFetchingNextPage}
            onPress={() => void jobsQuery.fetchNextPage()}
            variant="ghost"
          />
        ) : null}
      </Section>

      <Section collapsible defaultCollapsed persistKey="account:language" title={t(language, 'language')}>
        <SegmentedControl
          onChange={(value) => void setLanguage(value)}
          options={[
            { value: 'ja', label: '日本語' },
            { value: 'en', label: 'English' }
          ]}
          value={language}
        />
      </Section>

      <Section
        collapsible
        defaultCollapsed
        persistKey="account:legal-support"
        title={t(language, 'screen.account.legalSupport')}
      >
        <PrimaryButton
          label={t(language, 'screen.terms.termsLink')}
          onPress={() => void openExternalHttpsUrl(legalUrls.terms)}
          variant="ghost"
        />
        <PrimaryButton
          label={t(language, 'screen.terms.privacyLink')}
          onPress={() => void openExternalHttpsUrl(legalUrls.privacy)}
          variant="ghost"
        />
        <PrimaryButton
          label={t(language, 'screen.terms.supportLink')}
          onPress={() => void openExternalHttpsUrl(legalUrls.support)}
          variant="ghost"
        />
      </Section>

      {config.accountDeletionEnabled ? (
        <Section
          collapsible
          defaultCollapsed
          persistKey="account:deletion"
          subtitle={t(language, "generated.screens.AccountScreen.this.applies.only.to.your.personal.accou.0658a476")}
          title={t(language, "generated.screens.AccountScreen.delete.account.88a30568")}
          tone="subtle"
        >
        {deletionPreviewQuery.data === undefined ? (
          <>
            <Notice
              message={t(language, "generated.screens.AccountScreen.before.deletion.review.the.effects.on.pe.db62f283")}
              tone="warning"
            />
            {deletionPreviewQuery.isError ? (
              <Notice message={accountDeletionErrorMessage(language)} tone="danger" />
            ) : null}
            <PrimaryButton
              label={t(language, "generated.screens.AccountScreen.review.deletion.effects.7ee50652")}
              loading={deletionPreviewQuery.isFetching}
              onPress={() => void loadDeletionPreview()}
              variant="danger"
            />
          </>
        ) : (
          <AccountDeletionReview
            acknowledgeAssets={acknowledgeAssets}
            acknowledgePersonalSubscriptions={acknowledgePersonalSubscriptions}
            acknowledgeStoreBilling={acknowledgeStoreBilling}
            confirmation={deletionConfirmation}
            deletionError={deletionMutation.isError ? accountDeletionErrorMessage(language) : null}
            deletionResult={deletionResult}
            language={language}
            onAcknowledgeAssets={setAcknowledgeAssets}
            onAcknowledgePersonalSubscriptions={setAcknowledgePersonalSubscriptions}
            onAcknowledgeStoreBilling={setAcknowledgeStoreBilling}
            onConfirmDeletion={confirmAccountDeletion}
            onConfirmationChange={setDeletionConfirmation}
            onOpenOrganizationManagement={() => {
              const target = deletionPreviewQuery.data?.unique_owner_organizations[0];
              if (target !== undefined) {
                void openOrganizationManagement(target.id);
              }
            }}
            onRefreshPreview={() => void loadDeletionPreview()}
            preview={deletionPreviewQuery.data}
            submitting={deletionMutation.isPending}
          />
        )}
        </Section>
      ) : null}

      <PrimaryButton label={t(language, 'logout')} onPress={confirmLogout} variant="danger" />
    </Screen>
  );
}

async function retryGenerationJob(
  api: LyraMobileApiClient,
  job: GenerationJobRecord,
  language: 'ja' | 'en',
  organizationId: string | null
): Promise<void> {
  if (!job.retryable) {
    throw new Error(t(language, "generated.screens.AccountScreen.this.generation.cannot.be.retried.03934862"));
  }

  if (job.job_type === 'page_generate') {
    throw new Error(
      t(language, "generated.screens.AccountScreen.retry.page.generation.from.pages.after.r.4fa2c863")
    );
  }

  if (job.job_type === 'entity_generate') {
    const entityId = readJobStringParam(job, 'entity_id');
    if (entityId === null) {
      throw new Error(t(language, "generated.screens.AccountScreen.the.character.information.needed.to.retr.42e62589"));
    }
    await api.generateEntityReference(entityId, {}, organizationId);
    return;
  }

  const episodeId = readJobStringParam(job, 'episode_id');
  if (episodeId === null) {
    throw new Error(t(language, "generated.screens.AccountScreen.the.episode.information.needed.to.retry.f6c3627c"));
  }
  const jobLanguage = readJobLanguageParam(job) ?? language;
  if (job.job_type === 'episode_story_autofill') {
    await api.autofillEpisodePagesFromStory(episodeId, jobLanguage, organizationId);
    return;
  }
  await api.generatePageSkeleton(
    episodeId,
    {
      overwrite_existing: readJobBooleanParam(job, 'overwrite_existing') ?? false,
      apply_story_plan: readJobBooleanParam(job, 'apply_story_plan') ?? true,
      language: jobLanguage
    },
    organizationId
  );
}

function readJobStringParam(job: GenerationJobRecord, key: string): string | null {
  const value = job.params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readJobBooleanParam(job: GenerationJobRecord, key: string): boolean | null {
  const value = job.params[key];
  return typeof value === 'boolean' ? value : null;
}

function readJobLanguageParam(job: GenerationJobRecord): 'ja' | 'en' | null {
  const value = job.params.language;
  return value === 'ja' || value === 'en' ? value : null;
}

interface AccountDeletionReviewProps {
  acknowledgeAssets: boolean;
  acknowledgePersonalSubscriptions: boolean;
  acknowledgeStoreBilling: boolean;
  confirmation: string;
  deletionError: string | null;
  deletionResult: AccountDeletionResultRecord | null;
  language: 'ja' | 'en';
  onAcknowledgeAssets: (value: boolean) => void;
  onAcknowledgePersonalSubscriptions: (value: boolean) => void;
  onAcknowledgeStoreBilling: (value: boolean) => void;
  onConfirmDeletion: () => void;
  onConfirmationChange: (value: string) => void;
  onOpenOrganizationManagement: () => void;
  onRefreshPreview: () => void;
  preview: AccountDeletionPreviewRecord;
  submitting: boolean;
}

function AccountDeletionReview({
  acknowledgeAssets,
  acknowledgePersonalSubscriptions,
  acknowledgeStoreBilling,
  confirmation,
  deletionError,
  deletionResult,
  language,
  onAcknowledgeAssets,
  onAcknowledgePersonalSubscriptions,
  onAcknowledgeStoreBilling,
  onConfirmDeletion,
  onConfirmationChange,
  onOpenOrganizationManagement,
  onRefreshPreview,
  preview,
  submitting
}: AccountDeletionReviewProps): React.JSX.Element {
  const ownerOrganizationNames = preview.unique_owner_organizations.map((organization) => organization.name);
  const hasOwnerBlocker = ownerOrganizationNames.length > 0;
  const hasActiveJobBlocker = preview.active_personal_job_count > 0;
  const requiresPersonalSubscriptionAcknowledgement =
    preview.active_personal_stripe_subscription_count > 0;
  const requiresStoreBillingAcknowledgement = preview.active_store_subscriptions.length > 0;
  const requiresAssetAcknowledgement = preview.personal_asset_count > 0;
  const canSubmit =
    !hasOwnerBlocker &&
    !hasActiveJobBlocker &&
    confirmation === 'DELETE' &&
    (!requiresPersonalSubscriptionAcknowledgement || acknowledgePersonalSubscriptions) &&
    (!requiresStoreBillingAcknowledgement || acknowledgeStoreBilling) &&
    (!requiresAssetAcknowledgement || acknowledgeAssets) &&
    deletionResult === null;
  const disabledReason = hasOwnerBlocker
    ? t(language, "generated.screens.AccountScreen.resolve.the.sole.owner.organizations.fir.8d5836e3")
    : hasActiveJobBlocker
      ? t(language, 'screen.account.activePersonalJobDeletionBlocker', {
          jobCount: preview.active_personal_job_count
        })
    : confirmation !== 'DELETE'
      ? t(language, "generated.screens.AccountScreen.type.delete.to.continue.ee121f3e")
      : requiresPersonalSubscriptionAcknowledgement && !acknowledgePersonalSubscriptions
        ? t(language, "generated.screens.AccountScreen.acknowledge.the.subscription.first.b3d9df42")
        : requiresStoreBillingAcknowledgement && !acknowledgeStoreBilling
          ? t(language, "generated.screens.AccountScreen.acknowledge.the.subscription.first.b3d9df42")
        : requiresAssetAcknowledgement && !acknowledgeAssets
          ? t(language, "generated.screens.AccountScreen.acknowledge.the.confirmed.assets.first.2381876d")
          : undefined;

  return (
    <View style={styles.deletionReview}>
      <Text style={styles.deletionHeading}>{t(language, "generated.screens.AccountScreen.deletion.effects.0dd91445")}</Text>
      <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.account.information.will.be.anonymized.ca2e88f8")}</Text>
      <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.personal.works.will.be.deleted.8426ee02")}</Text>
      <Text style={styles.caption}>{t(language, "generated.screens.AccountScreen.organization.memberships.will.be.removed.4cfe8059")}</Text>

      {hasOwnerBlocker ? (
        <>
          <Notice
            message={t(language, 'screen.account.soleOrganizationOwner', {
              organizationNames: ownerOrganizationNames.join(language === 'ja' ? '、' : ', ')
            })}
            tone="danger"
          />
          <PrimaryButton
            label={t(language, "generated.screens.AccountScreen.open.organization.management.55d03f28")}
            onPress={onOpenOrganizationManagement}
            variant="secondary"
          />
        </>
      ) : null}

      {hasActiveJobBlocker ? (
        <Notice
          message={t(language, 'screen.account.activePersonalJobDeletionBlocker', {
            jobCount: preview.active_personal_job_count
          })}
          tone="danger"
        />
      ) : null}

      {requiresPersonalSubscriptionAcknowledgement ? (
        <AcknowledgementRow
          checked={acknowledgePersonalSubscriptions}
          label={personalSubscriptionDeletionAcknowledgement({
            subscriptionCount: preview.active_personal_stripe_subscription_count,
            language
          })}
          onChange={onAcknowledgePersonalSubscriptions}
        />
      ) : null}
      {requiresStoreBillingAcknowledgement ? (
        <AcknowledgementRow
          checked={acknowledgeStoreBilling}
          label={storeBillingDeletionAcknowledgement({
            subscriptionCount: preview.active_store_subscriptions.length,
            language
          })}
          onChange={onAcknowledgeStoreBilling}
        />
      ) : null}
      {requiresAssetAcknowledgement ? (
        <AcknowledgementRow
          checked={acknowledgeAssets}
          label={personalAssetDeletionAcknowledgement({
            assetCount: preview.personal_asset_count,
            language
          })}
          onChange={onAcknowledgeAssets}
        />
      ) : null}

      <FormField
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect={false}
        help={t(language, "generated.screens.AccountScreen.type.delete.in.uppercase.to.confirm.28eb52e6")}
        label={t(language, "generated.screens.AccountScreen.confirm.deletion.a85ec902")}
        onChangeText={onConfirmationChange}
        value={confirmation}
      />
      {deletionError === null ? null : <Notice message={deletionError} tone="danger" />}
      {deletionResult === null ? null : (
        <>
          <Notice
            message={deletionResultMessage(deletionResult, language)}
            tone={deletionResult.status === 'completed' ? 'success' : 'warning'}
          />
          <PrimaryButton
            label={t(language, "generated.screens.AccountScreen.recheck.deletion.status.0f71c87f")}
            onPress={onRefreshPreview}
            variant="ghost"
          />
        </>
      )}
      <PrimaryButton
        disabled={!canSubmit}
        disabledReason={disabledReason}
        label={t(language, "generated.screens.AccountScreen.start.account.deletion.8d71a474")}
        loading={submitting}
        onPress={onConfirmDeletion}
        variant="danger"
      />
    </View>
  );
}

function AcknowledgementRow({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.acknowledgementRow}>
      <Switch accessibilityLabel={label} onValueChange={onChange} value={checked} />
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function accountDeletionErrorMessage(language: 'ja' | 'en'): string {
  return t(language, "generated.screens.AccountScreen.could.not.start.deletion.check.your.conn.2e8d0a38");
}

const styles = StyleSheet.create({
  acknowledgementRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm
  },
  caption: {
    ...textStyles.caption
  },
  deletionHeading: {
    ...textStyles.body,
    fontWeight: '700'
  },
  deletionReview: {
    gap: spacing.sm
  },
  metric: {
    ...textStyles.body,
    flexShrink: 1,
    fontWeight: '700'
  },
  metricCard: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 132,
    padding: spacing.sm
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  usage: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 4,
    paddingTop: spacing.sm
  }
});
