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
    submittingProductId: null
  }),
  purchase: vi.fn().mockResolvedValue(undefined),
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
