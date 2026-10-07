import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreditBalanceBadge } from '@/components/CreditBalanceBadge';

const mocks = vi.hoisted(() => ({
  getBalance: vi.fn(), getOrganizationWorkspace: vi.fn(), online: true,
  organizationFeaturesEnabled: true,
  state: { language: 'en', sessionKey: 'user-one', selection: { organizationId: null as string | null }, session: { organizations: [{ id: 'org-a', name: 'Studio', membership_status: 'active', role: 'viewer' }] } },
  onForeground: undefined as undefined | ((state: string) => void)
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: (_event: string, callback: (state: string) => void) => { mocks.onForeground = callback; return { remove: vi.fn() }; } },
  Pressable: 'pressable', StyleSheet: { create: (style: unknown) => style }, Text: 'text', View: 'view'
}));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ ...mocks.state, api: mocks }) }));
vi.mock('@/state/networkStatus', () => ({ useNetworkStatus: () => ({ online: mocks.online }) }));
vi.mock('@/lib/config', () => ({ config: mocks }));

let renderer: ReactTestRenderer;
const render = async (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })): Promise<QueryClient> => {
  await act(async () => { renderer = create(<QueryClientProvider client={client}><CreditBalanceBadge /></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  return client;
};
const text = (): string => JSON.stringify(renderer.toJSON());

describe('CreditBalanceBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true; mocks.organizationFeaturesEnabled = true;
    mocks.state.selection.organizationId = null; mocks.state.language = 'en';
    mocks.getBalance.mockResolvedValue({ total_credits: 127 });
    mocks.getOrganizationWorkspace.mockResolvedValue({ balance: { total_credits: 42 } });
  });

  it('個人残高をserverから表示し、org切替中に前scopeの数字を表示しない', async () => {
    const client = await render();
    expect(text()).toContain('127');
    expect(mocks.getBalance).toHaveBeenCalledOnce();
    mocks.state.selection.organizationId = 'org-a';
    let finish: (value: unknown) => void = () => undefined;
    mocks.getOrganizationWorkspace.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { renderer.update(<QueryClientProvider client={client}><CreditBalanceBadge /></QueryClientProvider>); });
    expect(text()).not.toContain('127');
    expect(text()).toContain('Loading');
    await act(async () => { finish({ balance: { total_credits: 42 } }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(text()).toContain('42');
    expect(text()).toContain('Studio');
    expect(mocks.getOrganizationWorkspace).toHaveBeenCalledWith('org-a');
    act(() => renderer.unmount()); client.clear();
  });

  it('読込失敗は0ではなく安全なerrorと再試行を出す', async () => {
    mocks.getBalance.mockRejectedValue(new Error('private provider details'));
    const client = await render();
    expect(text()).toContain('Could not load');
    expect(text()).not.toContain('private provider');
    expect(text()).not.toContain('Credits: 0');
    mocks.getBalance.mockResolvedValue({ total_credits: 0 });
    await act(async () => { renderer.root.findByProps({ testID: 'credit-balance-retry' }).props.onPress(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(text()).toContain('Credits: 0');
    act(() => renderer.unmount()); client.clear();
  });

  it('回収保留中は不足クレジット数と有料生成保留を表示し、残高表示は維持する', async () => {
    mocks.getBalance.mockResolvedValue({ total_credits: 127, paid_generation_blocked: true, recovery_credits_due: 9 });
    const client = await render();
    expect(text()).toContain('127');
    expect(text()).toContain('9');
    expect(text()).toContain('Paid generation is paused');
    act(() => renderer.unmount()); client.clear();
  });

  it('無効な組織で個人残高にfallbackせず、feature offの時だけ個人scopeを使う', async () => {
    mocks.state.selection.organizationId = 'unknown';
    const client = await render();
    expect(mocks.getBalance).not.toHaveBeenCalled();
    expect(mocks.getOrganizationWorkspace).not.toHaveBeenCalled();
    expect(text()).toContain('Unavailable');
    mocks.organizationFeaturesEnabled = false;
    await act(async () => { renderer.update(<QueryClientProvider client={client}><CreditBalanceBadge /></QueryClientProvider>); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(mocks.getBalance).toHaveBeenCalledOnce();
    expect(text()).toContain('127');
    act(() => renderer.unmount()); client.clear();
  });

  it('offlineはcacheを現在の実残高と表示せず、foreground復帰で再取得する', async () => {
    const client = await render();
    mocks.online = false;
    act(() => { renderer.update(<QueryClientProvider client={client}><CreditBalanceBadge /></QueryClientProvider>); });
    expect(text()).toContain('Offline');
    expect(text()).not.toContain('127');
    mocks.online = true;
    mocks.getBalance.mockResolvedValue({ total_credits: 12 });
    await act(async () => { mocks.onForeground?.('active'); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(text()).toContain('12');
    act(() => renderer.unmount()); client.clear();
  });
});
