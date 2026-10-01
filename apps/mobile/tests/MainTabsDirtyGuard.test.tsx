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
  screenOptions?: { tabBarStyle: { height: number; paddingBottom: number } };
}

let navigatorProps: NavigatorProps | null = null;
let hasDirtyEditors = true;
let canViewWork = true;
let language = 'ja';
const screenProps: { name: string; options: { title: string; tabBarButtonTestID: string } }[] = [];
const resolveDirtyEditors = vi.fn<() => Promise<boolean>>();

vi.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: (props: NavigatorProps): React.JSX.Element => {
      navigatorProps = props;
      screenProps.length = 0;
      return React.createElement('navigator', null, props.children);
    },
    Screen: (props: { name: string; options: { title: string; tabBarButtonTestID: string } }): React.JSX.Element => {
      screenProps.push(props);
      return React.createElement('screen');
    }
  })
}));

vi.mock('lucide-react-native', () => ({
  BookOpenText: (): React.JSX.Element => React.createElement('icon'),
  CircleHelp: (): React.JSX.Element => React.createElement('icon'),
  Images: (): React.JSX.Element => React.createElement('icon'),
  Settings: (): React.JSX.Element => React.createElement('icon'),
  UsersRound: (): React.JSX.Element => React.createElement('icon')
}));

vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
vi.mock('@/screens/MangaScreen', () => ({ MangaScreen: () => null }));
vi.mock('@/screens/AssetsScreen', () => ({ AssetsScreen: () => null }));

vi.mock('@/screens/AccountScreen', () => ({ AccountScreen: () => null }));
vi.mock('@/screens/CharactersScreen', () => ({ CharactersScreen: () => null }));
vi.mock('@/screens/GuideScreen', () => ({ GuideScreen: () => null }));
vi.mock('@/screens/PagesScreen', () => ({ PagesScreen: () => null }));
vi.mock('@/screens/StoryScreen', () => ({ StoryScreen: () => null }));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({
    hasCapability: () => canViewWork,
    language
  })
}));
vi.mock('@/state/dirtyState', () => ({
  useDirtyState: () => ({
    hasDirtyEditors,
    hasNavigationBlockingEditors: hasDirtyEditors,
    resolveDirtyEditors
  })
}));

describe('MainTabs dirty-state guard', () => {
  beforeEach(() => {
    navigatorProps = null;
    hasDirtyEditors = true;
    canViewWork = true;
    language = 'ja';
    resolveDirtyEditors.mockReset();
  });

  it('閲覧権限がある場合は漫画・アセット・マイページ・ガイドの4タブを表示する', async () => {
    await act(async () => { create(<MainTabs />); });
    expect(screenProps.map((screen) => screen.name)).toEqual(['Story', 'Characters', 'Account', 'Guide']);
    expect(screenProps.map((screen) => screen.options.title)).toEqual(['漫画', 'アセット', 'マイページ', 'ガイド']);
    expect(navigatorProps?.screenOptions?.tabBarStyle).toMatchObject({ height: 106, paddingBottom: 43 });
  });

  it('作品閲覧権限がない場合もマイページとガイドを維持する', async () => {
    canViewWork = false;
    await act(async () => { create(<MainTabs />); });
    expect(screenProps.map((screen) => screen.name)).toEqual(['Account', 'Guide']);
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
        route: { key: 'Characters-key', name: 'Characters' }
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
        route: { key: 'Characters-key', name: 'Characters' }
      }).tabPress?.(event);
      await Promise.resolve();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('Characters');
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
      route: { key: 'Characters-key', name: 'Characters' }
    }).tabPress?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(resolveDirtyEditors).not.toHaveBeenCalled();
  });
  it('英語ではManga・Assets・My Page・Guideを表示する', async () => {
    language = 'en';
    await act(async () => { create(<MainTabs />); });
    expect(screenProps.map((screen) => screen.options.title)).toEqual(['Manga', 'Assets', 'My Page', 'Guide']);
  });

  it('連続タップ後に未保存確認が完了した場合は最後のタブ要求だけを適用する', async () => {
    let finish: (value: boolean) => void = () => undefined;
    resolveDirtyEditors.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { create(<MainTabs />); });
    const navigation: NavigationLike = {
      getState: () => ({ index: 0, routes: [{ key: 'Story-key' }] }), navigate: vi.fn()
    };
    await act(async () => {
      for (const target of ['Characters', 'Guide']) {
        navigatorProps?.screenListeners?.({ navigation, route: { key: `${target}-key`, name: target } }).tabPress?.({ preventDefault: vi.fn() });
      }
      finish(true);
    });
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('Guide');
  });

  it('確認中に別の移動が完了していた場合は古い要求を適用しない', async () => {
    let finish: (value: boolean) => void = () => undefined;
    resolveDirtyEditors.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { create(<MainTabs />); });
    let activeKey = 'Story-key';
    const navigation: NavigationLike = {
      getState: () => ({ index: 0, routes: [{ key: activeKey }] }), navigate: vi.fn()
    };
    await act(async () => {
      navigatorProps?.screenListeners?.({ navigation, route: { key: 'Characters-key', name: 'Characters' } }).tabPress?.({ preventDefault: vi.fn() });
      activeKey = 'Account-key';
      finish(true);
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

});
