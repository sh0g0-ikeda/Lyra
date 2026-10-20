import type { UiLanguage } from '@/domain/types';

const copy = {
  en: {
    signIn: 'Continue with X',
    confirmation: 'We will confirm with a code sent to your verified X email address.',
    existing: 'Already use Lyra? Please sign in using your existing method.',
    unavailable: 'X sign-in is currently unavailable. Please use your existing sign-in method.'
  },
  ja: {
    signIn: 'Xで続ける',
    confirmation: 'Xの確認済みメールに届くコードで確認します。',
    existing: '既存アカウントはこれまでの方法でログインしてください。',
    unavailable: '現在Xログインは利用できません。これまでの方法でログインしてください。'
  }
} as const;

export function xAuthMessages(language: UiLanguage): typeof copy[UiLanguage] {
  return copy[language];
}
