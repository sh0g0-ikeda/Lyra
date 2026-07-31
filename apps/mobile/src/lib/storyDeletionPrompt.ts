import { Alert } from 'react-native';
import { t, type UiLanguage } from './i18n';

export type StoryDeletionTarget = 'chapter' | 'episode';

export function showStoryDeletionPrompt(
  language: UiLanguage,
  target: StoryDeletionTarget,
  targetTitle: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(confirmed);
      }
    };
    Alert.alert(
      t(language, target === 'chapter'
        ? 'storyDeleteChapterConfirmTitle'
        : 'storyDeleteEpisodeConfirmTitle'),
      t(
        language,
        target === 'chapter'
          ? 'storyDeleteChapterConfirmMessage'
          : 'storyDeleteEpisodeConfirmMessage',
        { title: targetTitle },
      ),
      [
        {
          text: t(language, 'cancel'),
          style: 'cancel',
          onPress: () => settle(false),
        },
        {
          text: t(language, 'storyDeleteConfirmAction'),
          style: 'destructive',
          onPress: () => settle(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => settle(false),
      },
    );
  });
}
