import type { UiLanguage } from '@/domain/types';
const copy = {
  en: {
    google: 'Continue with Google', link: 'Link Google', title: 'Google account link',
    existing: 'Already use Lyra with email and password? Sign in that way first, then explicitly link Google from My Page. Matching email addresses do not merge accounts.',
    explain: 'Link Google to this Lyra account. First sign in again using your existing Lyra email and password, then choose the matching Google account. Your current Lyra session stays in place.',
    confirmTitle: 'Link your Google account?', confirmAction: 'Verify existing account',
    busy: 'Checking account link…', retryStart: 'Retry the same link request', check: 'Check link status', continueLink: 'Continue Google authorization',
    signInAgain: 'Sign out to sign in again', verifyAgain: 'Verify existing account again',
    reauth: 'Recent verification is required. Check any pending link first. To start a new link request, explicitly verify your existing email and password again.',
    disabled: 'Google linking is currently unavailable. Your existing sign-in remains usable.',
    conflict: 'This Google identity cannot be linked to this account. No account merge will be performed here. Contact support to review the conflict.',
    recovery: 'This account link needs support review. Check the existing request status before taking another action.',
    unknown: 'The link result could not be confirmed. Your current Lyra session has not been replaced. Check the status or retry the same request; do not assume linking succeeded or was cancelled.',
    mismatch: 'The account used for verification does not match this Lyra account. Your current session has not been changed. Try again using the existing email and password.',
    unavailable: 'Google sign-in could not be completed. You can still use the existing email sign-in. If you already have an account, sign in first and link Google from My Page.',
    statuses: {
      pending: 'Google linking is not complete. Continue authorization or check its status.',
      processing: 'The server is checking the Google link. Check the status before starting another request.',
      linked: 'The server confirmed the Google link. Sign out and sign in again when you are ready to use it.',
      cancelled: 'The server confirmed that this linking request was cancelled.',
      expired: 'This linking request expired. Verify your existing account again to start a new request.',
      failed: 'The server could not complete this link. Verify your existing account again before starting a new request.',
      recovery_required: 'This account link needs support review. Your accounts and credits have not been merged by this screen.'
    }
  },
  ja: {
    google: 'Googleで続ける', link: 'Googleを連携', title: 'Googleアカウント連携',
    existing: 'メールとパスワードでLyraを利用中の場合は、まず従来の方法でログインし、マイページからGoogle連携を行ってください。同じメールアドレスだけでアカウントは統合されません。',
    explain: 'このLyraアカウントにGoogleを連携します。まず既存のLyraのメールとパスワードで再認証し、その後、同じメールのGoogleアカウントを選んでください。現在のLyraログイン状態は維持します。',
    confirmTitle: 'Googleアカウントを連携しますか？', confirmAction: '既存アカウントを確認',
    busy: 'アカウント連携を確認中…', retryStart: '同じ連携リクエストを再試行', check: '連携状況を確認', continueLink: 'Googleの認証を続ける',
    signInAgain: 'ログアウトして再ログイン', verifyAgain: '既存アカウントで再認証',
    reauth: '最近の再認証が必要です。未完了の連携がある場合は先に状況を確認してください。新しい連携リクエストを開始する場合は、既存のメールとパスワードで再認証してください。',
    disabled: '現在Google連携は利用できません。従来のログインを引き続き利用できます。',
    conflict: 'このGoogleアカウントは現在のアカウントに連携できません。この画面ではアカウントを統合しません。サポートに確認してください。',
    recovery: 'この連携はサポートでの確認が必要です。別の操作を行う前に、既存のリクエスト状況を確認してください。',
    unknown: '連携結果を確認できませんでした。現在のLyraログイン状態は置き換えていません。状況を確認するか、同じリクエストを再試行してください。連携成功・中止はまだ確定していません。',
    mismatch: '再認証したアカウントが現在のLyraアカウントと一致しません。現在のログイン状態は変更していません。既存のメールとパスワードで再度お試しください。',
    unavailable: 'Googleログインを完了できませんでした。従来のメールログインを引き続き利用できます。既存アカウントがある場合は先にログインし、マイページからGoogleを連携してください。',
    statuses: {
      pending: 'Google連携は未完了です。認証を続けるか、状況を確認してください。',
      processing: 'サーバーでGoogle連携を確認中です。別の連携を開始する前に状況を確認してください。',
      linked: 'サーバーでGoogle連携を確認しました。利用する準備ができたら、ログアウトして再ログインしてください。',
      cancelled: 'サーバーでこの連携リクエストの中止を確認しました。',
      expired: 'この連携リクエストは期限切れです。既存アカウントで再認証して、新しい連携を開始してください。',
      failed: 'サーバーで連携を完了できませんでした。新しい連携を開始する前に、既存アカウントで再認証してください。',
      recovery_required: 'このアカウント連携はサポートでの確認が必要です。この画面でアカウントや残高を統合する操作は行っていません。'
    }
  }
} as const;
export function googleAuthMessages(language: UiLanguage): typeof copy[UiLanguage] { return copy[language]; }
