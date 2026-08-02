import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { AccountScreen } from '@/screens/AccountScreen';

const mocks = vi.hoisted(() => ({
  config: {
    accountDeletionEnabled: true,
    mobileStoreBillingEnabled: true,
    organizationFeaturesEnabled: true
  },
  organizationPanel: vi.fn(),
  openUrl: vi.fn(),
  setSession: vi.fn(),
  updateSelection: vi.fn().mockResolvedValue(undefined),
  useAppState: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn()
  }
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: mocks.useInfiniteQuery,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: () => mocks.queryClient
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Linking: { canOpenURL: vi.fn().mockResolvedValue(true), openURL: mocks.openUrl },
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? React.createElement('modal', null, children) : null,
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}));

vi.mock('@react-navigation/native', () => ({ useFocusEffect: vi.fn() }));
vi.mock('@/lib/config', () => ({ config: mocks.config }));
vi.mock('@/lib/download', () => ({ downloadAuthenticatedFile: vi.fn() }));
vi.mock('@/lib/i18n', () => ({
  t: (_language: string, key: string) => ({
    'generated.screens.AccountScreen.create.organization.2c93e462': 'Create organization',
    'generated.screens.AccountScreen.organization.name.74237aeb': 'Organization name'
  })[key] ?? key
}));
vi.mock('@/lib/queryKeys', () => ({
  balanceQueryKey: () => ['balance'],
  jobsQueryKey: () => ['jobs'],
  sessionQueryKey: () => ['session']
}));
vi.mock('@/lib/confirm', () => ({ confirmAction: vi.fn() }));
vi.mock('@/lib/userMessages', () => ({ userErrorMessage: () => 'Request failed' }));
vi.mock('@/lib/mobileStoreBillingBridge', () => ({ createMobileStoreBillingBackend: vi.fn(), toNativeStoreProductDefinitions: vi.fn() }));
vi.mock('@/lib/nativeStoreBilling', () => ({ createExpoIapSdk: vi.fn(), createNativeStoreBillingAdapter: vi.fn() }));
vi.mock('@/state/appState', () => ({ useAppState: mocks.useAppState }));

vi.mock('@/components/FormField', () => ({
  FormField: ({ label, value, onChangeText, maxLength }: { label: string; value: string; onChangeText: (value: string) => void; maxLength?: number }) =>
    React.createElement('input', { 'aria-label': label, maxLength, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value), value })
}));
vi.mock('@/components/JobStatusCard', () => ({ JobStatusCard: () => null }));
vi.mock('@/components/MobileStoreBillingPanel', () => ({ MobileStoreBillingPanel: () => null }));
vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) =>
    React.createElement('notice', props)
}));
vi.mock('@/components/OrganizationManagementPanel', () => ({
  OrganizationManagementPanel: (props: unknown) => {
    mocks.organizationPanel(props);
    return React.createElement('organization-panel');
  }
}));
vi.mock('@/components/PersonalBillingSummary', () => ({ PersonalBillingSummary: () => null }));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) =>
    React.createElement('button', { disabled, onClick: onPress }, label)
}));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: () => null }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => React.createElement('screen', null, children) }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: () => null }));

const organization = {
  id: '11111111-1111-4111-8111-111111111111',
  membership_status: 'active',
  monthly_credits: 0,
  monthly_expires_at: null,
  name: 'Stored organization',
  plan_key: 'enterprise_a',
  purchased_credits: 0,
  role: 'owner' as const,
  status: 'active',
  total_credits: 0
};

const createdWorkspace = {
  organization: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Created organization'
  },
  membership: { role: 'owner' as const },
  balance: null
};

const refreshedSession = {
  user: { id: 'user-1', email: 'user@example.test', display_name: null, plan_code: 'free' },
  personal_credits: null,
  organizations: [{ ...organization, id: createdWorkspace.organization.id, name: createdWorkspace.organization.name }]
};

