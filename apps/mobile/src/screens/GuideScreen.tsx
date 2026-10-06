import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';

import { MangaTutorial } from '@/components/MangaTutorial';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { colors, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';
import type { ScreenTranslationKey } from '@/lib/i18nScreenMessages';
import { creationRouteParams } from '@/navigation/creationRoute';
import type { MobileTabParamList } from '@/navigation/tabs';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';
import type { MangaCreationStep } from '@/domain/mangaWorkflow';

type TutorialGroup = {
  id: string;
  titleKey: ScreenTranslationKey;
  target: MangaCreationStep;
  ctaKey: ScreenTranslationKey;
  stepKeys: ScreenTranslationKey[];
};

const tutorialGroups: TutorialGroup[] = [
  {
    id: 'story',
    titleKey: 'screen.guide.story.title',
    target: 'story',
    ctaKey: 'screen.guide.story.cta',
    stepKeys: [
      'screen.guide.story.step1',
      'screen.guide.story.step2',
      'screen.guide.story.step3',
      'screen.guide.story.step4',
      'screen.guide.story.step5',
      'screen.guide.story.step6'
    ]
  },
  {
    id: 'characters',
    titleKey: 'screen.guide.characters.title',
    target: 'characters',
    ctaKey: 'screen.guide.characters.cta',
    stepKeys: [
      'screen.guide.characters.step1',
      'screen.guide.characters.step2',
      'screen.guide.characters.step3',
      'screen.guide.characters.step4',
      'screen.guide.characters.step5'
    ]
  },
  {
    id: 'pages',
    titleKey: 'screen.guide.pages.title',
    target: 'pages',
    ctaKey: 'screen.guide.pages.cta',
    stepKeys: [
      'screen.guide.pages.step1',
      'screen.guide.pages.step2',
      'screen.guide.pages.step3',
      'screen.guide.pages.step4',
      'screen.guide.pages.step5',
      'screen.guide.pages.step6',
      'screen.guide.pages.step7',
      'screen.guide.pages.step8'
    ]
  }
];

export function GuideScreen(): React.JSX.Element {
  const { hasCapability, language } = useAppState();
  const canViewWork = hasCapability('view_work');
  const { resolveDirtyEditors } = useDirtyState();
  const navigation = useNavigation<BottomTabNavigationProp<MobileTabParamList>>();

  return (
    <Screen
      subtitle={t(language, "generated.screens.GuideScreen.a.focused.first.run.guide.for.the.main.w.3d898886")}
      title={t(language, 'tutorial')}
    >
      <MangaTutorial />
      {tutorialGroups.map((group) => (
        <Section key={group.id} title={t(language, group.titleKey)} tone="highlight">
          {group.stepKeys.map((stepKey, index) => (
            <View key={stepKey} style={styles.step}>
              <Text style={styles.index}>{index + 1}</Text>
              <Text style={styles.text}>{t(language, stepKey)}</Text>
            </View>
          ))}
          <PrimaryButton disabled={!canViewWork} disabledReason={!canViewWork ? t(language, 'shared.error.workspacePermission') : undefined} label={t(language, group.ctaKey)} onPress={() => {
            if (!canViewWork) return;
            void resolveDirtyEditors(language).then((allowed) => {
              if (allowed) navigation.navigate('Story', creationRouteParams(group.target));
            });
          }} variant="secondary" />
        </Section>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  index: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: '700',
    height: 24,
    letterSpacing: 0,
    lineHeight: 24,
    overflow: 'hidden',
    textAlign: 'center',
    width: 24
  },
  step: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm
  },
  text: {
    ...textStyles.body,
    color: '#F0E7C5',
    flex: 1
  }
});
