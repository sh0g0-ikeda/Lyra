import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Notice } from '../components/Notice';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { colors, radius, spacing } from '../constants/theme';
import type { CurrentSession } from '../lib/api';
import { t } from '../lib/i18n';
import { userErrorMessage } from '../lib/userMessages';
import { useAuthSession } from '../state/AuthSessionProvider';
import { StoryScreen, type StoryScreenHandle } from './StoryScreen';
import { PagesScreen, type PagesScreenHandle } from './PagesScreen';
import { CharactersScreen, type CharactersScreenHandle } from './CharactersScreen';

interface FoundationHomeScreenProps {
  session: CurrentSession;
}

type HomeTab = 'story' | 'characters' | 'pages' | 'account';

export function FoundationHomeScreen({
  session,
}: FoundationHomeScreenProps): React.JSX.Element {
  const { api, language, signOut } = useAuthSession();
  const [activeTab, setActiveTab] = useState<HomeTab>('story');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tabTransition = useRef<Promise<void> | null>(null);
  const pagesRef = useRef<PagesScreenHandle>(null);
  const charactersRef = useRef<CharactersScreenHandle>(null);
  const storyRef = useRef<StoryScreenHandle>(null);

  const openTab = (nextTab: HomeTab): Promise<void> => {
    if (nextTab === activeTab) {
      return Promise.resolve();
    }
    if (tabTransition.current !== null) {
      return tabTransition.current;
    }
    const transition = (async (): Promise<void> => {
      const canLeave = activeTab === 'story'
        ? await storyRef.current?.prepareToLeave() ?? true
        : activeTab === 'characters'
          ? await charactersRef.current?.prepareToLeave() ?? true
        : activeTab === 'pages'
          ? await pagesRef.current?.prepareToLeave() ?? true
          : true;
      if (canLeave) {
        setActiveTab(nextTab);
      }
    })();
    tabTransition.current = transition;
    void transition.finally(() => {
      if (tabTransition.current === transition) {
        tabTransition.current = null;
      }
    });
    return transition;
  };

  const handleSignOut = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch (error: unknown) {
      setErrorMessage(userErrorMessage(error, language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen title="Lyra Mobile">
      <View accessibilityRole="tablist" style={styles.tabs}>
        <TabButton
          accessibilityLabel={language === 'ja' ? 'ストーリーを開く' : 'Open Story'}
          active={activeTab === 'story'}
          label={t(language, 'story')}
          onPress={() => void openTab('story')}
        />
        <TabButton
          accessibilityLabel={language === 'ja' ? 'キャラを開く' : 'Open Characters'}
          active={activeTab === 'characters'}
          label={t(language, 'characters')}
          onPress={() => void openTab('characters')}
        />
        <TabButton
          accessibilityLabel={language === 'ja' ? 'ページを開く' : 'Open Pages'}
          active={activeTab === 'pages'}
          label={t(language, 'pages')}
          onPress={() => void openTab('pages')}
        />
        <TabButton
          accessibilityLabel={language === 'ja' ? 'アカウントを開く' : 'Open Account'}
          active={activeTab === 'account'}
          label={t(language, 'account')}
          onPress={() => void openTab('account')}
        />
      </View>

      {activeTab === 'story' ? (
        <StoryScreen
          api={api}
          language={language}
          organizationId={null}
          ref={storyRef}
          sessionKey={session.user.id}
        />
      ) : activeTab === 'characters' ? (
        <CharactersScreen
          api={api}
          language={language}
          organizationId={null}
          ref={charactersRef}
          sessionKey={session.user.id}
        />
      ) : activeTab === 'pages' ? (
        <PagesScreen
          api={api}
          language={language}
          organizationId={null}
          ref={pagesRef}
          sessionKey={session.user.id}
        />
      ) : (
        <View style={styles.accountContent}>
          <Notice message={t(language, 'foundationConnected')} />
          <View style={styles.card}>
            <Text style={styles.label}>{t(language, 'account')}</Text>
            <Text style={styles.value}>{session.user.email}</Text>
            <Text style={styles.label}>{t(language, 'plan')}</Text>
            <Text style={styles.value}>{session.user.plan_code}</Text>
          </View>
          {errorMessage === null ? null : (
            <Notice message={errorMessage} tone="danger" />
          )}
          <PrimaryButton
            label={t(language, 'logout')}
            loading={loading}
            onPress={() => void handleSignOut()}
          />
        </View>
      )}
    </Screen>
  );
}

function TabButton({
  accessibilityLabel,
  active,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  active: boolean;
  label: string;
  onPress(): void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active && styles.tabActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accountContent: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.75,
  },
  tab: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    flex: 1,
    padding: spacing.sm,
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: colors.accent,
  },
  tabs: {
    flexDirection: 'row',
  },
  value: {
    color: colors.ink,
    fontSize: 17,
    marginBottom: spacing.sm,
  },
});
