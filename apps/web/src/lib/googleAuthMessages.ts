export function googleAuthMessages(language: 'en' | 'ja') {
  return language === 'en' ? {
    signIn:'Continue with Google', title:'Google account linking', explanation:'Link Google to this existing account. First, sign in again with your current email and password. Then choose the Google account with the same email. Your current Lyra tab stays open.',
    start:'Verify existing login and link Google', retry:'Retry the same request', continue:'Continue Google authorization', check:'Check linking status', restart:'Verify again and start a new attempt', cancel:'Close sign-in window',
    unknown:'The request result is unknown. Retry the same request while this tab retains its fresh sign-in proof. After a reload, verify again explicitly before starting a new attempt.',
    reauth:'Fresh sign-in is required. This tab cannot resume the previous authorization. You can still check a known request, or explicitly verify again and start a new attempt.',
    restartConfirm:'The previous request may still complete. This starts a separate request after you verify your existing login again. Continue?',
    error:'Linking could not be confirmed. Your current Lyra login has been kept. Check the existing request or retry when available.',
    popup:'Allow a sign-in popup for Lyra, then try again.', closed:'The sign-in window was closed. Your current login is unchanged. Check an existing request before starting again.', mismatch:'That login belongs to a different account. Sign in again with the email and password for the current Lyra account.', disabled:'Google linking is currently unavailable.',
    pending:'Google linking is awaiting authorization. Closing the window does not prove the request was cancelled.', processing:'Google linking is being checked. Use Check linking status to retrieve the result.', linked:'Google is linked to this account. Sign out when you are ready, then sign in again to use it.', cancelled:'Google authorization was cancelled.', expired:'This request expired. Verify your existing login again to start a new attempt.', failed:'Google linking failed. Verify that both accounts use the same email before trying again.', recovery_required:'The server is still reconciling this request. Check its status before trying another attempt.',
    relogin:'Sign out to sign in again', reloginConfirm:'Save any unsaved drafts before signing out. Sign out now?',
  } : {
    signIn:'Googleでログイン', title:'Googleアカウント連携', explanation:'既存のアカウントにGoogleを連携します。まず現在のメールアドレスとパスワードで再ログインし、その後同じメールアドレスのGoogleアカウントを選択してください。現在のLyraタブは開いたままです。',
    start:'既存ログインを確認してGoogleを連携', retry:'同じリクエストを再確認', continue:'Googleの認証を続ける', check:'連携状況を確認', restart:'再認証して新たに開始', cancel:'認証ウィンドウを閉じる',
    unknown:'リクエストの結果を確認できていません。このタブに再認証情報が残っている間は同じリクエストを再確認できます。再読み込み後は、明示的に再認証してから新たな試行を開始してください。',
    reauth:'再ログインが必要です。このタブでは前の認証を再開できません。既存リクエストの状況を確認するか、明示的に再認証して新たに開始してください。',
    restartConfirm:'前のリクエストが後から完了する可能性があります。既存ログインを再確認し、別のリクエストを開始します。続けますか？',
    error:'連携結果を確認できませんでした。現在のLyraログインは保持されています。既存リクエストの状況確認、または利用可能な再確認操作を行ってください。',
    popup:'Lyraの認証ポップアップを許可し、もう一度お試しください。', closed:'認証ウィンドウが閉じられました。現在のログインは保持されています。既存リクエストがある場合は、再開前に状況を確認してください。', mismatch:'別のアカウントでログインされました。現在のLyraアカウントのメールアドレスとパスワードで再認証してください。', disabled:'現在Google連携を利用できません。',
    pending:'Google連携は認証待ちです。ウィンドウを閉じただけでは、リクエストの取消完了を確認できません。', processing:'Google連携を確認中です。「連携状況を確認」で結果を取得してください。', linked:'このアカウントにGoogleを連携しました。準備ができたらログアウトし、再ログインして利用してください。', cancelled:'Googleの認証は取り消されました。', expired:'リクエストの有効期限が切れました。既存ログインを再確認して新たに開始してください。', failed:'Google連携に失敗しました。両方のアカウントが同じメールアドレスであることを確認して再試行してください。', recovery_required:'サーバーが結果を照合中です。別の試行を始める前に状況を確認してください。',
    relogin:'ログアウトして再ログイン', reloginConfirm:'未保存の下書きはログアウト前に保存してください。今ログアウトしますか？',
  };
}
export function googleAuthErrorMessage(error: unknown, language: 'en'|'ja'): string {
  const m=googleAuthMessages(language);
  const code=typeof error==='object' && error!==null && 'code' in error ? error.code : error instanceof Error ? error.message : '';
  if (code==='POPUP_BLOCKED') return m.popup;
  if (code==='POPUP_CLOSED') return m.closed;
  if (code==='ACCOUNT_MISMATCH') return m.mismatch;
  if (code==='RECENT_AUTH_REQUIRED' || code==='REAUTHENTICATION_REQUIRED') return m.reauth;
  if (code==='GOOGLE_LINK_DISABLED') return m.disabled;
  return m.error;
}
