import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { BillingHandoffNotice } from '@/components/BillingHandoffNotice';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { OrganizationCollectionModal } from '@/components/OrganizationCollectionModal';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Section } from '@/components/Section';
import { SegmentedControl } from '@/components/SegmentedControl';
import { colors, spacing, textStyles } from '@/constants/theme';
import {
  createBillingAuthoritativeSnapshot,
  pollBillingConfirmation,
  type BillingAuthoritativeSnapshot,
  type BillingHandoffIntent,
  type BillingHandoffPhase
} from '@/domain/billingHandoffPolicy';
import { hasWorkspaceCapability } from '@/domain/capabilities';
import type {
  CurrentUserOrganizationRecord,
  OrganizationAuditLogRecord,
  OrganizationCheckoutRecord,
  OrganizationInvitationRecord,
  OrganizationMemberRecord,
  OrganizationRole,
  OrganizationUsageEventRecord,
  UiLanguage
} from '@/domain/types';
import {
  ApiError,
  type LyraMobileApiClient,
  type OrganizationSafetyReportTargetKind
} from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';
import { recordOperationalMetric } from '@/lib/operationalEvents';
import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';
import {
  organizationAuditLogsInfiniteQueryKey,
  organizationBillingQueryKey,
  organizationInvoicesQueryKey,
  organizationInvitationsInfiniteQueryKey,
  organizationMembersInfiniteQueryKey,
  organizationUsageInfiniteQueryKey,
  organizationWorkspaceQueryKey
} from '@/lib/queryKeys';
import { userErrorMessage } from '@/lib/userMessages';

interface OrganizationManagementPanelProps {
  /** Native store clients disable external checkout and portal actions. */
  allowExternalBillingActions?: boolean;
  /** The currently selected organization, resolved from the authenticated session. */
  organization: CurrentUserOrganizationRecord;
  api: LyraMobileApiClient;
  sessionKey: string;
  language: UiLanguage;
  /** The caller owns the native browser / WebView implementation. */
  onOpenBillingUrl: (url: string) => boolean | void | Promise<boolean | void>;
  /**
   * Called after an external billing handoff closes. This is a refresh signal,
   * never evidence that a payment succeeded.
   */
  onBillingHandoffComplete?: () => void | Promise<void>;
  /** The caller owns the authenticated native download and share operation. */
  onDownloadUsageCsv: () => Promise<void>;
  /** The caller must present a destructive confirmation before removal. */
  onConfirmRemoveMember: (
    member: OrganizationMemberRecord,
    removeMember: () => Promise<void>
  ) => void;
}

