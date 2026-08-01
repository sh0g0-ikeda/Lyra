import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BookOpenText, CircleHelp, Images, Settings, UsersRound, type LucideIcon } from 'lucide-react-native';

import { colors } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { AccountScreen } from '@/screens/AccountScreen';
import { CharactersScreen } from '@/screens/CharactersScreen';
import { GuideScreen } from '@/screens/GuideScreen';
import { PagesScreen } from '@/screens/PagesScreen';
import { StoryScreen } from '@/screens/StoryScreen';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';

export type MobileTabParamList = {
  Story: undefined;
  Characters: undefined;
  Pages: undefined;
  Account: undefined;
  Guide: undefined;
};

const Tab = createBottomTabNavigator<MobileTabParamList>();

const tabIcon = (Icon: LucideIcon, color: string): React.JSX.Element => (
  <Icon color={color} size={21} strokeWidth={2.2} />
);

export function MainTabs(): React.JSX.Element {
  const { hasCapability, language } = useAppState();
  const { hasDirtyEditors, resolveDirtyEditors } = useDirtyState();
  const canViewWork = hasCapability('view_work');

  return (
    <Tab.Navigator
      screenListeners={({ navigation, route }) => ({
        tabPress: (event) => {
          const navigationState = navigation.getState();
          const activeRoute = navigationState.routes[navigationState.index];
          if (!hasDirtyEditors || activeRoute?.key === route.key) {
            return;
          }
          event.preventDefault();
          void resolveDirtyEditors(language).then((canLeave) => {
            if (canLeave) {
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
          minHeight: 72,
          paddingBottom: 9,
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
          <Tab.Screen component={StoryScreen} name="Story" options={{ title: t(language, 'shared.navigation.story'), tabBarButtonTestID: 'tab-story', tabBarIcon: ({ color }) => tabIcon(BookOpenText, color) }} />
          <Tab.Screen component={CharactersScreen} name="Characters" options={{ title: t(language, 'shared.navigation.characters'), tabBarButtonTestID: 'tab-characters', tabBarIcon: ({ color }) => tabIcon(UsersRound, color) }} />
          <Tab.Screen component={PagesScreen} name="Pages" options={{ title: t(language, 'pages'), tabBarButtonTestID: 'tab-pages', tabBarIcon: ({ color }) => tabIcon(Images, color) }} />
        </>
      ) : null}
      <Tab.Screen component={AccountScreen} name="Account" options={{ title: t(language, 'shared.navigation.account'), tabBarButtonTestID: 'tab-account', tabBarIcon: ({ color }) => tabIcon(Settings, color) }} />
      <Tab.Screen component={GuideScreen} name="Guide" options={{ title: t(language, 'shared.navigation.guide'), tabBarButtonTestID: 'tab-guide', tabBarIcon: ({ color }) => tabIcon(CircleHelp, color) }} />
    </Tab.Navigator>
  );
}
