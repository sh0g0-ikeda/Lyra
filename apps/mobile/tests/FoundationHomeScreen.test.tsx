import React, { forwardRef, useImperativeHandle } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundationHomeScreen } from '../src/screens/FoundationHomeScreen';

const {
  charactersPrepareToLeave,
  pagesPrepareToLeave,
  prepareToLeave,
  signOut,
} = vi.hoisted(() => ({
  charactersPrepareToLeave: vi.fn(),
  pagesPrepareToLeave: vi.fn(),
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
  StoryScreen: forwardRef(function MockStoryScreen(
    props: { organizationId: string | null },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ prepareToLeave }));
    return React.createElement(
      'story-screen',
      { organizationId: props.organizationId },
      'Story editor',
    );
  }),
}));

vi.mock('../src/screens/PagesScreen', () => ({
  PagesScreen: forwardRef(function MockPagesScreen(
    props: { organizationId: string | null },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ prepareToLeave: pagesPrepareToLeave }));
    return React.createElement(
      'pages-screen',
      { organizationId: props.organizationId },
      'Pages editor',
    );
  }),
}));

vi.mock('../src/screens/CharactersScreen', () => ({
  CharactersScreen: forwardRef(function MockCharactersScreen(
    props: {
      imageApiBaseUrl: string;
      imageAuthorizationHeader: string | null;
      organizationId: string | null;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ prepareToLeave: charactersPrepareToLeave }));
    return React.createElement(
      'characters-screen',
      {
        imageApiBaseUrl: props.imageApiBaseUrl,
        imageAuthorizationHeader: props.imageAuthorizationHeader,
        organizationId: props.organizationId,
      },
      'Characters editor',
    );
  }),
}));

vi.mock('../src/screens/AccountScreen', () => ({
  AccountScreen: ({
    onOrganizationChange,
    session,
  }: {
    onOrganizationChange(organizationId: string | null): void;
    session: { user: { email: string } };
  }) => React.createElement(
    'account-screen',
    null,
    session.user.email,
    React.createElement(
      'button',
      { accessibilityLabel: 'テスト法人へ切り替え', onClick: () => onOrganizationChange('organization-1') },
      'Switch workspace',
    ),
  ),
}));

vi.mock('../src/state/AuthSessionProvider', () => ({
  useAuthSession: () => ({
    api: {},
    language: 'ja',
    signOut,
    tokens: {
      idToken: 'id-token',
      accessToken: null,
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000_000,
      tokenType: 'Bearer',
    },
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

const sessionWithOrganization = {
  ...session,
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
  ],
};

const sessionWithInactiveOrganization = {
  ...session,
  organizations: [
    {
      ...sessionWithOrganization.organizations[0],
      membership_status: 'invited' as const,
    },
  ],
};

describe('FoundationHomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    charactersPrepareToLeave.mockResolvedValue(true);
    pagesPrepareToLeave.mockResolvedValue(true);
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
    expect(renderer!.root.findByType('story-screen').props.organizationId).toBeNull();
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('user@example.com');
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'テスト法人へ切り替え' })).toHaveLength(0);
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

  it('StoryからPage、PageからAccountへ移る前に各画面の未保存変更を解決する', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={session} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'ページを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(prepareToLeave).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('pages-screen')).toBeDefined();

    pagesPrepareToLeave.mockResolvedValue(false);
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(pagesPrepareToLeave).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('pages-screen')).toBeDefined();
  });

  it('StoryとPagesの間にCharactersを表示し、離脱前に未保存変更を解決する', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={session} />);
    });
    expect(renderer!.root.findAllByType('button').map(
      (tab) => tab.props.accessibilityLabel,
    ).filter((label): label is string => label !== undefined)).toEqual([
      'ストーリーを開く',
      'キャラを開く',
      'ページを開く',
      'アカウントを開く',
    ]);

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'キャラを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(prepareToLeave).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('characters-screen').props).toEqual(expect.objectContaining({
      imageApiBaseUrl: expect.any(String),
      imageAuthorizationHeader: 'Bearer id-token',
    }));

    charactersPrepareToLeave.mockResolvedValue(false);
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'ページを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(charactersPrepareToLeave).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('characters-screen')).toBeDefined();
  });

  it('Accountで選んだactive organizationを次に開くStoryのscopeへ渡す', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={sessionWithOrganization} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'テスト法人へ切り替え' }).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'ストーリーを開く' }).props.onPress();
      await Promise.resolve();
    });

    expect(renderer!.root.findByType('story-screen').props.organizationId).toBe('organization-1');
  });

  it('Accountで選んだactive organizationをCharactersとPagesにも渡す', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={sessionWithOrganization} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'テスト法人へ切り替え' }).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'キャラを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer!.root.findByType('characters-screen').props.organizationId).toBe('organization-1');

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'ページを開く' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer!.root.findByType('pages-screen').props.organizationId).toBe('organization-1');
  });

  it('inactive membershipのorganization選択をpersonal scopeへ正規化する', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<FoundationHomeScreen session={sessionWithInactiveOrganization} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'アカウントを開く' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'テスト法人へ切り替え' }).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'ストーリーを開く' }).props.onPress();
      await Promise.resolve();
    });

    expect(renderer!.root.findByType('story-screen').props.organizationId).toBeNull();
  });
});
