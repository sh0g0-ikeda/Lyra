import type { UiLanguage } from '@/domain/types';

// Action labels are retained from the earlier panel editor; new safety copy reflects
// the transactional eight-panel API, not the retired multi-request insertion flow.
export const panelInsertionMessages = {
  ja: {
    action: 'このコマの後ろに追加',
    confirmation: '選択したコマの直後に空のコマを追加します。コマ割りは新しいコマ数の標準レイアウトに更新されます。保存済みのコマ内容は保持されます。',
    permission: '編集権限が必要です。',
    selection: 'コマを選択してください。',
    dirty: '未保存の変更を保存してからコマを追加してください。',
    busy: '処理が完了するまでお待ちください。',
    confirmed: '確定済みのページを編集状態に戻してから追加してください。',
    limit: '1ページに追加できるコマは8個までです。',
    checking: '最新のコマ一覧で追加結果を確認しています。',
    refresh: 'コマを追加しました。最新のコマ一覧を読み込んでいます。',
    refreshFailed: 'コマを追加しましたが、最新の一覧を取得できませんでした。追加し直さず、最新の状態を読み込んで確認してください。',
    failed: '追加結果を確認できませんでした。追加し直す前に最新のコマ一覧を読み込んで確認してください。',
    reload: '最新の状態を読み込む'
  },
  en: {
    action: 'Add a panel after this',
    confirmation: 'Add an empty panel immediately after the selected panel. The frame layout will change to the default for the new panel count. Saved panel content will be kept.',
    permission: 'Editing permission is required.',
    selection: 'Select a panel first.',
    dirty: 'Save your unsaved changes before adding a panel.',
    busy: 'Wait for the current operation to finish.',
    confirmed: 'Reopen the confirmed page before adding a panel.',
    limit: 'A page can contain up to 8 panels.',
    checking: 'Checking the latest panel list to confirm the insertion result.',
    refresh: 'The panel was added. Loading the latest panel list.',
    refreshFailed: 'The panel was added, but the latest list could not be loaded. Reload and review it instead of adding another panel.',
    failed: 'The insertion result could not be confirmed. Reload and review the latest panel list before adding another panel.',
    reload: 'Reload latest state'
  }
} as const;
export function panelInsertionMessage(language: UiLanguage, key: keyof typeof panelInsertionMessages.ja): string {
  return panelInsertionMessages[language][key];
}
