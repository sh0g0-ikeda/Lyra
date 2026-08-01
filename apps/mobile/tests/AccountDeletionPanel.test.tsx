import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionPanel } from '../src/components/AccountDeletionPanel';
import type { AccountDeletionPreviewRecord } from '../src/lib/api';

vi.mock('react-native', () => ({
  Pressable: ({ children, disabled, onPress, ...props }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, disabled, onClick: disabled ? undefined : onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: ({ onChangeText, value, ...props }: {
    onChangeText(value: string): void;
    value: string;
  }) => React.createElement('input', {
    ...props,
    onChange: (next: string) => onChangeText(next),
    value,
  }),
  View: 'view',
}));

vi.mock('../src/components/PrimaryButton', () => ({
  PrimaryButton: ({ disabled, label, loading, onPress }: {
    disabled?: boolean;
    label: string;
    loading?: boolean;
    onPress(): void;
  }) => React.createElement('button', {
    accessibilityLabel: label,
    disabled: disabled || loading,
    onClick: onPress,
    onPress,
  }, label),
}));

const preview = {
  active_personal_job_count: 0,
  active_personal_stripe_subscription_count: 1,
  active_store_subscriptions: [{
    auto_renew_enabled: true,
    expires_at: '2026-08-31T00:00:00.000Z',
    manage_url: 'https://apps.apple.com/account/subscriptions',
    store: 'apple' as const,
  }],
  personal_asset_count: 3,
  personal_data: {
    account: 'anonymized' as const,
    billing_records: 'retained_for_legal_and_security' as const,
    organization_memberships: 'removed' as const,
    personal_works: 'deleted' as const,
  },
  unique_owner_organizations: [],
} satisfies AccountDeletionPreviewRecord;

function createApi() {
  return {
    requestAccountDeletion: vi.fn().mockResolvedValue({
      blockers: [],
      status: 'in_progress',
    }),
  };
}

describe('AccountDeletionPanel', () => {
  const renderers: ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      for (const renderer of renderers.splice(0)) renderer.unmount();
    });
  });

  async function renderPanel(
    overrides: Partial<React.ComponentProps<typeof AccountDeletionPanel>> = {},
  ): Promise<ReactTestRenderer> {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <AccountDeletionPanel
          api={createApi()}
          language="ja"
          onCompleted={vi.fn().mockResolvedValue(undefined)}
          onReloadPreview={vi.fn().mockResolvedValue(undefined)}
          preview={preview}
          {...overrides}
        />,
      );
    });
    renderers.push(renderer!);
    return renderer!;
  }

  it('削除影響と全acknowledgementを表示しDELETE入力まで開始不可にする', async () => {
    const api = createApi();
    const renderer = await renderPanel({ api });
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('個人作品と画像は削除されます');
    expect(rendered).toContain('法人workspaceの所属から外れます');
    expect(rendered).toContain('法令・不正防止に必要な請求記録は保持されます');
    expect(rendered).toContain('App Storeの有効な契約');
    const start = renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' });
    expect(start.props.disabled).toBe(true);

    await act(async () => {
      for (const checkbox of renderer.root.findAllByType('button').filter(
        (button) => button.props.accessibilityRole === 'checkbox',
      )) {
        checkbox.props.onClick();
      }
      renderer.root.findByType('input').props.onChange('DELETE');
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.disabled)
      .toBe(false);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.onPress();
    });
    expect(api.requestAccountDeletion).toHaveBeenCalledWith({
      acknowledge_personal_assets: true,
      acknowledge_personal_subscriptions: true,
      acknowledge_store_billing: true,
      confirmation: 'DELETE',
    });
  });

  it('owner組織または実行中jobがある間は削除を開始しない', async () => {
    const api = createApi();
    const onReloadPreview = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel({
      api,
      onReloadPreview,
      preview: {
        ...preview,
        active_personal_job_count: 2,
        unique_owner_organizations: [{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'ベーカー街編集部',
        }],
      },
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('ベーカー街編集部');
    expect(JSON.stringify(renderer.toJSON())).toContain('実行中の個人ジョブ: 2件');
    expect(renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.disabled)
      .toBe(true);
    expect(api.requestAccountDeletion).not.toHaveBeenCalled();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '削除条件を再確認' }).props.onPress();
    });
    expect(onReloadPreview).toHaveBeenCalledOnce();
  });

  it('処理中を明示し再確認でcompletedになった時だけlocal sessionを消す', async () => {
    const api = createApi();
    api.requestAccountDeletion
      .mockResolvedValueOnce({ blockers: [], status: 'in_progress' })
      .mockResolvedValueOnce({ blockers: [], status: 'completed' });
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel({
      api,
      onCompleted,
      preview: {
        ...preview,
        active_personal_stripe_subscription_count: 0,
        active_store_subscriptions: [],
        personal_asset_count: 0,
      },
    });

    await act(async () => {
      renderer.root.findByType('input').props.onChange('DELETE');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('削除処理を実行しています');
    expect(onCompleted).not.toHaveBeenCalled();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '削除処理を再確認' }).props.onPress();
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('連打しても同じ削除要求を二重送信しない', async () => {
    const api = createApi();
    api.requestAccountDeletion.mockImplementation(async () => await new Promise(() => undefined));
    const renderer = await renderPanel({
      api,
      preview: {
        ...preview,
        active_personal_stripe_subscription_count: 0,
        active_store_subscriptions: [],
        personal_asset_count: 0,
      },
    });

    await act(async () => {
      renderer.root.findByType('input').props.onChange('DELETE');
    });
    const start = renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' });
    start.props.onPress();
    start.props.onPress();
    expect(api.requestAccountDeletion).toHaveBeenCalledTimes(1);
  });

  it('外部処理待ちを内部action名を出さずに表示する', async () => {
    const api = createApi();
    api.requestAccountDeletion.mockResolvedValueOnce({
      blockers: [],
      next_action: 'delete_personal_assets',
      status: 'pending_external_action',
    });
    const renderer = await renderPanel({
      api,
      preview: {
        ...preview,
        active_personal_stripe_subscription_count: 0,
        active_store_subscriptions: [],
        personal_asset_count: 0,
      },
    });
    await act(async () => {
      renderer.root.findByType('input').props.onChange('DELETE');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.onPress();
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('個人画像・ファイルを削除しています');
    expect(rendered).not.toContain('delete_personal_assets');
  });

  it('削除完了後のlocal session消去失敗は明示して手動再試行できる', async () => {
    const api = createApi();
    api.requestAccountDeletion.mockResolvedValueOnce({ blockers: [], status: 'completed' });
    const onCompleted = vi.fn()
      .mockRejectedValueOnce(new Error('secure storage detail'))
      .mockResolvedValueOnce(undefined);
    const renderer = await renderPanel({
      api,
      onCompleted,
      preview: {
        ...preview,
        active_personal_stripe_subscription_count: 0,
        active_store_subscriptions: [],
        personal_asset_count: 0,
      },
    });
    await act(async () => {
      renderer.root.findByType('input').props.onChange('DELETE');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'アカウント削除を開始' }).props.onPress();
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('アカウント削除は完了しましたが、端末セッションを消去できませんでした');
    expect(rendered).not.toContain('secure storage detail');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '端末セッションを消去' }).props.onPress();
    });
    expect(onCompleted).toHaveBeenCalledTimes(2);
  });
});
