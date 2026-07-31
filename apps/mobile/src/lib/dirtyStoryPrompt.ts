import { Alert } from 'react-native';
import { t, type UiLanguage } from './i18n';

export type DirtyStoryAction = 'save' | 'discard' | 'cancel';

export function showDirtyStoryPrompt(language: UiLanguage): Promise<DirtyStoryAction> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (action: DirtyStoryAction): void => {
      if (!settled) {
        settled = true;
        resolve(action);
      }
    };
    Alert.alert(
      t(language, 'storyUnsavedTitle'),
      t(language, 'storyUnsavedMessage'),
      [
        {
          text: t(language, 'cancel'),
          style: 'cancel',
          onPress: () => settle('cancel'),
        },
        {
          text: t(language, 'storyDiscardAndContinue'),
          style: 'destructive',
          onPress: () => settle('discard'),
        },
        {
          text: t(language, 'storySaveAndContinue'),
          onPress: () => settle('save'),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => settle('cancel'),
      },
    );
  });
}
