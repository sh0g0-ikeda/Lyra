import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { SessionBootstrapRecovery } from '@/components/SessionBootstrapRecovery';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/LoadingState', () => ({
  LoadingState: ({ label }: { label: string }) => React.createElement('loading', { label })
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message, tone }: { message: string; tone: string }) => React.createElement('notice', { message, tone })
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, loading, onPress }: { label: string; loading?: boolean; onPress: () => void }) =>
    React.createElement('button', { label, loading, onClick: onPress }, label)
}));

describe('SessionBootstrapRecovery', () => {
  const render = async (overrides: Partial<React.ComponentProps<typeof SessionBootstrapRecovery>> = {}) => {
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(
        <SessionBootstrapRecovery
          error={null}
          isFetching={false}
          isLoading={false}
          language="en"
          onRetry={vi.fn().mockResolvedValue(undefined)}
          onSignInAgain={vi.fn().mockResolvedValue(undefined)}
          session={{ organizations: [], personal_credits: null, user: { id: 'user-1', email: 'user@example.test', display_name: null, plan_code: 'free' } }}
          {...overrides}
        />
      );
    });
    return tree!;
  };

  it('loading 中はアカウント読込状態を表示する', async () => {
    const tree = await render({ isLoading: true });

    expect(tree.root.findByType('loading').props.label).toBe('Loading account...');
  });

  it('401 は既存の refresh 後に再ログイン導線だけを表示する', async () => {
    const onSignInAgain = vi.fn().mockResolvedValue(undefined);
    const tree = await render({
      error: new ApiError('raw provider detail', 401, 'UNAUTHORIZED'),
      onSignInAgain,
      session: undefined
    });

    expect(tree.root.findAllByType('button').map((button) => button.props.label)).toEqual(['Sign in again']);
    expect(tree.root.findAllByType('notice').map((notice) => notice.props.message).join(' ')).not.toContain('raw provider detail');

    await act(async () => {
      tree.root.findByType('button').props.onClick();
    });
    expect(onSignInAgain).toHaveBeenCalledOnce();
  });

  it.each([
    new TypeError('Network request failed'),
    new ApiError('gateway body', 503, 'SERVICE_UNAVAILABLE'),
    new ApiError('offline body', 0, 'NETWORK_OFFLINE')
  ])('network または 5xx は token 維持を説明して Retry する', async (error) => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const tree = await render({ error, onRetry, session: undefined });

    const notices = tree.root.findAllByType('notice').map((notice) => notice.props.message).join(' ');
    expect(notices).toContain('sign-in is being kept');
    expect(tree.root.findAllByType('button').map((button) => button.props.label)).toEqual(['Retry', 'Log out']);

    await act(async () => {
      tree.root.findAllByType('button')[0]!.props.onClick();
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('403 は account 又は workspace の permission 説明と再試行を表示する', async () => {
    const tree = await render({
      error: new ApiError('raw forbidden reason', 403, 'FORBIDDEN'),
      session: undefined
    });

    const notices = tree.root.findAllByType('notice').map((notice) => notice.props.message).join(' ');
    expect(notices).toContain('permission may have changed');
    expect(tree.root.findAllByType('button').map((button) => button.props.label)).toEqual(['Retry', 'Log out']);
  });

  it('empty account は空状態と Retry を表示する', async () => {
    const tree = await render({ session: undefined });

    expect(tree.root.findAllByType('notice').map((notice) => notice.props.message)).toEqual([
      'Account data is empty. Retry loading it.'
    ]);
    expect(tree.root.findAllByType('button').map((button) => button.props.label)).toEqual(['Retry']);
  });
});
