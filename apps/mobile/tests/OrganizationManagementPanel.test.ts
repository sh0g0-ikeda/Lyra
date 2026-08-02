import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganizationManagementPanel } from '@/components/OrganizationManagementPanel';

const {
  appStateAddEventListenerMock,
  confirmActionMock,
  organizationCollectionModalMock,
  queryClientMock,
  recordOperationalMetricMock,
  useInfiniteQueryMock,
  useQueryMock,
  useMutationMock
} = vi.hoisted(() => ({
  appStateAddEventListenerMock: vi.fn(),
  confirmActionMock: vi.fn(),
  organizationCollectionModalMock: vi.fn(),
  queryClientMock: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn()
  },
  recordOperationalMetricMock: vi.fn(),
  useInfiniteQueryMock: vi.fn(),
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn()
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: useInfiniteQueryMock,
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: () => queryClientMock
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    addEventListener: appStateAddEventListenerMock,
    currentState: 'active'
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}));

vi.mock('@/components/Section', () => ({
  Section: ({ children, title }: { children: React.ReactNode; title: string }) =>
    React.createElement('section', { title }, children)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    disabledReason,
    label,
    loading,
    onPress
  }: {
    disabled?: boolean;
    disabledReason?: string;
    label: string;
    loading?: boolean;
    onPress: () => void;
  }) => React.createElement('button', { disabled, disabledReason, loading, onClick: onPress }, label)
}));

vi.mock('@/components/FormField', () => ({
  FormField: ({ label }: { label: string }) => React.createElement('input', { 'aria-label': label })
}));

vi.mock('@/components/SegmentedControl', () => ({
  SegmentedControl: () => React.createElement('segmented-control')
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/components/OrganizationCollectionModal', () => ({
  OrganizationCollectionModal: (props: {
    data: { id: string }[];
    onEndReached: () => void;
    renderItem: (input: { item: { id: string }; index: number }) => React.ReactNode;
    title: string;
    visible: boolean;
  }) => {
    organizationCollectionModalMock(props);
    return props.visible
      ? React.createElement(
          'organization-collection-modal',
          { onEndReached: props.onEndReached, title: props.title },
          props.data.map((item, index) => props.renderItem({ item, index }))
        )
      : null;
  }
}));

vi.mock('@/lib/operationalEvents', () => ({
  recordOperationalMetric: recordOperationalMetricMock
}));

vi.mock('@/lib/confirm', () => ({
  confirmAction: confirmActionMock
}));

const organization = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Lyra Studio',
  status: 'active',
  plan_key: 'enterprise_a',
  role: 'owner' as const,
  membership_status: 'active',
  monthly_credits: 100,
  purchased_credits: 0,
  total_credits: 100,
  monthly_expires_at: null
};

const workspace = {
  organization: {
    id: organization.id,
    type: 'business' as const,
    name: organization.name,
    legal_name: null,
    status: 'active' as const,
    plan_key: 'enterprise_a' as const,
    billing_email: null,
    created_by_user_id: 'owner-id',
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z'
  },
  membership: {
    id: 'member-1',
    organization_id: organization.id,
    user_id: 'owner-id',
    email: 'owner@example.test',
    display_name: 'Owner',
    role: 'owner' as const,
    status: 'active' as const,
    invited_by_user_id: null,
    joined_at: '2026-07-25T00:00:00.000Z',
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z'
  },
  balance: null
};

