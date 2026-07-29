import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MainTabs } from '@/navigation/tabs';

interface TabPressEvent {
  preventDefault: () => void;
}

interface NavigationLike {
  getState: () => {
    index: number;
    routes: { key: string }[];
  };
  navigate: (name: string) => void;
}

interface ScreenListenersInput {
  navigation: NavigationLike;
  route: {
    key: string;
    name: string;
  };
}

interface NavigatorProps {
  screenListeners?: (
    input: ScreenListenersInput
  ) => {
    tabPress?: (event: TabPressEvent) => void;
  };
  children?: React.ReactNode;
}

let navigatorProps: NavigatorProps | null = null;
let hasDirtyEditors = true;
const resolveDirtyEditors = vi.fn<() => Promise<boolean>>();

vi.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: (props: NavigatorProps): React.JSX.Element => {
      navigatorProps = props;
      return React.createElement('navigator', null, props.children);
    },
    Screen: (): React.JSX.Element => React.createElement('screen')
  })
}));

vi.mock('lucide-react-native', () => ({
  BookOpenText: (): React.JSX.Element => React.createElement('icon'),
  CircleHelp: (): React.JSX.Element => React.createElement('icon'),
  Images: (): React.JSX.Element => React.createElement('icon'),
  Settings: (): React.JSX.Element => React.createElement('icon'),
  UsersRound: (): React.JSX.Element => React.createElement('icon')
}));

vi.mock('@/screens/AccountScreen', () => ({ AccountScreen: () => null }));
vi.mock('@/screens/CharactersScreen', () => ({ CharactersScreen: () => null }));
vi.mock('@/screens/GuideScreen', () => ({ GuideScreen: () => null }));
vi.mock('@/screens/PagesScreen', () => ({ PagesScreen: () => null }));
vi.mock('@/screens/StoryScreen', () => ({ StoryScreen: () => null }));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({
    hasCapability: () => true,
    language: 'ja'
  })
}));
vi.mock('@/state/dirtyState', () => ({
  useDirtyState: () => ({
    hasDirtyEditors,
    resolveDirtyEditors
  })
}));

describe('MainTabs dirty-state guard', () => {
  beforeEach(() => {
    navigatorProps = null;
    hasDirtyEditors = true;
    resolveDirtyEditors.mockReset();
  });

  it('キャンセル時は別タブへの遷移を止める', async () => {
    resolveDirtyEditors.mockResolvedValue(false);
    await act(async () => {
      create(<MainTabs />);
    });
    const navigation: NavigationLike = {
      getState: () => ({ index: 0, routes: [{ key: 'Story-key' }] }),
      navigate: vi.fn()
    };
    const event: TabPressEvent = { preventDefault: vi.fn() };

    await act(async () => {
      navigatorProps?.screenListeners?.({
        navigation,
        route: { key: 'Pages-key', name: 'Pages' }
      }).tabPress?.(event);
      await Promise.resolve();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(resolveDirtyEditors).toHaveBeenCalledWith('ja');
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('保存成功時は要求された別タブへ遷移する', async () => {
    resolveDirtyEditors.mockResolvedValue(true);
    await act(async () => {
      create(<MainTabs />);
    });
    const navigation: NavigationLike = {
      getState: () => ({ index: 0, routes: [{ key: 'Story-key' }] }),
      navigate: vi.fn()
    };
    const event: TabPressEvent = { preventDefault: vi.fn() };

    await act(async () => {
      navigatorProps?.screenListeners?.({
        navigation,
        route: { key: 'Pages-key', name: 'Pages' }
      }).tabPress?.(event);
      await Promise.resolve();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('Pages');
  });

  it('dirtyなしでは標準遷移を妨げない', async () => {
    hasDirtyEditors = false;
    await act(async () => {
      create(<MainTabs />);
    });
    const navigation: NavigationLike = {
      getState: () => ({ index: 0, routes: [{ key: 'Story-key' }] }),
      navigate: vi.fn()
    };
    const event: TabPressEvent = { preventDefault: vi.fn() };

    navigatorProps?.screenListeners?.({
      navigation,
      route: { key: 'Pages-key', name: 'Pages' }
    }).tabPress?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(resolveDirtyEditors).not.toHaveBeenCalled();
  });
});
