import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileStoreBillingPanel } from '../src/components/MobileStoreBillingPanel';
import type {
  NativeStoreBillingAdapter,
  NativeStoreBillingState,
} from '../src/lib/nativeStoreBilling';

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity',
  Pressable: ({ children, disabled, onPress, ...props }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, disabled, onClick: onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view',
}));

const defaultState: NativeStoreBillingState = {
  connected: true,
  error: null,
  lastVerified: null,
  loading: false,
  products: [
    {
      available: true,
      displayPrice: '￥1,200',
      id: 'lyra.credits.200',
      kind: 'credit_pack',
      title: '200クレジット',
    },
    {
      available: false,
      displayPrice: null,
      id: 'lyra.standard.monthly',
      kind: 'subscription',
      title: 'Standard',
    },
  ],
  restoring: false,
  submittingProductId: null,
};

function createAdapter(state: NativeStoreBillingState = defaultState): NativeStoreBillingAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(state),
    purchase: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn((listener) => {
      listener(state);
      return () => undefined;
    }),
  };
}

describe('MobileStoreBillingPanel', () => {
  const renderers: ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      for (const renderer of renderers.splice(0)) renderer.unmount();
    });
  });

  const renderPanel = async (adapter: NativeStoreBillingAdapter): Promise<ReactTestRenderer> => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<MobileStoreBillingPanel adapter={adapter} language="ja" />);
    });
    renderers.push(renderer!);
    return renderer!;
  };

  it('store提供価格だけを表示し未反映商品を購入不可にする', async () => {
    const adapter = createAdapter();
    const renderer = await renderPanel(adapter);
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('￥1,200');
    expect(rendered).not.toContain('¥980');
    expect(rendered).toContain('この商品はストアでまだ利用できません。');
    const purchaseButtons = renderer.root.findAllByType('button').filter(
      (button) => button.findAllByType('text').some((text) => text.children.includes('購入する')),
    );
    expect(purchaseButtons).toHaveLength(2);
    expect(purchaseButtons[0]?.props.disabled).toBe(false);
    expect(purchaseButtons[1]?.props.disabled).toBe(true);
  });

  it('pending・cancel・networkをraw codeなしの安全な文言にする', async () => {
    for (const [code, expected] of [
      ['PURCHASE_PENDING', '購入は保留中です。ストアで完了すると反映されます。'],
      ['PURCHASE_CANCELLED', '購入はキャンセルされました。料金は発生していません。'],
      ['NETWORK', 'ストアに接続できません。通信環境を確認して再試行してください。'],
    ] as const) {
      const renderer = await renderPanel(createAdapter({
        ...defaultState,
        connected: code !== 'NETWORK',
        error: Object.assign(new Error(code), {
          code,
          retryable: code === 'NETWORK',
        }) as NativeStoreBillingState['error'],
      }));
      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toContain(expected);
      expect(rendered).not.toContain(code);
    }
  });

  it('購入・復元・接続再試行をユーザー操作でだけ実行する', async () => {
    const state = {
      ...defaultState,
      connected: false,
      error: Object.assign(new Error('NETWORK'), { code: 'NETWORK', retryable: true }),
    } satisfies NativeStoreBillingState;
    const adapter = createAdapter(state);
    const renderer = await renderPanel(adapter);

    await act(async () => {
      const reconnectButton = renderer.root.findAllByType('button').find(
        (button) => button.findAllByType('text').some(
          (text) => text.children.includes('ストアへ再接続'),
        ),
      );
      reconnectButton?.props.onClick();
    });
    expect(adapter.connect).toHaveBeenCalledTimes(2);
  });

  it('server確認済みstateだけを残高更新callbackへ渡す', async () => {
    const onVerified = vi.fn();
    const verified = {
      balance: { monthlyCredits: 10, purchasedCredits: 20 },
      entitlement: { plan: 'standard' as const },
    };
    const adapter = createAdapter({ ...defaultState, lastVerified: verified });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MobileStoreBillingPanel
          adapter={adapter}
          language="ja"
          onVerified={onVerified}
        />,
      );
    });
    renderers.push(renderer!);

    expect(onVerified).toHaveBeenCalledWith(verified);
  });

  it('同じ確認済みstateでcallbackが差し替わっても残高更新を再実行しない', async () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const verified = {
      balance: { monthlyCredits: 10, purchasedCredits: 20 },
      entitlement: { plan: 'standard' as const },
    };
    const adapter = createAdapter({ ...defaultState, lastVerified: verified });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MobileStoreBillingPanel
          adapter={adapter}
          language="ja"
          onVerified={firstCallback}
        />,
      );
    });
    renderers.push(renderer!);

    await act(async () => {
      renderer!.update(
        <MobileStoreBillingPanel
          adapter={adapter}
          language="ja"
          onVerified={secondCallback}
        />,
      );
    });

    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
  });
});
