import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreditBalanceBadge } from '@/components/CreditBalanceBadge';

const mocks = vi.hoisted(() => ({
  useAppState: vi.fn(),
  useQuery: vi.fn(),
  organizationFeaturesEnabled: true
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View'
}));
vi.mock('@/lib/config', () => ({ config: { get organizationFeaturesEnabled() { return mocks.organizationFeaturesEnabled; } } }));
vi.mock('@/state/appState', () => ({ useAppState: mocks.useAppState }));

describe('CreditBalanceBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationFeaturesEnabled = true;
    mocks.useAppState.mockReturnValue({
      api: { getBalance: vi.fn(), getOrganizationCreditBalance: vi.fn() },
      language: 'ja', session: { user: { id: 'user-1' } },
      selection: { organizationId: null }, sessionKey: 'session-1'
    });
    mocks.useQuery.mockReturnValue({ data: { total_credits: 12 }, isPending: false, isError: false });
  });

  it('個人scopeの実残高を表示し、取得失敗時は0と誤表示しない', async () => {
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => { renderer = create(<CreditBalanceBadge />); });
    expect(JSON.stringify(renderer?.toJSON())).toContain('12');
    expect(mocks.useQuery.mock.calls[0]?.[0].queryKey).toEqual(['balance', 'session-1', 'personal']);

    mocks.useQuery.mockReturnValue({ data: undefined, isPending: false, isError: true });
    await act(async () => { renderer?.update(<CreditBalanceBadge />); });
    expect(renderer?.root.findAllByType('Text')[1]?.children).toEqual(['—']);
  });

  it('法人scopeでは法人残高だけを取得する', async () => {
    const api = { getBalance: vi.fn(), getOrganizationCreditBalance: vi.fn().mockResolvedValue({ total_credits: 7 }) };
    mocks.useAppState.mockReturnValue({
      api, language: 'ja', session: { user: { id: 'user-1' } },
      selection: { organizationId: 'org-1' }, sessionKey: 'session-1'
    });
    mocks.useQuery.mockImplementation((options: { queryFn: () => Promise<unknown> }) => {
      void options.queryFn();
      return { data: { total_credits: 7 }, isPending: false, isError: false };
    });
    await act(async () => { create(<CreditBalanceBadge />); });
    expect(api.getOrganizationCreditBalance).toHaveBeenCalledWith('org-1');
    expect(api.getBalance).not.toHaveBeenCalled();
  });
});
