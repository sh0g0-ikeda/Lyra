import type { UiLanguage } from '@/domain/types';

export type AiProviderDataKind = 'image' | 'text';

export const appendAiProviderDisclosure = (
  message: string,
  language: UiLanguage,
  dataKind: AiProviderDataKind
): string => {
  const disclosure = language === 'ja'
    ? dataKind === 'image'
      ? '続行すると、選択した画像をAI処理のためOpenAIへ送信することに同意したものとします。'
      : '続行すると、入力した本文・設定をAI生成のためOpenAIへ送信することに同意したものとします。'
    : dataKind === 'image'
      ? 'By continuing, you consent to sending the selected image to OpenAI for AI processing.'
      : 'By continuing, you consent to sending the entered story and settings to OpenAI for AI generation.';
  return `${message}\n\n${disclosure}`;
};
