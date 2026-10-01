import type { UiLanguage } from '@/domain/types';
import { formatMessageTemplate } from '@/lib/i18n';
const copy = {
  ja: {
    design: 'ページ設計', settings: '設定の入力', create: 'ページ作成', workflow: 'ページの制作工程',
    nextSettings: '次へ：設定の入力', nextCreate: '次へ：ページ作成', previous: '前の工程へ',
    stepHelp: '工程の切り替えだけでは保存・自動入力・画像生成は実行しません。',
    currentDesign: '現在のページ設計', currentSettings: '現在の設定', noDesign: 'ページを選ぶと現在のコマ割りを確認できます。',
    noSettings: 'ページを選ぶと現在の設定を確認できます。', noPanel: 'コマの設定はまだありません。', unset: '未設定',
    page: '{number}ページ', panel: 'コマ {number}', panelSummary: '人物 {entities}人・セリフ {dialogues}件',
    jump: '番号でページを選ぶ', designCount: '{pages}ページ・{panels}コマ',
    complete: '{number}ページの画像が完成しました', viewResult: '生成結果を確認', close: '閉じる',
    regenerate: 'このページを再生成', nextPage: '次のページを生成', lastPage: '最後のページです', reviewPages: 'ページ一覧を確認',
    noAutomaticCharge: '再生成・次ページの生成は、対象と料金を確認した後に実行します。',
    exportAvailable: 'アプリで利用できるページをすべて書き出し',
    quoteRegenerate: '保存済み画像を更新する再生成です。', quoteGenerate: '新しいページ画像を生成します。',
    quoteTitle: '画像生成の料金を確認', quoteLoading: '保存済みの入力と料金を確認しています…', quoteCost: '{amount}クレジット',
    quoteScopePersonal: '個人のクレジット', quoteScopeOrganization: '法人のクレジット',
    quoteColor: 'カラー', quoteMonochrome: '白黒', quoteReferences: '参照画像 {count}枚', quoteExpiry: '有効期限：{expiry}',
    quoteConfirm: 'この料金で生成', quoteCancel: '戻る', quoteRetry: '受付状況を確認', quoteRequote: '料金を確認し直す',
    quoteUnavailable: 'この接続先では料金確認付きの画像生成を利用できません。設定と提供状況を確認してください。',
    quoteError: '料金または受付結果を確認できません。入力は保持されています。再試行してください。',
    quoteAccepting: '受付中です。閉じても受付済みの処理は取り消されません。',
    quoteUnknown: '受付結果を確認中です。課金されていないとは断定できません。同じ受付番号で照合します。',
    quoteStale: '入力または料金が変わったか、見積もりの有効期限が切れました。もう一度料金を確認してください。',
    quoteBlocked: '現在の保存済み設定では生成できません。人物画像・コマ割り・残高・進行中ジョブを確認してください。',
    quoteSaving: '現在の入力を保存してから、保存済み設定の料金を確認します。',
    imageMissing: '画像を読み込めません。後から生成結果を開き直してください。', morePages: '次のページを確認しています…'
  },
  en: {
    design: 'Page design', settings: 'Enter settings', create: 'Create page', workflow: 'Page creation steps',
    nextSettings: 'Next: Enter settings', nextCreate: 'Next: Create page', previous: 'Previous step',
    stepHelp: 'Switching steps does not save, autofill, or generate an image.',
    currentDesign: 'Current page design', currentSettings: 'Current settings', noDesign: 'Select a page to review its current panel layout.',
    noSettings: 'Select a page to review its current settings.', noPanel: 'There are no panel settings yet.', unset: 'Not set',
    page: 'Page {number}', panel: 'Panel {number}', panelSummary: '{entities} characters · {dialogues} dialogue lines',
    jump: 'Choose a page by number', designCount: '{pages} pages · {panels} panels',
    complete: 'Page {number} is ready', viewResult: 'View generation result', close: 'Close',
    regenerate: 'Regenerate this page', nextPage: 'Generate next page', lastPage: 'This is the last page', reviewPages: 'Review page list',
    noAutomaticCharge: 'Regeneration and next-page generation run only after you review the target and price.',
    exportAvailable: 'Export all pages available in the app',
    quoteRegenerate: 'This regenerates and updates the saved image.', quoteGenerate: 'This creates a new page image.',
    quoteTitle: 'Review image generation price', quoteLoading: 'Checking saved inputs and pricing…', quoteCost: '{amount} credits',
    quoteScopePersonal: 'Personal credits', quoteScopeOrganization: 'Organization credits',
    quoteColor: 'Color', quoteMonochrome: 'Monochrome', quoteReferences: '{count} reference images', quoteExpiry: 'Expires: {expiry}',
    quoteConfirm: 'Generate at this price', quoteCancel: 'Back', quoteRetry: 'Check acceptance status', quoteRequote: 'Request a fresh quote',
    quoteUnavailable: 'Quoted image generation is unavailable on this server. Check its settings and availability.',
    quoteError: 'The price or acceptance result could not be confirmed. Your input is retained. Please retry.',
    quoteAccepting: 'Submitting the request. Closing this dialog does not cancel an accepted generation.',
    quoteUnknown: 'The acceptance result is being checked. It is not yet possible to say whether credits were charged. The same request will be reconciled.',
    quoteStale: 'The inputs or price changed, or the quote expired. Please review a fresh quote.',
    quoteBlocked: 'These saved settings are not ready for generation. Check character references, panel layout, balance, and active jobs.',
    quoteSaving: 'Your current input is saved before the price of the saved settings is checked.',
    imageMissing: 'The image could not be loaded. Open the generation result again later.', morePages: 'Checking the next page…'
  }
} as const;
export function pageWorkflowMessage(language: UiLanguage, key: keyof typeof copy.ja, parameters: Record<string, string | number> = {}): string {
  return formatMessageTemplate(copy[language][key], parameters);
}
