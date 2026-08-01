import { Alert } from 'react-native';
import { t, type UiLanguage } from './i18n';

export function showPanelDeletionPrompt(
  language: UiLanguage,
  panelOrder: number,
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
      t(language, 'panelStructureDeleteConfirmTitle'),
      t(language, 'panelStructureDeleteConfirmMessage', { number: String(panelOrder) }),
      [
        {
          text: t(language, 'cancel'),
          style: 'cancel',
          onPress: () => settle(false),
        },
        {
          text: t(language, 'panelStructureDeleteConfirmAction'),
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
