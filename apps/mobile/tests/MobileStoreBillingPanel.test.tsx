import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MobileStoreBillingPanel } from '@/components/MobileStoreBillingPanel';

const adapter = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    connected: true,
    diagnostics: null,
    error: null,
    lastVerified: null,
    loading: false,
    products: [
      { id: 'lyra.credits.200', kind: 'credit_pack', title: '200 credits', displayPrice: '$2.99', available: true }
    ],
    restoring: false,
    subscriptionStatus: null,
    submittingProductId: null
  }),
  purchase: vi.fn().mockResolvedValue(undefined),
  refreshSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn().mockReturnValue(() => undefined)
};

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
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
  it('商品が返らない場合も一時的なStoreKit診断を画面へ表示しない', async () => {
    adapter.getState.mockReturnValueOnce({
      ...adapter.getState(),
      diagnostics: {
        allProducts: {
          errorCode: null,
          requestedProductIds: ['jp.lyra.credits.200', 'jp.lyra.standard.monthly'],
          returnedProductIds: []
        },
        connected: true,
        inApp: {
          errorCode: null,
          requestedProductIds: ['jp.lyra.credits.200'],
          returnedProductIds: []
        },
        storefront: 'JPN',
        storefrontErrorCode: null,
        subscriptions: {
          errorCode: null,
          requestedProductIds: ['jp.lyra.standard.monthly'],
          returnedProductIds: []
        }
      },
      products: [
        {
          available: false,
          displayPrice: null,
          id: 'jp.lyra.credits.200',
          kind: 'credit_pack',
          title: 'Lyra credits 10'
        }
      ]
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: adapter as never,
        currentPlan: 'free',
        language: 'ja'
      }));
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).not.toContain('課金診断');
    expect(rendered).not.toContain('ストアフロント: JPN');
    expect(rendered).toContain('購入を復元');
    expect(rendered).not.toMatch(/token|receipt|account/i);
  });

  it('狭い画面でも商品説明と購入操作を縦に配置して日本語を一文字ずつ折り返さない', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: adapter as never,
        currentPlan: 'free',
        language: 'ja'
      }));
    });

    const productCard = renderer!.root.findAll((node) => {
      const style = node.props.style as { borderWidth?: number; justifyContent?: string } | undefined;
      return style?.borderWidth === 1 && style.justifyContent === 'space-between';
    })[0];

    expect(productCard?.props.style).toMatchObject({
      alignItems: 'stretch',
      flexDirection: 'column'
    });
  });

  it('日本語で購入と復元を表示し、利用可能な商品だけを購入可能にする', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: adapter as never,
        currentPlan: 'free',
        language: 'ja'
      }));
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual(['購入する', '購入を復元']);
    await act(async () => {
      await buttons[0].props.onClick();
    });
    expect(adapter.purchase).toHaveBeenCalledWith('lyra.credits.200');
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
        currentPlan: 'free',
        language: 'en'
      }));
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('Store connection failed. Check your connection and try again.');
    expect(rendered).not.toContain('NETWORK');
  });

  it('server確認済みの残高・権利状態だけを呼び出し元へ通知する', async () => {
    const onVerified = vi.fn();
    const verifiedState = {
      ...adapter.getState(),
      lastVerified: {
        balance: { monthlyCredits: 100, purchasedCredits: 200 },
        entitlement: {
          plan: 'standard' as const,
          currentPeriodEnd: null,
          scheduledPlan: null,
          scheduledPlanEffectiveAt: null,
          store: null
        }
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
        currentPlan: 'free',
        language: 'en',
        onVerified
      }));
    });

    expect(onVerified).toHaveBeenCalledWith(verifiedState.lastVerified);
  });

  it('現在契約中のサブスクは登録済みにして再購入させず単発購入は維持する', async () => {
    const subscriptionAdapter = {
      ...adapter,
      getState: vi.fn().mockReturnValue({
        ...adapter.getState(),
        products: [
          {
            available: true,
            displayPrice: '¥980',
            id: 'jp.lyra.standard.monthly',
            kind: 'subscription',
            planCode: 'standard',
            title: 'スタンダードプラン'
          },
          {
            available: true,
            displayPrice: '¥1,980',
            id: 'jp.lyra.premium.monthly',
            kind: 'subscription',
            planCode: 'premium',
            title: 'プレミアムプラン'
          },
          {
            available: true,
            displayPrice: '¥220',
            id: 'jp.lyra.credits.200',
            kind: 'credit_pack',
            title: '10クレジット追加'
          }
        ]
      })
    };

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: subscriptionAdapter as never,
        currentPlan: 'standard',
        language: 'ja'
      }));
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual([
      '登録済み',
      'プランを変更',
      '購入する',
      '購入を復元'
    ]);
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[1].props.disabled).toBe(false);
    expect(buttons[2].props.disabled).toBe(false);
  });

  it('購入直後は画面再取得前でもserver確認済みプランを優先する', async () => {
    const verifiedState = {
      ...adapter.getState(),
      lastVerified: {
        balance: { monthlyCredits: 50, purchasedCredits: 0 },
        entitlement: {
          plan: 'standard' as const,
          currentPeriodEnd: null,
          scheduledPlan: null,
          scheduledPlanEffectiveAt: null,
          store: null
        }
      },
      products: [
        {
          available: true,
          displayPrice: '¥980',
          id: 'jp.lyra.standard.monthly',
          kind: 'subscription' as const,
          planCode: 'standard' as const,
          title: 'スタンダードプラン'
        }
      ]
    };
    const verifiedAdapter = {
      ...adapter,
      getState: vi.fn().mockReturnValue(verifiedState),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: verifiedAdapter as never,
        currentPlan: 'free',
        language: 'ja'
      }));
    });

    const purchaseButton = renderer!.root.findAllByType('button')[0];
    expect(purchaseButton.children.join('')).toBe('登録済み');
    expect(purchaseButton.props.disabled).toBe(true);
  });

  it('Premium利用中のStandard予約を適用日付きで表示し重複変更を無効にする', async () => {
    const scheduledState = {
      ...adapter.getState(),
      subscriptionStatus: {
        currentProductId: 'jp.lyra.premium.monthly',
        scheduledStateKnown: true,
        scheduledProductId: 'jp.lyra.standard.monthly',
        scheduledEffectiveAt: '2026-08-26T00:00:00.000Z'
      },
      products: [
        {
          available: true,
          displayPrice: '¥980',
          id: 'jp.lyra.standard.monthly',
          kind: 'subscription' as const,
          planCode: 'standard' as const,
          title: 'スタンダードプラン'
        },
        {
          available: true,
          displayPrice: '¥1,980',
          id: 'jp.lyra.premium.monthly',
          kind: 'subscription' as const,
          planCode: 'premium' as const,
          title: 'プレミアムプラン'
        }
      ]
    };
    const scheduledAdapter = {
      ...adapter,
      getState: vi.fn().mockReturnValue(scheduledState),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: scheduledAdapter as never,
        currentPlan: 'premium',
        language: 'ja'
      }));
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual([
      '2026年8月26日から変更予定',
      '登録済み',
      '購入を復元'
    ]);
    expect(buttons[0].props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain('次回更新からスタンダードプランに変更されます。');
  });

  it('StoreKitで変更予約が取り消された場合は古いserver予約表示を残さない', async () => {
    const currentState = {
      ...adapter.getState(),
      subscriptionStatus: {
        currentProductId: 'jp.lyra.premium.monthly',
        scheduledStateKnown: true,
        scheduledProductId: null,
        scheduledEffectiveAt: null
      },
      products: [
        {
          available: true,
          displayPrice: '¥980',
          id: 'jp.lyra.standard.monthly',
          kind: 'subscription' as const,
          planCode: 'standard' as const,
          title: 'スタンダードプラン'
        },
        {
          available: true,
          displayPrice: '¥1,980',
          id: 'jp.lyra.premium.monthly',
          kind: 'subscription' as const,
          planCode: 'premium' as const,
          title: 'プレミアムプラン'
        }
      ]
    };
    const currentAdapter = {
      ...adapter,
      getState: vi.fn().mockReturnValue(currentState),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(MobileStoreBillingPanel, {
        adapter: currentAdapter as never,
        currentPlan: 'premium',
        language: 'ja',
        scheduledPlan: 'standard',
        scheduledPlanEffectiveAt: '2026-08-26T00:00:00.000Z'
      }));
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual([
      'プランを変更',
      '登録済み',
      '購入を復元'
    ]);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('次回更新からスタンダードプランに変更されます。');
  });
});
