import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountScreen } from '../src/screens/AccountScreen';
import { ApiError } from '../src/lib/api';

vi.mock('react-native', () => ({
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, onClick: onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view',
}));

vi.mock('../src/components/LoadingState', () => ({
  LoadingState: ({ label }: { label: string }) => React.createElement('loading', null, label),
}));

vi.mock('../src/components/Notice', () => ({
  Notice: ({ message, tone }: { message: string; tone?: string }) =>
    React.createElement('notice', { tone }, message),
}));

vi.mock('../src/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    loading,
    onPress,
  }: {
    label: string;
    loading?: boolean;
    onPress: () => void;
  }) => React.createElement('button', { disabled: loading, onClick: onPress }, label),
}));

const session = {
  user: {
    id: 'user-1',
    email: 'user@example.com',
    display_name: 'ホームズ',
    plan_code: 'free',
  },
  personal_credits: {
    monthly_credits: 0,
    purchased_credits: 0,
    total_credits: 0,
    monthly_expires_at: null,
  },
  organizations: [
    {
      id: 'organization-1',
      name: 'ベーカー街編集部',
      status: 'active' as const,
      plan_key: 'enterprise_a' as const,
      role: 'owner' as const,
      membership_status: 'active' as const,
      monthly_credits: 100,
      purchased_credits: 20,
      total_credits: 120,
      monthly_expires_at: null,
    },
    {
      id: 'organization-invited',
      name: '招待中の編集部',
      status: 'active' as const,
      plan_key: 'enterprise_a' as const,
      role: 'viewer' as const,
      membership_status: 'invited' as const,
      monthly_credits: 0,
      purchased_credits: 0,
      total_credits: 0,
      monthly_expires_at: null,
    },
    {
      id: 'organization-suspended',
      name: '停止中の編集部',
      status: 'suspended' as const,
      plan_key: 'enterprise_a' as const,
      role: 'viewer' as const,
      membership_status: 'suspended' as const,
      monthly_credits: 0,
      purchased_credits: 0,
      total_credits: 0,
      monthly_expires_at: null,
    },
  ],
};

const flushQueries = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('AccountScreen', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = {
    getJobs: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getJobs.mockResolvedValue({ jobs: [], next_cursor: null });
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  const renderScreen = async ({
    initialOrganizationId = null,
    withWorkspaceState = false,
  }: {
    initialOrganizationId?: string | null;
    withWorkspaceState?: boolean;
  } = {}): Promise<ReactTestRenderer> => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const screen = withWorkspaceState ? (
      <WorkspaceHarness initialOrganizationId={initialOrganizationId} />
    ) : (
      <AccountScreen
        api={api}
        language="ja"
        onOrganizationChange={vi.fn()}
        organizationId={initialOrganizationId}
        session={session}
      />
    );
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          {screen}
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await flushQueries();
    });
    mountedRenderers.push(renderer!);
    return renderer!;
  };

  function WorkspaceHarness({
    initialOrganizationId,
  }: {
    initialOrganizationId: string | null;
  }): React.JSX.Element {
    const [organizationId, setOrganizationId] = useState(initialOrganizationId);
    return (
      <AccountScreen
        api={api}
        language="ja"
        onOrganizationChange={setOrganizationId}
        organizationId={organizationId}
        session={session}
      />
    );
  }

  it('正常なプロフィール・残高・ジョブ0件ではempty stateだけを表示する', async () => {
    const renderer = await renderScreen();
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('user@example.com');
    expect(rendered).toContain('表示できるジョブはありません。');
    expect(rendered).not.toContain('一時的に処理できません');
    expect(rendered).not.toContain('対象データが見つかりませんでした');
    expect(rendered).not.toContain('招待中の編集部');
    expect(rendered).not.toContain('停止中の編集部');
    expect(renderer.root.findAllByProps({ tone: 'danger' })).toHaveLength(0);
    expect(api.getJobs).toHaveBeenCalledWith({ limit: 25 }, null);
  });

  it('ジョブ履歴の実エラーではempty stateを併記せず再試行を表示する', async () => {
    api.getJobs.mockRejectedValue(new ApiError('REQUEST_FAILED', 503, 'provider detail'));

    const renderer = await renderScreen();
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('ジョブ履歴を読み込めませんでした。');
    expect(rendered).toContain('ジョブ履歴を再試行');
    expect(rendered).not.toContain('表示できるジョブはありません。');
    expect(rendered).not.toContain('provider detail');
  });

  it('一覧endpointの404をジョブ0件や対象消失の文言へ読み替えない', async () => {
    api.getJobs.mockRejectedValue(new ApiError('NOT_FOUND', 404, 'route detail'));

    const renderer = await renderScreen();
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('ジョブ履歴を読み込めませんでした。');
    expect(rendered).toContain('ジョブ履歴を再試行');
    expect(rendered).not.toContain('表示できるジョブはありません。');
    expect(rendered).not.toContain('対象データが見つかりませんでした');
    expect(rendered).not.toContain('route detail');
  });

  it('ジョブ履歴の再取得成功後は古いerrorを消してempty stateへ遷移する', async () => {
    let resolveJobs: ((value: { jobs: never[]; next_cursor: null }) => void) | undefined;
    const retryResult = new Promise<{ jobs: never[]; next_cursor: null }>((resolve) => {
      resolveJobs = resolve;
    });
    api.getJobs
      .mockRejectedValueOnce(new ApiError('REQUEST_FAILED', 503, 'provider detail'))
      .mockReturnValueOnce(retryResult);
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ジョブ履歴を再試行' }).props.onPress();
      await flushQueries();
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ジョブ履歴を読み込めませんでした。');

    await act(async () => {
      resolveJobs?.({ jobs: [], next_cursor: null });
      await flushQueries();
    });
    const rendered = JSON.stringify(renderer.toJSON());

    expect(api.getJobs).toHaveBeenCalledTimes(2);
    expect(rendered).toContain('表示できるジョブはありません。');
    expect(rendered).not.toContain('ジョブ履歴を読み込めませんでした。');
  });

  it('personalのerrorをorganization workspaceへ持ち越さない', async () => {
    api.getJobs.mockImplementation(async (_input, organizationId: string | null) => {
      if (organizationId === null) {
        throw new ApiError('REQUEST_FAILED', 503, 'personal failure');
      }
      return { jobs: [], next_cursor: null };
    });
    const renderer = await renderScreen({ withWorkspaceState: true });
    expect(JSON.stringify(renderer.toJSON())).toContain('ジョブ履歴を読み込めませんでした。');

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ベーカー街編集部に切り替え' }).props.onPress();
      await flushQueries();
    });
    await act(async () => {
      await flushQueries();
    });
    const rendered = JSON.stringify(renderer.toJSON());

    expect(api.getJobs).toHaveBeenLastCalledWith({ limit: 25 }, 'organization-1');
    expect(rendered).toContain('表示できるジョブはありません。');
    expect(rendered).not.toContain('ジョブ履歴を読み込めませんでした。');
  });

});
