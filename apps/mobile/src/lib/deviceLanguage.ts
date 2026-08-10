import { getLocales } from 'expo-localization';

import type { UiLanguage } from '@/domain/types';

export const toSupportedUiLanguage = (
  language: string | null | undefined
): UiLanguage => {
  const languageCode = language?.trim().toLowerCase().split(/[-_]/u)[0];
  if (languageCode === 'ja') {
    return 'ja';
  }
  return 'en';
};

export const getDeviceUiLanguage = (): UiLanguage => {
  const primaryLocale = getLocales().at(0);
  return toSupportedUiLanguage(
    primaryLocale?.languageCode ?? primaryLocale?.languageTag
  );
};
