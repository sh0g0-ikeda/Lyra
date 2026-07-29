import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitationScreen } from '@/screens/InvitationScreen';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  query: {
    data: undefined as unknown,
    error: null as unknown,
    isError: false,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined)
  },
  mutation: {
    error: null as unknown,
    isError: false,
    isPending: false,
    mutate: vi.fn()
  }
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => mocks.mutation,
  useQuery: () => mocks.query
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/LoadingState', () => ({
  LoadingState: () => React.createElement('loading')
}));

vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) =>
    React.createElement('notice', props)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement('button', props)
}));

vi.mock('@/components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('screen', null, children)
}));

vi.mock('@/components/Section', () => ({
  Section: ({ children }: { children: React.ReactNode }) =>
    React.createElement('section', null, children)
}));

vi.mock('@/lib/i18n', () => ({
  t: (_language: string, key: string) => key
}));

vi.mock('@/lib/userMessages', () => ({
  userErrorMessage: () => 'safe invitation error'
}));

vi.mock('@/state/appState', () => ({
  useAppState: () => ({
    api: {},
    language: 'ja',
    session: {
      user: {
        email: 'reader@example.test'
      }
    }
  })
}));

const preview = {
  invitation: {
    email: 'reader@example.test',
    expires_at: '2099-07-25T00:00:00.000Z',
    role: 'editor',
    status: 'pending'
  },
  organization: {
    name: 'Lyra Studio'
  }
};

function renderScreen(input: {
  onDismiss?: () => Promise<void>;
  onSwitchAccount?: () => Promise<void>;
} = {}): ReturnType<typeof create> {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <InvitationScreen
        onAccepted={mocks.accept}
        onDismiss={input.onDismiss ?? vi.fn().mockResolvedValue(undefined)}
        onSwitchAccount={
          input.onSwitchAccount ?? vi.fn().mockResolvedValue(undefined)
        }
        token="opaque-invitation-token"
      />
    );
  });
  return renderer!;
}

describe('InvitationScreen recovery actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.data = undefined;
    mocks.query.error = null;
    mocks.query.isError = false;
    mocks.query.isLoading = false;
    mocks.mutation.error = null;
    mocks.mutation.isError = false;
    mocks.mutation.isPending = false;
  });

  it('preview取得失敗の再試行ボタンでpreview queryを再取得する', () => {
    mocks.query.error = new ApiError('provider detail', 503, 'SERVICE_UNAVAILABLE');
    mocks.query.isError = true;
    const renderer = renderScreen();
    const actionable = renderer.root
      .findAllByType('notice')
      .find((notice) => typeof notice.props.onAction === 'function');

    act(() => actionable?.props.onAction());

    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('accept失敗の再試行ボタンで同じ招待accept mutationを再実行する', () => {
    mocks.query.data = preview;
    mocks.mutation.error = new ApiError('provider detail', 503, 'SERVICE_UNAVAILABLE');
    mocks.mutation.isError = true;
    const renderer = renderScreen();
    const actionable = renderer.root
      .findAllByType('notice')
      .find((notice) => typeof notice.props.onAction === 'function');

    act(() => actionable?.props.onAction());

    expect(mocks.mutation.mutate).toHaveBeenCalledTimes(1);
  });

  it('認証失敗のアクションでアカウント切替を実行する', () => {
    const onSwitchAccount = vi.fn().mockResolvedValue(undefined);
    mocks.query.error = new ApiError('provider detail', 401, 'UNAUTHORIZED');
    mocks.query.isError = true;
    const renderer = renderScreen({ onSwitchAccount });
    const actionable = renderer.root
      .findAllByType('notice')
      .find((notice) => typeof notice.props.onAction === 'function');

    act(() => actionable?.props.onAction());

    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
  });
});
