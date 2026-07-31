export type UiLanguage = 'en' | 'ja';

const messages = {
  ja: {
    account: 'アカウント',
    authCancelled: 'ログインがキャンセルされました。もう一度お試しください。',
    authFailed: 'ログイン処理を完了できませんでした。通信環境を確認してください。',
    authNotice: '安全なログイン画面を開きます。認証情報は端末の保護領域へ保存されます。',
    booting: '安全な保存領域を確認しています…',
    configurationError: 'アプリの接続設定が不足しています。配布元へお問い合わせください。',
    foundationConnected: 'Mobile基盤との接続を確認できました。編集機能は安全な単位で順次追加します。',
    login: 'ログイン',
    logout: 'ログアウト',
    networkError: 'サーバーに接続できません。通信環境を確認してください。',
    plan: 'プラン',
    retry: '再試行',
    sessionError: 'アカウント情報を確認できませんでした。入力内容や既存データは変更されていません。',
    sessionExpired: 'ログインの有効期限が切れました。もう一度ログインしてください。',
    sessionLoading: 'アカウント情報を確認しています…',
    supportCode: 'サポートコード: {code}',
    temporaryError: '一時的に処理できませんでした。少し待って再試行してください。',
  },
  en: {
    account: 'Account',
    authCancelled: 'Sign-in was cancelled. Please try again.',
    authFailed: 'Sign-in could not be completed. Check your connection.',
    authNotice: 'Lyra opens a secure sign-in page and stores the session in protected device storage.',
    booting: 'Checking protected device storage…',
    configurationError: 'The app connection is not configured. Contact the distributor.',
    foundationConnected: 'The Mobile foundation is connected. Editing features will be added in verified increments.',
    login: 'Sign in',
    logout: 'Sign out',
    networkError: 'The server could not be reached. Check your connection.',
    plan: 'Plan',
    retry: 'Retry',
    sessionError: 'Account information could not be loaded. Existing data was not changed.',
    sessionExpired: 'Your session expired. Please sign in again.',
    sessionLoading: 'Loading account information…',
    supportCode: 'Support code: {code}',
    temporaryError: 'The request could not be completed. Wait a moment and retry.',
  },
} as const;

export type MessageKey = keyof typeof messages.ja;

export function detectUiLanguage(locale?: string): UiLanguage {
  const resolved = locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return resolved.toLowerCase().startsWith('en') ? 'en' : 'ja';
}

export function t(
  language: UiLanguage,
  key: MessageKey,
  values: Readonly<Record<string, string>> = {},
): string {
  let message: string = messages[language][key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, value);
  }
  return message;
}
