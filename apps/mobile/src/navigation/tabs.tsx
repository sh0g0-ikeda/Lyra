import { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BookOpenText, CircleHelp, Settings, UsersRound, type LucideIcon } from 'lucide-react-native';

import { colors } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { AccountScreen } from '@/screens/AccountScreen';
import { AssetsScreen } from '@/screens/AssetsScreen';
import type { MangaCreationStep } from '@/domain/mangaWorkflow';
import { GuideScreen } from '@/screens/GuideScreen';
import { MangaScreen } from '@/screens/MangaScreen';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';

export type MobileTabParamList = {
  Story: { step: MangaCreationStep; requestId: number } | undefined;
  Characters: undefined;
  Account: undefined;
  Guide: undefined;
};

const Tab = createBottomTabNavigator<MobileTabParamList>();

const tabIcon = (Icon: LucideIcon, color: string): React.JSX.Element => (
  <Icon color={color} size={21} strokeWidth={2.2} />
);

export function MainTabs(): React.JSX.Element {
  const { hasCapability, language } = useAppState();
  const { hasNavigationBlockingEditors, resolveDirtyEditors } = useDirtyState();
  const canViewWork = hasCapability('view_work');
  const { bottom } = useSafeAreaInsets();
  const navigationRequest = useRef(0);

  return (
    <Tab.Navigator
      screenListeners={({ navigation, route }) => ({
        tabPress: (event) => {
          const request = ++navigationRequest.current;
          const navigationState = navigation.getState();
          const activeRoute = navigationState.routes[navigationState.index];
          if (!hasNavigationBlockingEditors || activeRoute?.key === route.key) {
            return;
          }
          event.preventDefault();
          void resolveDirtyEditors(language).then((canLeave) => {
            if (canLeave && request === navigationRequest.current &&
                navigation.getState().routes[navigation.getState().index]?.key === activeRoute?.key) {
              navigation.navigate(route.name);
            }
          });
        }
      })}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0,
          lineHeight: 14
        },
        tabBarStyle: {
          backgroundColor: 'rgba(8, 8, 8, 0.96)',
          borderTopColor: 'rgba(229, 199, 107, 0.18)',
          height: 72 + bottom,
          paddingBottom: 9 + bottom,
          paddingTop: 7
        },
        tabBarItemStyle: {
          borderRadius: 10,
          marginHorizontal: 2
        }
      }}
    >
      {canViewWork ? (
        <>
          <Tab.Screen component={MangaScreen} name="Story" options={{ title: t(language, 'navigation.manga'), tabBarButtonTestID: 'tab-manga', tabBarIcon: ({ color }) => tabIcon(BookOpenText, color) }} />
          <Tab.Screen component={AssetsScreen} name="Characters" options={{ title: t(language, 'navigation.assets'), tabBarButtonTestID: 'tab-assets', tabBarIcon: ({ color }) => tabIcon(UsersRound, color) }} />
        </>
      ) : null}
      <Tab.Screen component={AccountScreen} name="Account" options={{ title: t(language, 'navigation.myPage'), tabBarButtonTestID: 'tab-account', tabBarIcon: ({ color }) => tabIcon(Settings, color) }} />
      <Tab.Screen component={GuideScreen} name="Guide" options={{ title: t(language, 'shared.navigation.guide'), tabBarButtonTestID: 'tab-guide', tabBarIcon: ({ color }) => tabIcon(CircleHelp, color) }} />
    </Tab.Navigator>
  );
}