describe('OrganizationManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStateAddEventListenerMock.mockReturnValue({ remove: vi.fn() });
    useInfiniteQueryMock.mockImplementation((options: { enabled?: boolean; queryKey: unknown[] }) => {
      const result = useQueryMock(options) as {
        data?: Record<string, unknown>;
        error?: unknown;
        isError?: boolean;
        isLoading?: boolean;
      };
      return {
        ...result,
        data: options.enabled === false || result.data === undefined
          ? undefined
          : { pages: [result.data], pageParams: [null] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      };
    });
  });

  it('ownerにはメンバー管理と請求手続きを表示し、削除確認を呼び出す', async () => {
    const confirmRemove = vi.fn();
    const downloadUsageCsv = vi.fn().mockResolvedValue(undefined);
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const name = String(options.queryKey[0]);
      if (name === 'organization-workspace') return { data: workspace, isLoading: false, isError: false, error: null };
      if (name === 'organization-members') {
        return {
          data: { members: [{ ...workspace.membership, id: 'member-2', email: 'editor@example.test', display_name: 'Editor', role: 'editor' }] },
          isLoading: false,
          isError: false,
          error: null
        };
      }
      return { data: { invitations: [], invoices: [], usage_events: [], summary: { current_month_total_credits: 0, by_member: [], by_work: [], by_generation_type: [] }, audit_logs: [], subscription: null, subscription_plans: [] }, isLoading: false, isError: false, error: null };
    });
    useMutationMock.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          api: {} as never,
          language: 'ja',
          onConfirmRemoveMember: confirmRemove,
          onDownloadUsageCsv: downloadUsageCsv,
          onOpenBillingUrl: vi.fn(),
          organization,
          sessionKey: 'session-a'
        })
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('メンバー');
    expect(rendered).toContain('請求管理');
    expect(rendered).not.toContain('Editor');
    expect(rendered).not.toContain('member-2');

    const openMembers = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('メンバー一覧を開く'));
    expect(openMembers).toBeDefined();
    act(() => openMembers?.props.onClick());

    expect(JSON.stringify(renderer!.toJSON())).toContain('Editor');
    const removeButton = renderer!.root.findAllByType('button').find((node) => node.children.includes('削除'));
    expect(removeButton).toBeDefined();
    act(() => removeButton?.props.onClick());
    expect(confirmRemove).toHaveBeenCalledTimes(1);

    const csvButton = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('利用履歴CSVを共有・保存'));
    expect(csvButton).toBeDefined();
    await act(async () => {
      csvButton?.props.onClick();
      await Promise.resolve();
    });
    expect(downloadUsageCsv).toHaveBeenCalledOnce();
  });

  it('native review用設定では外部checkoutとbilling portalを表示しない', () => {
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const name = String(options.queryKey[0]);
      if (name === 'organization-workspace') return { data: workspace, isLoading: false, isError: false, error: null };
      if (name === 'organization-billing') {
        return {
          data: {
            workspace,
            subscription: null,
            subscription_plans: [{
              plan_code: 'enterprise_b',
              display_name_ja: '法人 B',
              display_name_en: 'Enterprise B',
              monthly_credits: 500,
              amount_jpy: 50_000,
              minimum_contract_months: 1,
              trial_days: 0,
              is_enterprise: true,
              configured: true,
            }],
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      if (name === 'organization-invoices') {
        return {
          data: {
            invoices: [{
              id: 'invoice-1',
              organization_id: organization.id,
              kind: 'subscription',
              amount_jpy: 10_000,
              status: 'paid',
              invoice_url: 'https://billing.example.test/invoice-1',
              created_at: '2026-08-02T00:00:00.000Z',
            }],
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return { data: { invitations: [], usage_events: [], summary: { current_month_total_credits: 0, by_member: [], by_work: [], by_generation_type: [] }, audit_logs: [], members: [] }, isLoading: false, isError: false, error: null };
    });
    useMutationMock.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          allowExternalBillingActions: false,
          api: {} as never,
          language: 'ja',
          onConfirmRemoveMember: vi.fn(),
          onDownloadUsageCsv: vi.fn(),
          onOpenBillingUrl: vi.fn(),
          organization,
          sessionKey: 'session-a',
        })
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('請求管理');
    expect(rendered).not.toContain('手続きを開く');
    expect(rendered).not.toContain('請求ポータルを開く');
    expect(rendered).not.toContain('請求書を開く');
    expect(rendered).not.toContain('追加クレジット');
  });

  it('外部請求操作が許可される場合は請求書リンクを表示する', () => {
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const name = String(options.queryKey[0]);
      if (name === 'organization-workspace') return { data: workspace, isLoading: false, isError: false, error: null };
      if (name === 'organization-invoices') {
        return {
          data: {
            invoices: [{
              id: 'invoice-1', organization_id: organization.id, kind: 'subscription', amount_jpy: 10_000,
              status: 'paid', invoice_url: 'https://billing.example.test/invoice-1', created_at: '2026-08-02T00:00:00.000Z',
            }],
          }, isLoading: false, isError: false, error: null,
        };
      }
      return { data: { invitations: [], invoices: [], usage_events: [], summary: { current_month_total_credits: 0, by_member: [], by_work: [], by_generation_type: [] }, audit_logs: [], members: [] }, isLoading: false, isError: false, error: null };
    });
    useMutationMock.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(OrganizationManagementPanel, {
        api: {} as never, language: 'ja', onConfirmRemoveMember: vi.fn(), onDownloadUsageCsv: vi.fn(),
        onOpenBillingUrl: vi.fn(), organization, sessionKey: 'session-a',
      }));
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain('請求書を開く');
  });

  it('viewerには権限不足の固定理由を表示し、請求・メンバー操作を表示しない', () => {
    useQueryMock.mockReturnValue({ data: workspace, isLoading: false, isError: false, error: null });
    useMutationMock.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          api: {} as never,
          language: 'en',
          onConfirmRemoveMember: vi.fn(),
          onDownloadUsageCsv: vi.fn(),
          onOpenBillingUrl: vi.fn(),
          organization: { ...organization, role: 'viewer' },
          sessionKey: 'session-a'
        })
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('Your role can view this workspace but cannot manage members, billing, usage, or audit history.');
    expect(rendered).not.toContain('Members');
    expect(rendered).not.toContain('Billing management');
  });

  it('active memberは管理権限なしでもworkspace contentとmemberを通報できる', async () => {
    let resolveWorkspaceReport: ((receipt: { report_id: string; status: string }) => void) | undefined;
    const submitOrganizationSafetyReport = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveWorkspaceReport = resolve;
        })
      )
      .mockRejectedValueOnce(new Error('raw backend detail'));
    useQueryMock.mockReturnValue({ data: workspace, isLoading: false, isError: false, error: null });
    useMutationMock.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          api: { submitOrganizationSafetyReport } as never,
          language: 'ja',
          onConfirmRemoveMember: vi.fn(),
          onDownloadUsageCsv: vi.fn(),
          onOpenBillingUrl: vi.fn(),
          organization: { ...organization, role: 'viewer' },
          sessionKey: 'session-a'
        })
      );
    });

    const workspaceReport = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('ワークスペース内容を通報'));
    const memberReport = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('メンバーを通報'));
    expect(workspaceReport).toBeDefined();
    expect(memberReport).toBeDefined();

    act(() => workspaceReport?.props.onClick());
    const workspaceConfirmation = confirmActionMock.mock.calls[0]?.[0] as { onConfirm: () => void };
    act(() => {
      workspaceConfirmation.onConfirm();
    });
    expect(submitOrganizationSafetyReport).toHaveBeenCalledWith(
      organization.id,
      'workspace_content'
    );
    const reportingButtons = renderer!.root.findAllByType('button').filter((node) =>
      node.children.includes('ワークスペース内容を通報') || node.children.includes('メンバーを通報')
    );
    expect(reportingButtons).toHaveLength(2);
    expect(reportingButtons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ props: expect.objectContaining({ disabled: true }) })
      ])
    );
    await act(async () => {
      resolveWorkspaceReport?.({
        report_id: '22222222-2222-4222-8222-222222222222',
        status: 'received'
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('通報を送信しました。');

    act(() => memberReport?.props.onClick());
    const memberConfirmation = confirmActionMock.mock.calls[1]?.[0] as { onConfirm: () => void };
    await act(async () => {
      memberConfirmation.onConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(submitOrganizationSafetyReport).toHaveBeenLastCalledWith(organization.id, 'member');
    expect(rendered).toContain('通報を送信できませんでした。');
    expect(rendered).not.toContain('raw backend detail');
  });

  it('system browserを開けない場合はcheckout return failureをPIIなしで記録する', async () => {
    const billing = {
      workspace,
      subscription: null,
      subscription_plans: [
        {
          plan_code: 'enterprise_b' as const,
          display_name_ja: '法人 B',
          display_name_en: 'Enterprise B',
          monthly_credits: 500,
          amount_jpy: 50_000,
          minimum_contract_months: 1,
          trial_days: 0,
          is_enterprise: true,
          configured: true
        }
      ]
    };
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const name = String(options.queryKey[0]);
      if (name === 'organization-workspace') {
        return { data: workspace, isLoading: false, isError: false, error: null };
      }
      if (name === 'organization-billing') {
        return { data: billing, isLoading: false, isError: false, error: null };
      }
      if (name === 'organization-invoices') {
        return { data: { invoices: [] }, isLoading: false, isError: false, error: null };
      }
      return {
        data: {
          audit_logs: [],
          invitations: [],
          members: [],
          summary: {
            by_generation_type: [],
            by_member: [],
            by_work: [],
            current_month_total_credits: 0
          },
          usage_events: []
        },
        isLoading: false,
        isError: false,
        error: null
      };
    });
    useMutationMock.mockReturnValue({
      isError: false,
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        session_id: 'checkout-1',
        url: 'https://billing.example.test/checkout'
      }),
      variables: undefined
    });
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          api: {} as never,
          language: 'ja',
          onConfirmRemoveMember: vi.fn(),
          onDownloadUsageCsv: vi.fn(),
          onOpenBillingUrl: vi.fn().mockResolvedValue(false),
          organization,
          sessionKey: 'session-a'
        })
      );
    });

    const checkoutButton = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('手続きを開く'));
    await act(async () => {
      checkoutButton?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recordOperationalMetricMock).toHaveBeenCalledWith({
      intent: 'subscription',
      name: 'checkout_return_failure',
      outcome: 'error',
      requestId: null
    });
  });

  it('請求画面からforeground復帰後にauthoritativeな変更を確認して初めて購入完了を表示する', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    appStateAddEventListenerMock.mockImplementation(
      (_event: string, listener: (state: string) => void) => {
        appStateListener = listener;
        return { remove: vi.fn() };
      }
    );
    const billingBefore = {
      workspace,
      subscription: {
        organization_id: organization.id,
        plan_code: 'enterprise_a' as const,
        status: 'active' as const,
        current_period_start: '2026-07-25T00:00:00.000Z',
        current_period_end: '2026-08-25T00:00:00.000Z',
        cancel_at_period_end: false
      },
      subscription_plans: [
        {
          plan_code: 'enterprise_b' as const,
          display_name_ja: '法人 B',
          display_name_en: 'Enterprise B',
          monthly_credits: 500,
          amount_jpy: 50_000,
          minimum_contract_months: 1,
          trial_days: 0,
          is_enterprise: true,
          configured: true
        }
      ]
    };
    const billingAfter = {
      ...billingBefore,
      subscription: {
        ...billingBefore.subscription,
        plan_code: 'enterprise_b' as const,
        current_period_end: '2026-09-25T00:00:00.000Z'
      }
    };
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const name = String(options.queryKey[0]);
      if (name === 'organization-workspace') {
        return { data: workspace, isLoading: false, isError: false, error: null };
      }
      if (name === 'organization-billing') {
        return { data: billingBefore, isLoading: false, isError: false, error: null };
      }
      if (name === 'organization-invoices') {
        return {
          data: { invoices: [] },
          isLoading: false,
          isError: false,
          error: null
        };
      }
      return {
        data: {
          audit_logs: [],
          invitations: [],
          members: [],
          summary: {
            by_generation_type: [],
            by_member: [],
            by_work: [],
            current_month_total_credits: 0
          },
          usage_events: []
        },
        isLoading: false,
        isError: false,
        error: null
      };
    });
    useMutationMock.mockReturnValue({
      isError: false,
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        session_id: 'checkout-1',
        url: 'https://billing.example.test/checkout'
      }),
      variables: undefined
    });
    const api = {
      getOrganizationBillingSummary: vi.fn().mockResolvedValue(billingAfter),
      getOrganizationInvoices: vi.fn().mockResolvedValue({ invoices: [] })
    };
    const onOpenBillingUrl = vi.fn().mockResolvedValue(true);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(OrganizationManagementPanel, {
          api: api as never,
          language: 'ja',
          onConfirmRemoveMember: vi.fn(),
          onDownloadUsageCsv: vi.fn(),
          onOpenBillingUrl,
          organization,
          sessionKey: 'session-a'
        })
      );
    });

    const checkoutButton = renderer!.root
      .findAllByType('button')
      .find((node) => node.children.includes('手続きを開く'));
    expect(checkoutButton).toBeDefined();
    await act(async () => {
      checkoutButton?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      '請求画面から戻ると決済情報を確認します'
    );
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('購入完了');

    await act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.getOrganizationBillingSummary).toHaveBeenCalledTimes(1);
    expect(api.getOrganizationInvoices).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      '購入完了をサーバーで確認しました'
    );
  });
});
