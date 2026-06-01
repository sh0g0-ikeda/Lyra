export const APP_LANGUAGES = ['ja', 'en'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function normalizeAppLanguage(value: string | null | undefined): AppLanguage {
  return value === 'en' ? 'en' : 'ja';
}

export function describeAppLanguage(value: AppLanguage): string {
  return value === 'en' ? 'English' : 'Japanese';
}
