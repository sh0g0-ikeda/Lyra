import { Alert } from 'react-native';
import type { UiLanguage } from './i18n';

export interface EntityReferenceConfirmPromptInput {
  existingCount: number;
  language: UiLanguage;
}

export function showEntityReferenceConfirmPrompt(
  input: EntityReferenceConfirmPromptInput,
): Promise<boolean> {
  const isJapanese = input.language === 'ja';
  const title = isJapanese ? 'この画像を確定しますか？' : 'Confirm this image?';
  const message = input.existingCount > 0
    ? isJapanese
      ? '確定済み画像は残したまま、この画像を追加してメイン画像に設定します。'
      : 'This image will be added and set as primary. Existing confirmed images will remain.'
    : isJapanese
      ? 'この画像を確定済み参照画像として追加し、メイン画像に設定します。'
      : 'This image will be added as a confirmed reference and set as primary.';

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      {
        style: 'cancel',
        text: isJapanese ? 'キャンセル' : 'Cancel',
        onPress: () => resolve(false),
      },
      {
        text: isJapanese ? '確定する' : 'Confirm',
        onPress: () => resolve(true),
      },
    ], {
      cancelable: true,
      onDismiss: () => resolve(false),
    });
  });
}
