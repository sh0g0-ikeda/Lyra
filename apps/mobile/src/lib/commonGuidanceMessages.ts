import type { UiLanguage } from '@/domain/types';

const messages = {
  en: {
    saveContinue: 'Save and continue', discardContinue: 'Discard changes and continue', goBack: 'Go back',
    dirtyMessage: 'Save your unsaved edits before continuing, discard them, or go back to keep editing. If saving fails, you will stay on this screen.',
    reloadTitle: 'Replace unsaved drafts?', reloadConfirm: 'Replace drafts and reload', reloadAction: 'Reload latest state', reloadPageAction: 'Reload latest page',
    reloadWarning: 'Reloading replaces the following unsaved inputs with saved values. Go back if you want to keep your edits.',
    reloadFields: {
      story: 'Episode title, full story, planned page count and starting character states. The current AI improvement result is also cleared.',
      character: 'Asset type, name, free description, prompt supplement and structured settings. The current import result/candidate and unsaved character-state draft are also cleared.',
      page: 'Page style reference, source scenes, page purpose and continuity note; selected-panel role/size, situation, composition/camera, character assignments, dialogue, background, effects and notes; and page frame edits.'
    },
    readUnknown: 'The latest job status could not be checked. Its outcome and current credit settlement are not confirmed here. Refresh the status before starting another generation.',
    jobUnavailable: 'This job is not available in the current workspace. Its outcome and credit settlement could not be confirmed here.',
    jobRefresh: 'Refresh job status',
    statusChecking: 'Checking this job. Its outcome and credit settlement have not been confirmed yet.',
    settlementUnknown: 'Credit settlement is unavailable for this job. Do not assume it was free or refunded.',
    refundPaused: 'Refund status is still pending. Automatic checks have paused; refresh to check again.',
    refundRefresh: 'Refresh refund status',
    lastChecked: 'Last checked',
    cancelProcessing: 'Request a stop after the current processing stage. Check the resulting job status and credit settlement to confirm cancellation and any refund.',
    cancelQueued: 'Request cancellation of this queued generation. Check the resulting job status and credit settlement to confirm cancellation and any refund.'
  },
  ja: {
    saveContinue: '保存して続ける', discardContinue: '変更を破棄して続ける', goBack: '戻る',
    dirtyMessage: '未保存の変更を保存して続けるか、破棄するか、戻って編集を続けてください。保存できなかった場合は、この画面に留まります。',
    reloadTitle: '未保存の入力を置き換えますか？', reloadConfirm: '入力を置き換えて再読込', reloadAction: '最新状態を読み込み', reloadPageAction: '最新ページを再読込',
    reloadWarning: '次の未保存入力を保存済みの値で置き換えます。入力を残す場合はキャンセルしてください。',
    reloadFields: {
      story: '話のタイトル・本文・想定ページ数・キャラクターの開始状態。現在のAI改善結果もクリアされます。',
      character: 'アセットの種類・名前・自由記述・プロンプト補足・構造化設定。現在の取り込み結果・候補と未保存のキャラクター状態もクリアされます。',
      page: 'ページの画風参照・元シーン・目的・連続性メモ、選択中コマの役割・サイズ・状況・構図・カメラ・登場人物・セリフ・背景・効果・メモ、およびページのコマ枠の編集内容。'
    },
    readUnknown: '最新のジョブ状態を確認できません。処理結果と現在のクレジット精算状況は未確認です。別の生成を始める前に、状態を再読込してください。',
    jobUnavailable: '現在のワークスペースではこのジョブを取得できません。処理結果とクレジット精算状況は確認できていません。',
    jobRefresh: 'ジョブ状態を再読込',
    statusChecking: 'ジョブの状態を確認中です。処理結果とクレジット精算状況はまだ確認できていません。',
    settlementUnknown: 'このジョブのクレジット精算状況を取得できません。未課金・返金済みとは確認できていません。',
    refundPaused: '返金状況は引き続き確認待ちです。自動確認を一時停止しました。再読込して確認してください。',
    refundRefresh: '返金状況を再読込',
    lastChecked: '最終確認',
    cancelProcessing: '現在の処理段階が終わった時点での停止を依頼します。中止と返金の確定状況は、その後のジョブ状態とクレジット精算表示で確認してください。',
    cancelQueued: '待機中の生成の中止を依頼します。中止と返金の確定状況は、その後のジョブ状態とクレジット精算表示で確認してください。'
  }
} as const;

export function commonGuidanceMessages(language: UiLanguage): typeof messages[UiLanguage] {
  return messages[language];
}