describe('AccountScreen organization feature guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.accountDeletionEnabled = true;
    mocks.config.mobileStoreBillingEnabled = true;
    mocks.config.organizationFeaturesEnabled = true;
    mocks.useMutation.mockImplementation((options: {
      mutationFn: () => Promise<unknown>;
      onSuccess?: (result: unknown) => void | Promise<void>;
    }) => ({
      isError: false,
      isPending: false,
      mutateAsync: vi.fn(async () => {
        const result = await options.mutationFn();
        await options.onSuccess?.(result);
        return result;
      })
    }));
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pages: [{ jobs: [], next_cursor: null }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      refetch: vi.fn().mockResolvedValue(undefined)
    });
    mocks.useQuery.mockImplementation((options: { queryKey: readonly string[] }) => {
      if (options.queryKey[0] === 'balance') {
        return { data: { cancel_at_period_end: false, current_period_end: null, monthly_credits: 0, monthly_expires_at: null, plan_code: 'free', purchased_credits: 0, total_credits: 0 }, isError: false, isFetching: false, isLoading: false };
      }
      return { data: undefined, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() };
    });
  });

  it('updates the session and opens the new workspace with an empty production selection after creation', async () => {
    const api = {
      createOrganization: vi.fn().mockResolvedValue(createdWorkspace),
      getCurrentSession: vi.fn().mockResolvedValue(refreshedSession)
    };
    mocks.useAppState.mockReturnValue({
      api,
      language: 'en',
      logout: vi.fn(),
      selection: { organizationId: null },
      session: { ...refreshedSession, organizations: [] },
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: mocks.setSession,
      updateSelection: mocks.updateSelection
    });
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AccountScreen));
    });
    const input = renderer!.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Organization name');
    expect(input).toBeDefined();
    expect(input?.props.maxLength).toBe(120);
    act(() => input?.props.onChange({ target: { value: 'Created organization' } }));
    const button = renderer!.root.findAllByType('button').find((node) => node.children.includes('Create organization'));
    expect(button).toBeDefined();
    await act(async () => {
      button?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createOrganization).toHaveBeenCalledWith({ name: 'Created organization' });
    expect(api.getCurrentSession).toHaveBeenCalledOnce();
    expect(mocks.setSession).toHaveBeenCalledWith(refreshedSession);
    expect(mocks.updateSelection).toHaveBeenCalledWith({
      organizationId: createdWorkspace.organization.id,
      workId: null,
      chapterId: null,
      episodeId: null,
      pageId: null,
      entityId: null
    });
  });

  it('clears stale organization selection and renders no organization management consumer when disabled', async () => {
    mocks.config.organizationFeaturesEnabled = false;
    const api = {
      getBalance: vi.fn(),
      getOrganizationWorkspace: vi.fn(),
      listJobs: vi.fn()
    };
    mocks.useAppState.mockReturnValue({
      api,
      language: 'en',
      logout: vi.fn(),
      selection: { organizationId: organization.id, workId: 'work-1', chapterId: 'chapter-1', episodeId: 'episode-1', pageId: 'page-1', entityId: 'entity-1' },
      session: { ...refreshedSession, organizations: [organization] },
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: vi.fn(),
      updateSelection: mocks.updateSelection
    });
    await act(async () => {
      create(React.createElement(AccountScreen));
      await Promise.resolve();
    });
    expect(mocks.organizationPanel).not.toHaveBeenCalled();
    expect(api.getOrganizationWorkspace).not.toHaveBeenCalled();
    expect(mocks.updateSelection).toHaveBeenCalledWith({
      organizationId: null,
      workId: null,
      chapterId: null,
      episodeId: null,
      pageId: null,
      entityId: null
    }, { skipDirtyCheck: true });
  });

  it('organization管理ではnative外部決済actionを必ず無効化する', async () => {
    mocks.useAppState.mockReturnValue({
      api: {},
      language: 'ja',
      logout: vi.fn(),
      selection: { organizationId: organization.id },
      session: { ...refreshedSession, organizations: [organization] },
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: vi.fn(),
      tokens: null,
      updateSelection: mocks.updateSelection,
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AccountScreen));
    });
    const openManagement = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes(
        'generated.screens.AccountScreen.open.organization.management.ea1b51b0'
      ));
    act(() => openManagement?.props.onClick());

    expect(mocks.organizationPanel).toHaveBeenCalledWith(
      expect.objectContaining({ allowExternalBillingActions: false })
    );
  });

  it('課金とアカウント削除のflagがOFFならcatalogを取得せず削除UIを露出しない', async () => {
    mocks.config.mobileStoreBillingEnabled = false;
    mocks.config.accountDeletionEnabled = false;
    const api = {
      getBalance: vi.fn(),
      listJobs: vi.fn()
    };
    mocks.useAppState.mockReturnValue({
      api,
      language: 'ja',
      logout: vi.fn(),
      selection: { organizationId: null },
      session: refreshedSession,
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: vi.fn(),
      tokens: null,
      updateSelection: mocks.updateSelection
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AccountScreen));
    });

    const catalogQuery = mocks.useQuery.mock.calls
      .map(([options]) => options as { enabled?: boolean; queryKey?: readonly string[] })
      .find((options) => options.queryKey?.[0] === 'mobile-store-product-catalog');
    expect(catalogQuery?.enabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(
      'generated.screens.AccountScreen.delete.account.88a30568'
    );
  });

  it('一時的なbalance取得エラーを赤いアクション通知として表示しない', async () => {
    const balanceError = new ApiError('provider detail', 403, 'FORBIDDEN');
    mocks.useQuery.mockImplementation((options: { queryKey: readonly string[] }) => {
      if (options.queryKey[0] === 'balance') {
        return {
          data: undefined,
          error: balanceError,
          isError: true,
          isFetching: false,
          isLoading: false,
          refetch: vi.fn()
        };
      }
      return {
        data: undefined,
        error: null,
        isError: false,
        isFetching: false,
        isLoading: false,
        refetch: vi.fn()
      };
    });
    mocks.useAppState.mockReturnValue({
      api: {},
      language: 'en',
      logout: vi.fn(),
      selection: { organizationId: null },
      session: refreshedSession,
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: vi.fn(),
      tokens: null,
      updateSelection: mocks.updateSelection
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AccountScreen));
    });
    const actionableNotices = renderer!.root
      .findAllByType('notice')
      .filter((notice) => typeof notice.props.onAction === 'function');

    expect(actionableNotices).toHaveLength(0);
    expect(mocks.updateSelection).not.toHaveBeenCalled();
  });

  it('唯一のorganization ownerはWebではなくアプリ内管理画面へ移動する', async () => {
    mocks.useQuery.mockImplementation((options: { queryKey: readonly string[] }) => {
      if (options.queryKey[0] === 'balance') {
        return { data: null, isError: false, isFetching: false, isLoading: false };
      }
      if (options.queryKey[0] === 'account') {
        return {
          data: {
            active_personal_job_count: 0,
            active_personal_stripe_subscription_count: 0,
            active_store_subscriptions: [],
            personal_asset_count: 0,
            unique_owner_organizations: [{ id: organization.id, name: organization.name }]
          },
          isError: false,
          isFetching: false,
          isLoading: false,
          refetch: vi.fn()
        };
      }
      return { data: undefined, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() };
    });
    mocks.useAppState.mockReturnValue({
      api: {},
      language: 'en',
      logout: vi.fn(),
      selection: { organizationId: null },
      session: { ...refreshedSession, organizations: [organization] },
      sessionKey: 'user-1',
      setLanguage: vi.fn(),
      setSession: vi.fn(),
      tokens: null,
      updateSelection: mocks.updateSelection
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AccountScreen));
    });
    const openManagement = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes(
        'generated.screens.AccountScreen.open.organization.management.55d03f28'
      ));
    await act(async () => {
      await openManagement?.props.onClick();
    });

    expect(mocks.updateSelection).toHaveBeenCalledWith({
      organizationId: organization.id,
      workId: null,
      chapterId: null,
      episodeId: null,
      pageId: null,
      entityId: null
    });
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
