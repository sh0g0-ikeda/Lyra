import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MobileStoreBillingPanel } from '@/components/MobileStoreBillingPanel';

const adapter = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    connected: true,
    error: null,
    lastVerified: null,
    loading: false,
    products: [
      { id: 'lyra.credits.200', kind: 'credit_pack', title: '200 credits', displayPrice: '$2.99', available: true }
    ],
    restoring: false,
    submittingProductId: null
  }),
  purchase: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn().mockReturnValue(() => undefined)
};

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress, disabled, disabledReason }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    disabledReason?: string;
  }) => React.createElement('button', { disabled, disabledReason, onClick: onPress }, label)
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/state/networkStatus', () => ({
  useNetworkStatus: () => ({ language: 'ja', online: true })
}));

describe('MobileStoreBillingPanel', () => {
  it('disables current and scheduled subscriptions without announcing the scheduled plan as active', async () => {
    const state = { ...adapter.getState(), products: [
      { id: 'premium', kind: 'subscription', planCode: 'premium', title: 'Premium', displayPrice: '$10', available: true },
      { id: 'standard', kind: 'subscription', planCode: 'standard', title: 'Standard', displayPrice: '$5', available: true }
    ] };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<MobileStoreBillingPanel adapter={{ ...adapter, getState: () => state } as never} language="en" currentPlan="premium" scheduledPlan="standard" scheduledPlanEffectiveAt="2026-11-01T00:00:00Z" />); });
    const buttons = renderer.root.findAllByType('button');
    expect(buttons[0].children.join('')).toBe('Current plan'); expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[1].children.join('')).toContain('Scheduled'); expect(buttons[1].props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Standard');
  });
  it('日本語で購入と復元を表示し、利用可能な商品だけを購入可能にする', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: adapter as never,
        language: 'ja'
      }));
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual(['購入する', '購入を復元']);
    await act(async () => {
      await buttons[0].props.onClick();
    });
    expect(adapter.purchase).toHaveBeenCalledWith('lyra.credits.200');
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('定期購入は表示された期間ごとに自動更新');
    expect(rendered).toContain('利用規約');
    expect(rendered).toContain('プライバシー');
  });

  it('安全なprovider errorを日英固定メッセージで表示し生の値を漏らさない', async () => {
    adapter.getState.mockReturnValueOnce({
      ...adapter.getState(),
      error: { code: 'NETWORK', retryable: true },
      products: []
    });
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: adapter as never,
        language: 'en'
      }));
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('Store connection failed. Check your connection and try again.');
    expect(rendered).not.toContain('NETWORK');
  });

  it('offers native-catalog retry and recovers from legal-link errors without requesting a purchase', async () => {
    const refreshProducts = vi.fn().mockResolvedValue(undefined); const state = { ...adapter.getState(), products: [], error: { code: 'NETWORK', retryable: true } };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<MobileStoreBillingPanel adapter={{ ...adapter, refreshProducts, getState: () => state } as never} language="en" />); });
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Reload store products')!;
    await act(async () => { retry.props.onClick(); }); expect(refreshProducts).toHaveBeenCalledOnce();
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error('private provider message'));
    await act(async () => { renderer.root.findAllByType('Text').find((node) => node.props.accessibilityRole === 'link')!.props.onPress(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('legal page could not be opened'); expect(JSON.stringify(renderer.toJSON())).not.toContain('private provider message');
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await act(async () => { renderer.update(<MobileStoreBillingPanel adapter={adapter as never} language="en" />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Apple Standard EULA');
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    act(() => renderer.unmount());
  });
  it('does not promote a scheduled downgrade when account refresh fails', async () => {
    const verified = { balance: { monthlyCredits: 100, purchasedCredits: 0 }, entitlement: { plan: 'premium', scheduledPlan: 'standard', scheduledPlanEffectiveAt: '2026-11-01T00:00:00Z' } };
    const state = { ...adapter.getState(), lastVerified: verified, products: [{ id: 'premium', kind: 'subscription', planCode: 'premium', title: 'Premium', displayPrice: '$10', available: true }] };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<MobileStoreBillingPanel adapter={{ ...adapter, getState: () => state } as never} currentPlan="free" language="en" onVerified={async () => { throw new Error('offline'); }} />); });
    expect(renderer.root.findAllByType('button')[0].children.join('')).toBe('Current plan'); expect(JSON.stringify(renderer.toJSON())).toContain('account display could not refresh');
    act(() => renderer.unmount());
  });
  it('server確認済みの残高・権利状態だけを呼び出し元へ通知する', async () => {
    const onVerified = vi.fn();
    const verifiedState = {
      ...adapter.getState(),
      lastVerified: {
        balance: { monthlyCredits: 100, purchasedCredits: 200 },
        entitlement: { plan: 'standard' as const }
      }
    };
    const verifiedAdapter = {
      ...adapter,
      getState: vi.fn().mockReturnValue(verifiedState),
      subscribe: vi.fn((listener) => {
        listener(verifiedState);
        return () => undefined;
      })
    };
    await act(async () => {
      create(React.createElement(MobileStoreBillingPanel, {
        adapter: verifiedAdapter as never,
        language: 'en',
        onVerified
      }));
    });

    expect(onVerified).toHaveBeenCalledWith(verifiedState.lastVerified);
  });
});
