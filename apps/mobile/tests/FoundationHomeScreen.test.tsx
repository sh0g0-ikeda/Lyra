import React, { forwardRef, useImperativeHandle } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundationHomeScreen } from '../src/screens/FoundationHomeScreen';

const { prepareToLeave, signOut } = vi.hoisted(() => ({
  prepareToLeave: vi.fn(),
  signOut: vi.fn(),
}));

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

vi.mock('../src/components/Screen', () => ({
  Screen: ({ children, title }: { children: React.ReactNode; title: string }) =>
    React.createElement('screen', { title }, children),
}));

vi.mock('../src/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message),
}));

vi.mock('../src/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('button', { onClick: onPress }, label),
}));

vi.mock('../src/screens/StoryScreen', () => ({
  StoryScreen: forwardRef(function MockStoryScreen(_props, ref) {
    useImperativeHandle(ref, () => ({ prepareToLeave }));
    return React.createElement('story-screen', null, 'Story editor');
  }),
}));

vi.mock('../src/state/AuthSessionProvider', () => ({
  useAuthSession: () => ({
    api: {},
    language: 'ja',
    signOut,
  }),
}));

const session = {
  user: {
    id: 'user-1',
    email: 'user@example.com',
    display_name: null,
    plan_code: 'free',
  },
  personal_credits: null,
  organizations: [],
};

describe('FoundationHomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareToLeave.mockResolvedValue(true);
    signOut.mockResolvedValue(undefined);
  });

  it('初期表示はStoryで、Accountへ移る前に未保存変更を解決する', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={session} />);
    });
    expect(renderer!.root.findByType('story-screen')).toBeDefined();

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });

    expect(prepareToLeave).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer!.toJSON())).toContain('user@example.com');
  });

  it('未保存変更の解決をキャンセルした場合はStoryに残る', async () => {
    prepareToLeave.mockResolvedValue(false);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={session} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });

    expect(renderer!.root.findByType('story-screen')).toBeDefined();
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('user@example.com');
  });

  it('Accountを連打しても未保存変更の確認を重複起動しない', async () => {
    let resolveLeave: ((value: boolean) => void) | undefined;
    prepareToLeave.mockReturnValue(new Promise((resolve) => {
      resolveLeave = resolve;
    }));
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={session} />);
    });
    const accountTab = renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' });

    await act(async () => {
      accountTab.props.onPress();
      accountTab.props.onPress();
      await Promise.resolve();
    });
    expect(prepareToLeave).toHaveBeenCalledOnce();

    await act(async () => {
      resolveLeave?.(true);
      await Promise.resolve();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('user@example.com');
  });
});