export function OrganizationManagementPanel({
  allowExternalBillingActions = true,
  organization,
  api,
  sessionKey,
  language,
  onOpenBillingUrl,
  onBillingHandoffComplete,
  onDownloadUsageCsv,
  onConfirmRemoveMember
}: OrganizationManagementPanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const organizationId = organization.id;
  const activeMembership = organization.membership_status === 'active';
  const role = organization.role;
  const canManageOrganization = activeMembership && hasWorkspaceCapability(organizationId, role, 'manage_organization');
  const canManageMembers = activeMembership && hasWorkspaceCapability(organizationId, role, 'manage_members');
  const canViewBilling = activeMembership && hasWorkspaceCapability(organizationId, role, 'view_billing');
  const canManageBilling = activeMembership && hasWorkspaceCapability(organizationId, role, 'manage_billing');
  const canViewUsage = activeMembership && hasWorkspaceCapability(organizationId, role, 'view_usage');
  const canViewAudit = activeMembership && (
    hasWorkspaceCapability(organizationId, role, 'view_audit_logs') || canViewBilling
  );
  const [workspaceName, setWorkspaceName] = useState(organization.name);
  const [legalName, setLegalName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrganizationRole>('editor');
  const [usageCsvError, setUsageCsvError] = useState<unknown | null>(null);
  const [usageCsvLoading, setUsageCsvLoading] = useState(false);
  const [safetyReportStatus, setSafetyReportStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [safetyReportTarget, setSafetyReportTarget] = useState<OrganizationSafetyReportTargetKind | null>(null);
  const [activeCollection, setActiveCollection] = useState<
    'members' | 'invitations' | 'usage' | 'audit' | null
  >(null);
  const membersCollectionTriggerRef = useRef<View | null>(null);
  const invitationsCollectionTriggerRef = useRef<View | null>(null);
  const usageCollectionTriggerRef = useRef<View | null>(null);
  const auditCollectionTriggerRef = useRef<View | null>(null);
  const [billingHandoff, setBillingHandoff] = useState<{
    before: BillingAuthoritativeSnapshot;
    intent: BillingHandoffIntent;
    phase: Exclude<BillingHandoffPhase, 'idle'>;
  } | null>(null);
  const billingHandoffRef = useRef<typeof billingHandoff>(null);
  const billingConfirmationRunRef = useRef(0);
  const settingsVersionRef = useRef<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: organizationWorkspaceQueryKey(sessionKey, organizationId),
    queryFn: () => api.getOrganizationWorkspace(organizationId)
  });
  const membersQuery = useInfiniteQuery({
    enabled: canManageMembers,
    queryKey: organizationMembersInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getOrganizationMembersPage(organizationId, {
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const invitationsQuery = useInfiniteQuery({
    enabled: canManageMembers,
    queryKey: organizationInvitationsInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getOrganizationInvitationsPage(organizationId, {
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const billingQuery = useQuery({
    enabled: canViewBilling,
    queryKey: organizationBillingQueryKey(sessionKey, organizationId),
    queryFn: () => api.getOrganizationBillingSummary(organizationId)
  });
  const invoicesQuery = useQuery({
    enabled: canViewBilling,
    queryKey: organizationInvoicesQueryKey(sessionKey, organizationId),
    queryFn: () => api.getOrganizationInvoices(organizationId)
  });
  const usageQuery = useInfiniteQuery({
    enabled: canViewUsage,
    queryKey: organizationUsageInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getOrganizationUsagePage(organizationId, {
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const auditQuery = useInfiniteQuery({
    enabled: canViewAudit,
    queryKey: organizationAuditLogsInfiniteQueryKey(sessionKey, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getOrganizationAuditLogsPage(organizationId, {
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });

  const invalidate = async (names: readonly string[]): Promise<void> => {
    await Promise.all(
      names.map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, sessionKey, organizationId] })
      )
    );
  };

  const updateWorkspaceMutation = useMutation({
    mutationFn: () => api.updateOrganization(organizationId, {
      name: workspaceName.trim(),
      legal_name: nullableText(legalName),
      billing_email: nullableText(billingEmail)
    }),
    onSuccess: async () => {
      await invalidate(['organization-workspace', 'organization-billing']);
    }
  });
  const inviteMutation = useMutation({
    mutationFn: () => api.createOrganizationInvitation(organizationId, {
      email: inviteEmail.trim(),
      role: inviteRole
    }),
    onSuccess: async () => {
      setInviteEmail('');
      await invalidate(['organization-invitations']);
    }
  });
  const resendInvitationMutation = useMutation({
    mutationFn: (invitation: OrganizationInvitationRecord) =>
      api.resendOrganizationInvitation(organizationId, invitation.id),
    onSuccess: async () => {
      await invalidate(['organization-invitations']);
    }
  });
  const revokeInvitationMutation = useMutation({
    mutationFn: (invitation: OrganizationInvitationRecord) =>
      api.revokeOrganizationInvitation(organizationId, invitation.id),
    onSuccess: async () => {
      await invalidate(['organization-invitations']);
    }
  });
  const updateMemberMutation = useMutation({
    mutationFn: ({ member, body }: { member: OrganizationMemberRecord; body: { role?: OrganizationRole; status?: 'active' | 'suspended' } }) =>
      api.updateOrganizationMember(organizationId, member.id, body),
    onSuccess: async () => {
      await invalidate(['organization-members', 'organization-workspace', 'organization-audit-logs']);
    }
  });
  const removeMemberMutation = useMutation({
    mutationFn: (member: OrganizationMemberRecord) => api.removeOrganizationMember(organizationId, member.id),
    onSuccess: async () => {
      await invalidate(['organization-members', 'organization-workspace', 'organization-audit-logs']);
    }
  });
  const subscriptionCheckoutMutation = useMutation({
    mutationFn: (planCode: 'enterprise_a' | 'enterprise_b' | 'enterprise_c') =>
      api.createOrganizationSubscriptionCheckout(organizationId, { plan_code: planCode })
  });
  const creditCheckoutMutation = useMutation({
    mutationFn: (packageCode: 'credits_200' | 'credits_1000' | 'credits_3000') =>
      api.createOrganizationCreditCheckout(organizationId, { package_code: packageCode })
  });
  const portalMutation = useMutation({
    mutationFn: () => api.createOrganizationCustomerPortal(organizationId)
  });

  const workspace = workspaceQuery.data;
  const members = useMemo(
    () => flattenUniqueRecords(membersQuery.data?.pages.map((page) => page.members) ?? []),
    [membersQuery.data?.pages],
  );
  const invitations = useMemo(
    () => flattenUniqueRecords(
      invitationsQuery.data?.pages.map((page) => page.invitations) ?? [],
    ),
    [invitationsQuery.data?.pages],
  );
  const usageEvents = useMemo(
    () => flattenUniqueRecords(
      usageQuery.data?.pages.map((page) => page.usage_events) ?? [],
    ),
    [usageQuery.data?.pages],
  );
  const usageSummary = usageQuery.data?.pages[0]?.summary;
  const auditLogs = useMemo(
    () => flattenUniqueRecords(
      auditQuery.data?.pages.map((page) => page.audit_logs) ?? [],
    ),
    [auditQuery.data?.pages],
  );
  const subscriptionPlans = billingQuery.data?.subscription_plans ?? [];
  const memberLabelByUserId = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.display_name ?? member.email])),
    [members]
  );
  const usageListItems = useMemo<OrganizationUsageListItem[]>(() => {
    const summaryItems: OrganizationUsageListItem[] = [
      ...(usageSummary?.by_member ?? []).map((item) => ({
        credits: item.credits,
        id: `summary:member:${item.key}`,
        kind: 'summary' as const,
        label: memberLabelByUserId.get(item.key) ?? t(language, "generated.components.OrganizationManagementPanel.unknown.member.f299ac36"),
        title: t(language, "generated.components.OrganizationManagementPanel.by.member.2a622efe")
      })),
      ...(usageSummary?.by_work ?? []).map((item) => ({
        credits: item.credits,
        id: `summary:work:${item.key}`,
        kind: 'summary' as const,
        label: item.key,
        title: t(language, "generated.components.OrganizationManagementPanel.by.work.882bfaeb")
      })),
      ...(usageSummary?.by_generation_type ?? []).map((item) => ({
        credits: item.credits,
        id: `summary:generation:${item.key}`,
        kind: 'summary' as const,
        label: item.key.replace(/[_-]+/g, ' '),
        title: t(language, "generated.components.OrganizationManagementPanel.by.generation.type.530d7b93")
      }))
    ];
    return [
      ...summaryItems,
      ...usageEvents.map((event) => ({
        event,
        id: `event:${event.id}`,
        kind: 'event' as const
      }))
    ];
  }, [language, memberLabelByUserId, usageEvents, usageSummary]);

  useEffect(() => {
    const current = workspace?.organization;
    if (current === undefined || settingsVersionRef.current === current.updated_at) {
      return;
    }
    settingsVersionRef.current = current.updated_at;
    setWorkspaceName(current.name);
    setLegalName(current.legal_name ?? '');
    setBillingEmail(current.billing_email ?? '');
  }, [workspace?.organization]);

  const updateBillingHandoff = useCallback((next: typeof billingHandoff): void => {
    billingHandoffRef.current = next;
    setBillingHandoff(next);
  }, []);

  const fetchAuthoritativeBillingSnapshot = useCallback(async (): Promise<BillingAuthoritativeSnapshot> => {
    const [billing, invoiceResponse] = await Promise.all([
      api.getOrganizationBillingSummary(organizationId),
      api.getOrganizationInvoices(organizationId)
    ]);
    queryClient.setQueryData(
      organizationBillingQueryKey(sessionKey, organizationId),
      billing
    );
    queryClient.setQueryData(
      organizationInvoicesQueryKey(sessionKey, organizationId),
      invoiceResponse
    );
    return createBillingAuthoritativeSnapshot(billing, invoiceResponse.invoices);
  }, [api, organizationId, queryClient, sessionKey]);

  const beginBillingConfirmation = useCallback(async (): Promise<void> => {
    const handoff = billingHandoffRef.current;
    if (handoff === null || handoff.phase !== 'waiting_for_return') {
      return;
    }
    const run = billingConfirmationRunRef.current + 1;
    billingConfirmationRunRef.current = run;
    updateBillingHandoff({ ...handoff, phase: 'confirming' });
    const result = await pollBillingConfirmation({
      before: handoff.before,
      fetchSnapshot: fetchAuthoritativeBillingSnapshot,
      intent: handoff.intent
    });
    if (billingConfirmationRunRef.current !== run) {
      return;
    }
    if (result.status === 'unconfirmed') {
      recordOperationalMetric({
        intent: handoff.intent.kind,
        name: 'checkout_return_failure',
        outcome: 'unconfirmed',
        requestId: null
      });
    }
    updateBillingHandoff({
      ...handoff,
      phase: result.status === 'confirmed' ? 'confirmed' : 'unconfirmed'
    });
    await onBillingHandoffComplete?.();
  }, [fetchAuthoritativeBillingSnapshot, onBillingHandoffComplete, updateBillingHandoff]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (returnedToForeground) {
        void beginBillingConfirmation();
      }
    });
    return () => subscription.remove();
  }, [beginBillingConfirmation]);

  const currentBillingSnapshot = async (): Promise<BillingAuthoritativeSnapshot> => {
    const billing = billingQuery.data;
    const invoices = invoicesQuery.data?.invoices;
    if (billing !== undefined && invoices !== undefined) {
      return createBillingAuthoritativeSnapshot(billing, invoices);
    }
    return fetchAuthoritativeBillingSnapshot();
  };

  const openBillingHandoff = async (
    checkout: Promise<OrganizationCheckoutRecord>,
    intent: BillingHandoffIntent
  ): Promise<void> => {
    let before: BillingAuthoritativeSnapshot | null = null;
    try {
      const result = await checkout;
      before = await currentBillingSnapshot();
      updateBillingHandoff({ before, intent, phase: 'waiting_for_return' });
      const opened = await onOpenBillingUrl(result.url);
      if (opened === false) {
        recordOperationalMetric({
          intent: intent.kind,
          name: 'checkout_return_failure',
          outcome: 'error',
          requestId: null
        });
        updateBillingHandoff({ before, intent, phase: 'unconfirmed' });
      }
    } catch (error) {
      recordOperationalMetric({
        intent: intent.kind,
        name: 'checkout_return_failure',
        outcome: 'error',
        requestId: error instanceof ApiError ? error.requestId : null
      });
      if (before !== null) {
        updateBillingHandoff({ before, intent, phase: 'unconfirmed' });
      }
    }
  };

  const requestMemberRemoval = (member: OrganizationMemberRecord): void => {
    onConfirmRemoveMember(member, async () => {
      await removeMemberMutation.mutateAsync(member);
    });
  };
  const requestOrganizationSafetyReport = (
    targetKind: OrganizationSafetyReportTargetKind
  ): void => {
    if (safetyReportStatus === 'sending') {
      return;
    }
    confirmAction({
      language,
      title: t(language, 'component.organizationSafetyReport.confirmTitle'),
      message: t(language, 'component.organizationSafetyReport.confirmMessage'),
      confirmLabel: t(language, 'component.organizationSafetyReport.confirmAction'),
      onConfirm: () => {
        setSafetyReportStatus('sending');
        setSafetyReportTarget(targetKind);
        void api
          .submitOrganizationSafetyReport(organizationId, targetKind)
          .then(() => setSafetyReportStatus('sent'))
          .catch(() => setSafetyReportStatus('failed'))
          .finally(() => setSafetyReportTarget(null));
      }
    });
  };
  const downloadUsageCsv = async (): Promise<void> => {
    if (usageCsvLoading) {
      return;
    }
    setUsageCsvError(null);
    setUsageCsvLoading(true);
    try {
      await onDownloadUsageCsv();
    } catch (error) {
      setUsageCsvError(error);
    } finally {
      setUsageCsvLoading(false);
    }
  };

  const initialWorkspaceReady = workspace !== undefined;
  if (!activeMembership) {
    return (
      <Section title={t(language, "generated.components.OrganizationManagementPanel.organization.workspace.f202ee81")} tone="subtle">
        <Notice message={inactiveMembershipMessage(language)} tone="warning" />
      </Section>
    );
  }

  return (
    <View style={styles.root}>
      <Section
        collapsible
        persistKey={`organization:${organizationId}:summary`}
        subtitle={t(language, "generated.components.OrganizationManagementPanel.this.is.the.currently.selected.organizat.ae33e0a4")}
        title={t(language, "generated.components.OrganizationManagementPanel.organization.workspace.f202ee81")}
      >
        {workspaceQuery.isError ? <Notice message={organizationLoadError(language)} tone="danger" /> : null}
        <View style={styles.row}>
          <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.name.d896e617")}</Text>
          <Text style={styles.value}>{workspace?.organization.name ?? organization.name}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.your.role.d6cf6f89")}</Text>
          <Text style={styles.value}>{roleLabel(role, language)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.shared.credits.ac0ba23d")}</Text>
          <Text style={styles.value}>{workspace?.balance?.total_credits ?? organization.total_credits}</Text>
        </View>
        {!initialWorkspaceReady ? <Text style={styles.caption}>{t(language, "generated.components.OrganizationManagementPanel.loading.workspace.information.f50b393d")}</Text> : null}
        {!canManageOrganization ? <Notice message={workspaceManagementDeniedMessage(role, language)} tone="info" /> : null}
        {role !== 'owner' ? <Notice message={roleAccessSummaryMessage(role, language)} tone="info" /> : null}
      </Section>

      <Section
        collapsible
        defaultCollapsed
        persistKey={`organization:${organizationId}:safety-report`}
        subtitle={t(language, 'component.organizationSafetyReport.subtitle')}
        title={t(language, 'component.organizationSafetyReport.title')}
      >
        <View style={styles.actions}>
          <PrimaryButton
            disabled={safetyReportStatus === 'sending'}
            label={t(language, 'component.organizationSafetyReport.workspaceContentAction')}
            loading={safetyReportTarget === 'workspace_content'}
            onPress={() => requestOrganizationSafetyReport('workspace_content')}
            variant="ghost"
          />
          <PrimaryButton
            disabled={safetyReportStatus === 'sending'}
            label={t(language, 'component.organizationSafetyReport.memberAction')}
            loading={safetyReportTarget === 'member'}
            onPress={() => requestOrganizationSafetyReport('member')}
            variant="ghost"
          />
        </View>
        {safetyReportStatus === 'sent' ? (
          <Notice message={t(language, 'component.organizationSafetyReport.sent')} tone="info" />
        ) : null}
        {safetyReportStatus === 'failed' ? (
          <Notice message={t(language, 'component.organizationSafetyReport.failed')} tone="info" />
        ) : null}
      </Section>

      {canManageOrganization ? (
        <Section
          collapsible
          defaultCollapsed
          persistKey={`organization:${organizationId}:settings`}
          subtitle={t(language, "generated.components.OrganizationManagementPanel.update.workspace.details.contract.status.e0aa8351")}
          title={t(language, "generated.components.OrganizationManagementPanel.workspace.settings.24248e90")}
        >
          <FormField label={t(language, "generated.components.OrganizationManagementPanel.display.name.a2ca182b")} maxLength={120} onChangeText={setWorkspaceName} value={workspaceName} />
          <FormField label={t(language, "generated.components.OrganizationManagementPanel.legal.name.726b55d4")} maxLength={200} onChangeText={setLegalName} value={legalName} />
          <FormField autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label={t(language, "generated.components.OrganizationManagementPanel.billing.email.7932a955")} maxLength={320} onChangeText={setBillingEmail} value={billingEmail} />
          {updateWorkspaceMutation.isError ? <Notice message={organizationActionError(language)} tone="danger" /> : null}
          <PrimaryButton
            disabled={workspaceName.trim().length === 0}
            disabledReason={workspaceName.trim().length === 0 ? t(language, "generated.components.OrganizationManagementPanel.enter.a.display.name.1d07fc85") : undefined}
            label={t(language, "generated.components.OrganizationManagementPanel.save.settings.2a1060c4")}
            loading={updateWorkspaceMutation.isPending}
            onPress={() => void updateWorkspaceMutation.mutateAsync()}
          />
        </Section>
      ) : null}

      {canManageMembers ? (
        <>
          <Section
            collapsible
            defaultCollapsed
            persistKey={`organization:${organizationId}:invite`}
            subtitle={t(language, "generated.components.OrganizationManagementPanel.invitations.are.sent.by.email.invitation.23a5c5ae")}
            title={t(language, "generated.components.OrganizationManagementPanel.invite.member.f9276748")}
          >
            <FormField autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label={t(language, "generated.components.OrganizationManagementPanel.email.address.167ce6a9")} maxLength={320} onChangeText={setInviteEmail} value={inviteEmail} />
            <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.role.to.grant.e9b323ec")}</Text>
            <SegmentedControl
              collapseAfter={3}
              onChange={setInviteRole}
              options={inviteRoleOptions(role, language)}
              value={inviteRole}
            />
            {inviteMutation.isError ? <Notice message={organizationActionError(language)} tone="danger" /> : null}
            <PrimaryButton
              disabled={!isEmailLike(inviteEmail)}
              disabledReason={!isEmailLike(inviteEmail) ? t(language, "generated.components.OrganizationManagementPanel.enter.a.valid.email.address.c1e1c912") : undefined}
              label={t(language, "generated.components.OrganizationManagementPanel.send.invitation.3ae080ce")}
              loading={inviteMutation.isPending}
              onPress={() => void inviteMutation.mutateAsync()}
            />
          </Section>

          <Section collapsible persistKey={`organization:${organizationId}:members`} title={t(language, "generated.components.OrganizationManagementPanel.members.0ff85898")}>
            <Text style={styles.caption}>
              {loadedRecordCountLabel(members.length, membersQuery.hasNextPage, language)}
            </Text>
            <View collapsable={false} ref={membersCollectionTriggerRef}>
              <PrimaryButton
                label={t(language, "generated.components.OrganizationManagementPanel.open.member.list.964213a0")}
                onPress={() => setActiveCollection('members')}
                variant="secondary"
              />
            </View>
            {membersQuery.isError || updateMemberMutation.isError || removeMemberMutation.isError ? <Notice message={organizationActionError(language)} tone="danger" /> : null}
          </Section>

          <Section collapsible defaultCollapsed persistKey={`organization:${organizationId}:invitations`} title={t(language, "generated.components.OrganizationManagementPanel.invitation.status.d0c8e708")}>
            <Text style={styles.caption}>
              {loadedRecordCountLabel(invitations.length, invitationsQuery.hasNextPage, language)}
            </Text>
            <View collapsable={false} ref={invitationsCollectionTriggerRef}>
              <PrimaryButton
                label={t(language, "generated.components.OrganizationManagementPanel.open.invitation.list.232e9d2f")}
                onPress={() => setActiveCollection('invitations')}
                variant="secondary"
              />
            </View>
            {invitationsQuery.isError || resendInvitationMutation.isError || revokeInvitationMutation.isError ? <Notice message={organizationActionError(language)} tone="danger" /> : null}
          </Section>
        </>
      ) : null}

      {canViewBilling ? (
        <Section
          collapsible
          persistKey={`organization:${organizationId}:billing`}
          subtitle={t(language, "generated.components.OrganizationManagementPanel.returning.from.an.external.billing.page.61fc9497")}
          title={t(language, "generated.components.OrganizationManagementPanel.billing.management.9567a861")}
          tone="highlight"
        >
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.current.subscription.9778abf6")}</Text>
            <Text style={styles.value}>{subscriptionLabel(billingQuery.data?.subscription?.plan_code ?? organization.plan_key, language)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.subscription.status.5e48facb")}</Text>
            <Text style={styles.value}>{billingQuery.data?.subscription === null ? t(language, "generated.components.OrganizationManagementPanel.no.active.subscription.09e49068") : subscriptionStatusLabel(billingQuery.data?.subscription?.status, language)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.shared.balance.6c64a00f")}</Text>
            <Text style={styles.value}>{billingQuery.data?.workspace?.balance?.total_credits ?? workspace?.balance?.total_credits ?? organization.total_credits}</Text>
          </View>
          {billingHandoff === null ? null : (
            <>
              <BillingHandoffNotice
                intent={billingHandoff.intent}
                language={language}
                phase={billingHandoff.phase}
              />
              {billingHandoff.phase !== 'unconfirmed' ? null : (
                <PrimaryButton
                  label={t(language, "generated.components.OrganizationManagementPanel.check.billing.again.0f44bd41")}
                  onPress={() => {
                    const retry = { ...billingHandoff, phase: 'waiting_for_return' as const };
                    updateBillingHandoff(retry);
                    void beginBillingConfirmation();
                  }}
                  variant="secondary"
                />
              )}
            </>
          )}
          {billingQuery.isError || invoicesQuery.isError ? <Notice message={organizationLoadError(language)} tone="danger" /> : null}
          {canManageBilling && allowExternalBillingActions ? (
            <>
              <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.change.plan.9392d13e")}</Text>
              {subscriptionPlans.filter((plan) => plan.configured).map((plan) => (
                <View key={plan.plan_code} style={styles.compactRow}>
                  <Text style={styles.value}>{language === 'ja' ? plan.display_name_ja : plan.display_name_en}</Text>
                  <Text style={styles.caption}>{formatYen(plan.amount_jpy, language)} / {t(language, "generated.components.OrganizationManagementPanel.month.5d223b95")}</Text>
                  <PrimaryButton
                    label={t(language, "generated.components.OrganizationManagementPanel.open.checkout.87735f44")}
                    loading={subscriptionCheckoutMutation.isPending && subscriptionCheckoutMutation.variables === plan.plan_code}
                    onPress={() =>
                      void openBillingHandoff(
                        subscriptionCheckoutMutation.mutateAsync(plan.plan_code),
                        { kind: 'subscription', targetPlanCode: plan.plan_code }
                      )
                    }
                    variant="secondary"
                  />
                </View>
              ))}
              <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.additional.credits.6f7c531e")}</Text>
              {(['credits_200', 'credits_1000', 'credits_3000'] as const).map((packageCode) => (
                <PrimaryButton
                  key={packageCode}
                  label={creditPackageLabel(packageCode, language)}
                  loading={creditCheckoutMutation.isPending && creditCheckoutMutation.variables === packageCode}
                  onPress={() =>
                    void openBillingHandoff(
                      creditCheckoutMutation.mutateAsync(packageCode),
                      { kind: 'credits' }
                    )
                  }
                  variant="secondary"
                />
              ))}
              <PrimaryButton
                label={t(language, "generated.components.OrganizationManagementPanel.open.billing.portal.771b67d1")}
                loading={portalMutation.isPending}
                onPress={() =>
                  void openBillingHandoff(
                    portalMutation.mutateAsync(),
                    { kind: 'portal' }
                  )
                }
                variant="ghost"
              />
              {subscriptionCheckoutMutation.isError || creditCheckoutMutation.isError || portalMutation.isError ? <Notice message={organizationActionError(language)} tone="danger" /> : null}
            </>
          ) : canManageBilling ? null : <Notice message={billingManagementDeniedMessage(language)} tone="info" />}
          <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.invoices.389b3076")}</Text>
          {(invoicesQuery.data?.invoices ?? []).map((invoice) => (
            <View key={invoice.id} style={styles.compactRow}>
              <Text style={styles.value}>{invoiceKindLabel(invoice.kind, language)}</Text>
              <Text style={styles.caption}>{formatYen(invoice.amount_jpy, language)} · {invoiceStatusLabel(invoice.status, language)} · {formatDate(invoice.created_at, language)}</Text>
              {invoice.invoice_url === null || !allowExternalBillingActions ? null : <PrimaryButton label={t(language, "generated.components.OrganizationManagementPanel.open.invoice.a10f954b")} onPress={() => void onOpenBillingUrl(invoice.invoice_url ?? '')} variant="ghost" />}
            </View>
          ))}
        </Section>
      ) : null}

      {canViewUsage ? (
        <Section collapsible defaultCollapsed persistKey={`organization:${organizationId}:usage`} title={t(language, "generated.components.OrganizationManagementPanel.usage.5dc28ce4")}>
          {usageQuery.isError ? <Notice message={organizationLoadError(language)} tone="danger" /> : null}
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, "generated.components.OrganizationManagementPanel.credits.used.this.month.086861a9")}</Text>
            <Text style={styles.value}>{usageSummary?.current_month_total_credits ?? 0}</Text>
          </View>
          <Text style={styles.caption}>
            {loadedRecordCountLabel(usageEvents.length, usageQuery.hasNextPage, language)}
          </Text>
          <View collapsable={false} ref={usageCollectionTriggerRef}>
            <PrimaryButton
              label={t(language, "generated.components.OrganizationManagementPanel.open.usage.breakdown.and.history.04abddf9")}
              onPress={() => setActiveCollection('usage')}
              variant="secondary"
            />
          </View>
          <PrimaryButton
            label={t(language, "generated.components.OrganizationManagementPanel.share.or.save.usage.csv.4c0ccb2d")}
            loading={usageCsvLoading}
            onPress={() => {
              void downloadUsageCsv();
            }}
            variant="ghost"
          />
          {usageCsvError === null ? null : (
            <Notice message={userErrorMessage(usageCsvError, language)} tone="danger" />
          )}
        </Section>
      ) : null}

      {canViewAudit ? (
        <Section collapsible defaultCollapsed persistKey={`organization:${organizationId}:audit`} title={t(language, "generated.components.OrganizationManagementPanel.audit.history.eec3270f")}>
          {auditQuery.isError ? <Notice message={organizationLoadError(language)} tone="danger" /> : null}
          {role === 'billing' ? <Notice message={t(language, "generated.components.OrganizationManagementPanel.only.billing.related.audit.history.is.av.f6e5cc79")} tone="info" /> : null}
          <Text style={styles.caption}>
            {loadedRecordCountLabel(auditLogs.length, auditQuery.hasNextPage, language)}
          </Text>
          <View collapsable={false} ref={auditCollectionTriggerRef}>
            <PrimaryButton
              label={t(language, "generated.components.OrganizationManagementPanel.open.audit.history.d01bd169")}
              onPress={() => setActiveCollection('audit')}
              variant="secondary"
            />
          </View>
        </Section>
      ) : null}

      {!canManageMembers && !canViewBilling && !canViewUsage && !canViewAudit ? (
        <Notice message={limitedRoleMessage(language)} tone="info" />
      ) : null}

      {canManageMembers ? (
        <>
          <OrganizationCollectionModal
            data={members}
            emptyLabel={t(language, "generated.components.OrganizationManagementPanel.no.members.found.78642303")}
            fetchingNextPage={membersQuery.isFetchingNextPage}
            hasNextPage={membersQuery.hasNextPage}
            language={language}
            loading={membersQuery.isLoading}
            onClose={() => setActiveCollection(null)}
            onEndReached={() => {
              void membersQuery.fetchNextPage();
            }}
            renderItem={({ item: member }) => (
              <MemberRow
                currentRole={role}
                language={language}
                member={member}
                onRemove={() => requestMemberRemoval(member)}
                onStatusChange={(status) => void updateMemberMutation.mutateAsync({ member, body: { status } })}
                onRoleChange={(nextRole) => void updateMemberMutation.mutateAsync({ member, body: { role: nextRole } })}
                removing={removeMemberMutation.isPending && removeMemberMutation.variables?.id === member.id}
                updating={updateMemberMutation.isPending && updateMemberMutation.variables?.member.id === member.id}
              />
            )}
            restoreFocusRef={membersCollectionTriggerRef}
            title={t(language, "generated.components.OrganizationManagementPanel.members.0ff85898")}
            visible={activeCollection === 'members'}
          />
          <OrganizationCollectionModal
            data={invitations}
            emptyLabel={t(language, "generated.components.OrganizationManagementPanel.there.are.no.pending.invitations.a11b4fd0")}
            fetchingNextPage={invitationsQuery.isFetchingNextPage}
            hasNextPage={invitationsQuery.hasNextPage}
            language={language}
            loading={invitationsQuery.isLoading}
            onClose={() => setActiveCollection(null)}
            onEndReached={() => {
              void invitationsQuery.fetchNextPage();
            }}
            renderItem={({ item: invitation }) => (
              <InvitationRow
                invitation={invitation}
                language={language}
                onResend={() => void resendInvitationMutation.mutateAsync(invitation)}
                onRevoke={() => void revokeInvitationMutation.mutateAsync(invitation)}
                pending={
                  (resendInvitationMutation.isPending && resendInvitationMutation.variables?.id === invitation.id) ||
                  (revokeInvitationMutation.isPending && revokeInvitationMutation.variables?.id === invitation.id)
                }
              />
            )}
            restoreFocusRef={invitationsCollectionTriggerRef}
            title={t(language, "generated.components.OrganizationManagementPanel.invitation.status.d0c8e708")}
            visible={activeCollection === 'invitations'}
          />
        </>
      ) : null}

      {canViewUsage ? (
        <OrganizationCollectionModal
          data={usageListItems}
          emptyLabel={t(language, "generated.components.OrganizationManagementPanel.no.usage.history.found.b0df38f1")}
          fetchingNextPage={usageQuery.isFetchingNextPage}
          hasNextPage={usageQuery.hasNextPage}
          language={language}
          loading={usageQuery.isLoading}
          onClose={() => setActiveCollection(null)}
          onEndReached={() => {
            void usageQuery.fetchNextPage();
          }}
          renderItem={({ item }) => <OrganizationUsageRow item={item} language={language} />}
          restoreFocusRef={usageCollectionTriggerRef}
          title={t(language, "generated.components.OrganizationManagementPanel.usage.breakdown.and.history.fd69122e")}
          visible={activeCollection === 'usage'}
        />
      ) : null}

      {canViewAudit ? (
        <OrganizationCollectionModal
          data={auditLogs}
          emptyLabel={t(language, "generated.components.OrganizationManagementPanel.no.audit.history.found.50ce2abc")}
          fetchingNextPage={auditQuery.isFetchingNextPage}
          hasNextPage={auditQuery.hasNextPage}
          language={language}
          loading={auditQuery.isLoading}
          onClose={() => setActiveCollection(null)}
          onEndReached={() => {
            void auditQuery.fetchNextPage();
          }}
          renderItem={({ item }) => <OrganizationAuditRow language={language} log={item} />}
          restoreFocusRef={auditCollectionTriggerRef}
          title={t(language, "generated.components.OrganizationManagementPanel.audit.history.eec3270f")}
          visible={activeCollection === 'audit'}
        />
      ) : null}
    </View>
  );
}

interface MemberRowProps {
  member: OrganizationMemberRecord;
  currentRole: OrganizationRole;
  language: UiLanguage;
  updating: boolean;
  removing: boolean;
  onRoleChange: (role: OrganizationRole) => void;
  onStatusChange: (status: 'active' | 'suspended') => void;
  onRemove: () => void;
}

function MemberRow({ member, currentRole, language, updating, removing, onRoleChange, onStatusChange, onRemove }: MemberRowProps): React.JSX.Element {
  const canEditOwner = currentRole === 'owner';
  const canEditTarget = canEditOwner || member.role !== 'owner';
  const disabledReason = canEditTarget
    ? undefined
    : t(language, "generated.components.OrganizationManagementPanel.only.an.owner.can.change.an.owner.role.1448b8a8");
  return (
    <View style={styles.listRow}>
      <Text style={styles.value}>{member.display_name ?? member.email}</Text>
      {member.display_name === null ? null : <Text style={styles.caption}>{member.email}</Text>}
      <Text style={styles.caption}>{roleLabel(member.role, language)} · {memberStatusLabel(member.status, language)}</Text>
      <SegmentedControl
        collapseAfter={3}
        disabled={!canEditTarget || updating}
        onChange={onRoleChange}
        options={memberRoleOptions(currentRole, language)}
        value={member.role}
      />
      {!canEditTarget ? <Text style={styles.caption}>{disabledReason}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton
          disabled={!canEditTarget}
          disabledReason={disabledReason}
          label={member.status === 'suspended' ? t(language, "generated.components.OrganizationManagementPanel.restore.1c276c05") : t(language, "generated.components.OrganizationManagementPanel.suspend.4566c5ef")}
          loading={updating}
          onPress={() => onStatusChange(member.status === 'suspended' ? 'active' : 'suspended')}
          variant="ghost"
        />
        <PrimaryButton
          disabled={!canEditTarget}
          disabledReason={disabledReason}
          label={t(language, "generated.components.OrganizationManagementPanel.remove.1d5b5e95")}
          loading={removing}
          onPress={onRemove}
          variant="danger"
        />
      </View>
    </View>
  );
}

function InvitationRow({ invitation, language, pending, onResend, onRevoke }: {
  invitation: OrganizationInvitationRecord;
  language: UiLanguage;
  pending: boolean;
  onResend: () => void;
  onRevoke: () => void;
}): React.JSX.Element {
  const canAct = invitation.status === 'pending';
  return (
    <View style={styles.listRow}>
      <Text style={styles.value}>{invitation.email}</Text>
      <Text style={styles.caption}>{roleLabel(invitation.role, language)} · {invitationStatusLabel(invitation.status, language)} · {inviteDeliveryLabel(invitation.send_status, language)}</Text>
      <Text style={styles.caption}>{t(language, "generated.components.OrganizationManagementPanel.expires.a639c76f")} {formatDate(invitation.expires_at, language)}</Text>
      <View style={styles.actions}>
        <PrimaryButton disabled={!canAct} disabledReason={!canAct ? t(language, "generated.components.OrganizationManagementPanel.only.pending.invitations.can.be.resent.e042e05a") : undefined} label={t(language, "generated.components.OrganizationManagementPanel.resend.8181a300")} loading={pending} onPress={onResend} variant="ghost" />
        <PrimaryButton disabled={!canAct} disabledReason={!canAct ? t(language, "generated.components.OrganizationManagementPanel.only.pending.invitations.can.be.revoked.4174136e") : undefined} label={t(language, "generated.components.OrganizationManagementPanel.revoke.2d742891")} loading={pending} onPress={onRevoke} variant="danger" />
      </View>
    </View>
  );
}

type OrganizationUsageListItem =
  | {
      credits: number;
      id: string;
      kind: 'summary';
      label: string;
      title: string;
    }
  | {
      event: OrganizationUsageEventRecord;
      id: string;
      kind: 'event';
    };

function OrganizationUsageRow({
  item,
  language
}: {
  item: OrganizationUsageListItem;
  language: UiLanguage;
}): React.JSX.Element {
  if (item.kind === 'summary') {
    return (
      <View style={styles.compactRow}>
        <Text style={styles.label}>{item.title}</Text>
        <View style={styles.row}>
          <Text numberOfLines={2} style={styles.caption}>{item.label}</Text>
          <Text style={styles.value}>{item.credits}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.compactRow}>
      <Text style={styles.value}>{item.event.event_type.replace(/[_-]+/g, ' ')}</Text>
      <Text style={styles.caption}>
        {item.event.credit_amount} · {formatDate(item.event.created_at, language)}
      </Text>
    </View>
  );
}

function OrganizationAuditRow({
  language,
  log
}: {
  language: UiLanguage;
  log: OrganizationAuditLogRecord;
}): React.JSX.Element {
  return (
    <View style={styles.compactRow}>
      <Text style={styles.value}>{log.action.replace(/[._-]+/g, ' ')}</Text>
      <Text style={styles.caption}>
        {auditTargetLabel(log.target_type, language)} · {formatDate(log.created_at, language)}
      </Text>
    </View>
  );
}

function loadedRecordCountLabel(
  count: number,
  hasNextPage: boolean,
  language: UiLanguage
): string {
  return t(
    language,
    hasNextPage
      ? 'component.organization.loadedRecordCountMore'
      : 'component.organization.loadedRecordCount',
    { count }
  );
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function inviteRoleOptions(role: OrganizationRole, language: UiLanguage): { value: OrganizationRole; label: string }[] {
  return memberRoleOptions(role, language).filter((option) => role === 'owner' || option.value !== 'owner');
}

function memberRoleOptions(role: OrganizationRole, language: UiLanguage): { value: OrganizationRole; label: string }[] {
  const all: OrganizationRole[] = ['owner', 'admin', 'billing', 'editor', 'viewer'];
  return all.filter((candidate) => role === 'owner' || candidate !== 'owner').map((candidate) => ({ value: candidate, label: roleLabel(candidate, language) }));
}

function roleLabel(role: OrganizationRole, language: UiLanguage): string {
  const labels: Record<OrganizationRole, ComponentTranslationKey> = {
    owner: 'component.organization.role.owner',
    admin: 'component.organization.role.admin',
    billing: 'component.organization.role.billing',
    editor: 'component.organization.role.editor',
    viewer: 'component.organization.role.viewer'
  };
  return t(language, labels[role]);
}

function memberStatusLabel(status: OrganizationMemberRecord['status'], language: UiLanguage): string {
  const labels: Record<OrganizationMemberRecord['status'], ComponentTranslationKey> = {
    invited: 'component.organization.memberStatus.invited',
    active: 'component.organization.memberStatus.active',
    suspended: 'component.organization.memberStatus.suspended',
    removed: 'component.organization.memberStatus.removed'
  };
  return t(language, labels[status]);
}

function invitationStatusLabel(status: OrganizationInvitationRecord['status'], language: UiLanguage): string {
  const labels: Record<OrganizationInvitationRecord['status'], ComponentTranslationKey> = {
    pending: 'component.organization.invitationStatus.pending',
    accepted: 'component.organization.invitationStatus.accepted',
    revoked: 'component.organization.invitationStatus.revoked',
    expired: 'component.organization.invitationStatus.expired'
  };
  return t(language, labels[status]);
}

function inviteDeliveryLabel(status: OrganizationInvitationRecord['send_status'], language: UiLanguage): string {
  const labels: Record<OrganizationInvitationRecord['send_status'], ComponentTranslationKey> = {
    not_sent: 'component.organization.inviteDelivery.notSent',
    sending: 'component.organization.inviteDelivery.sending',
    sent: 'component.organization.inviteDelivery.sent',
    failed: 'component.organization.inviteDelivery.failed'
  };
  return t(language, labels[status]);
}

function subscriptionLabel(planCode: string, language: UiLanguage): string {
  const labels: Record<string, ComponentTranslationKey> = {
    enterprise_a: 'component.organization.subscription.enterpriseA',
    enterprise_b: 'component.organization.subscription.enterpriseB',
    enterprise_c: 'component.organization.subscription.enterpriseC'
  };
  const label = labels[planCode];
  return label === undefined ? t(language, "generated.components.OrganizationManagementPanel.enterprise.plan.8cd8a370") : t(language, label);
}

function subscriptionStatusLabel(status: string | undefined, language: UiLanguage): string {
  const labels: Record<string, ComponentTranslationKey> = {
    trialing: 'component.organization.subscriptionStatus.trialing',
    active: 'component.organization.subscriptionStatus.active',
    past_due: 'component.organization.subscriptionStatus.pastDue',
    canceled: 'component.organization.subscriptionStatus.canceled',
    unpaid: 'component.organization.subscriptionStatus.unpaid',
    incomplete: 'component.organization.subscriptionStatus.incomplete',
    incomplete_expired: 'component.organization.subscriptionStatus.incompleteExpired'
  };
  const label = status === undefined ? undefined : labels[status];
  return label === undefined ? t(language, "generated.components.OrganizationManagementPanel.pending.confirmation.5346df6c") : t(language, label);
}

function invoiceKindLabel(kind: 'subscription' | 'credit_purchase', language: UiLanguage): string {
  return kind === 'subscription' ? t(language, "generated.components.OrganizationManagementPanel.subscription.536ebdbb") : t(language, "generated.components.OrganizationManagementPanel.credit.purchase.b8b0452b");
}

function invoiceStatusLabel(status: 'paid' | 'failed', language: UiLanguage): string {
  return status === 'paid' ? t(language, "generated.components.OrganizationManagementPanel.paid.7a3edfe7") : t(language, "generated.components.OrganizationManagementPanel.failed.833e5201");
}

function auditTargetLabel(targetType: string, language: UiLanguage): string {
  const labels: Record<string, ComponentTranslationKey> = {
    organization: 'component.organization.auditTarget.organization',
    member: 'component.organization.auditTarget.member',
    invitation: 'component.organization.auditTarget.invitation',
    billing: 'component.organization.auditTarget.billing',
    subscription: 'component.organization.auditTarget.subscription',
    credit: 'component.organization.auditTarget.credit'
  };
  const label = labels[targetType];
  return label === undefined ? t(language, "generated.components.OrganizationManagementPanel.operation.target.4f3f41b3") : t(language, label);
}

function creditPackageLabel(packageCode: 'credits_200' | 'credits_1000' | 'credits_3000', language: UiLanguage): string {
  const credits = packageCode.replace('credits_', '');
  return t(language, 'component.organization.creditPackage', { credits });
}

function formatYen(amount: number, language: UiLanguage): string {
  return new Intl.NumberFormat(language === 'ja' ? 'ja-JP' : 'en-US', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(value: string, language: UiLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium' }).format(date);
}

function inactiveMembershipMessage(language: UiLanguage): string {
  return t(language, "generated.components.OrganizationManagementPanel.your.membership.in.this.organization.is.fe41b5d3");
}

function limitedRoleMessage(language: UiLanguage): string {
  return t(language, "generated.components.OrganizationManagementPanel.your.role.can.view.this.workspace.but.ca.ddecef18");
}

function workspaceManagementDeniedMessage(role: OrganizationRole, language: UiLanguage): string {
  if (role === 'admin') return t(language, "generated.components.OrganizationManagementPanel.admins.can.manage.members.but.cannot.cha.2b0f726e");
  if (role === 'billing') return t(language, "generated.components.OrganizationManagementPanel.billing.users.can.view.and.manage.billin.268a7656");
  return limitedRoleMessage(language);
}

function roleAccessSummaryMessage(role: OrganizationRole, language: UiLanguage): string {
  if (role === 'admin') {
    return t(language, "generated.components.OrganizationManagementPanel.admins.can.manage.members.usage.and.audi.b439e033");
  }
  if (role === 'billing') {
    return t(language, "generated.components.OrganizationManagementPanel.billing.users.can.manage.billing.and.vie.507a1ba1");
  }
  return limitedRoleMessage(language);
}

function billingManagementDeniedMessage(language: UiLanguage): string {
  return t(language, "generated.components.OrganizationManagementPanel.you.can.view.billing.but.only.billing.us.13d2dc75");
}

function organizationLoadError(language: UiLanguage): string {
  return t(language, "generated.components.OrganizationManagementPanel.organization.information.could.not.be.lo.51231ca2");
}

function organizationActionError(language: UiLanguage): string {
  return t(language, "generated.components.OrganizationManagementPanel.the.operation.could.not.be.completed.che.b875de13");
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  caption: { ...textStyles.caption, color: colors.muted },
  compactRow: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: spacing.xs, paddingBottom: spacing.sm },
  label: { ...textStyles.caption, color: colors.ink, fontWeight: '700' },
  listRow: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: spacing.xs, paddingBottom: spacing.md },
  root: { gap: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  value: { ...textStyles.body, color: colors.inkStrong, flexShrink: 1, fontWeight: '700', textAlign: 'right' }
});
