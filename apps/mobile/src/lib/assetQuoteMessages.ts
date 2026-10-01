import { formatMessageTemplate } from '@/lib/i18n';
import type { UiLanguage } from '@/domain/types';
const copy = {
  en: {
    cost: '{amount} credits', references: '{count} reference images', expiry: 'Expires: {date}', color: 'Color', monochrome: 'Monochrome',
    title: 'Review price', reviewPreview: 'Review preview price', reviewImport: 'Upload image and review analysis price',
    entity_preview: 'Create an asset preview', entity_state_preview: 'Create a state preview', entity_import_analysis: 'Analyze the uploaded image',
    confirm: 'Accept this price and start', close: 'Back', refresh: 'Request a fresh quote', reconcile: 'Check acceptance status',
    quoting: 'Checking the saved inputs and price…', accepting: 'Submitting the request. Closing does not cancel an accepted request.',
    unknown: 'The acceptance result is unknown. Credits may have been charged. Check the receipt before retrying the same request.',
    stale: 'The saved inputs, price, or quote expiry changed. Review a fresh quote.', blocked: 'The server could not accept these inputs. Check the saved details, balance, and active jobs.',
    error: 'The price could not be confirmed. Your draft is retained. Try again.', unavailable: 'Price confirmation is unavailable on this server. This paid action cannot start yet.',
    personal: 'Personal credits', organization: 'Organization credits', beforeAccept: 'The paid operation starts only after you accept this quote.',
    importReady: 'Image analysis is ready. Review and apply its suggested details when you choose.', apply: 'Apply imported details',
    applyTitle: 'Apply imported details?', applyConfirm: 'Replace these fields',
    applyBody: 'This replaces the current appearance fields, additional structured fields, prompt supplement, and image candidate with the analysis result. The name and free description stay as entered. Cancel keeps all current input.',
    changedDraft: 'Your draft changed while the image was analyzed. Review the current input before replacing these fields.',
    importError: 'The image or analysis status could not be loaded. Your current input is retained.',
    imageType: 'Choose a JPEG, PNG, or WebP image up to 5 MB.', uploadReady: 'The image is uploaded. Review the analysis price before starting.',
    importPending: 'Image analysis is running. You can continue editing; results will only be applied after your confirmation.',
    sourcePending: 'Confirm the imported image before requesting this preview.', quoteChanged: 'The input changed. Review a fresh quote before starting.'
  },
  ja: {
    cost: '{amount}クレジット', references: '参照画像 {count}枚', expiry: '有効期限：{date}', color: 'カラー', monochrome: '白黒',
    title: '料金を確認', reviewPreview: 'プレビュー料金を確認', reviewImport: '画像をアップロードして解析料金を確認',
    entity_preview: '素材のプレビューを生成', entity_state_preview: '状態のプレビューを生成', entity_import_analysis: 'アップロードした画像を解析',
    confirm: 'この料金で開始', close: '戻る', refresh: '料金を確認し直す', reconcile: '受付状況を確認',
    quoting: '保存済み入力と料金を確認中…', accepting: '受付中です。閉じても受付済みの処理は取り消されません。',
    unknown: '受付結果が不明です。課金された可能性があります。同じリクエストを再試行する前に受付状況を確認してください。',
    stale: '保存済み入力・料金・有効期限が変わりました。もう一度料金を確認してください。', blocked: '現在の入力では受付できません。保存済み内容・残高・進行中ジョブを確認してください。',
    error: '料金を確認できませんでした。入力は保持されています。再試行してください。', unavailable: 'この接続先では料金確認を利用できないため、この有料処理は開始できません。',
    personal: '個人のクレジット', organization: '法人のクレジット', beforeAccept: '表示された料金を確認して開始を選ぶと、有料処理を受け付けます。',
    importReady: '画像解析が完了しました。提案内容を確認し、必要なときに入力へ適用してください。', apply: '解析結果を入力に適用',
    applyTitle: '解析結果を入力に適用しますか？', applyConfirm: '対象の入力を置き換える',
    applyBody: '現在の外見の選択項目・追加の構造化項目・プロンプト補足・画像候補を解析結果に置き換えます。名前と自由記述は入力した内容を保持します。キャンセルすると現在の入力をすべて保持します。',
    changedDraft: '画像解析中に入力が変更されました。対象項目を置き換える前に、現在の入力を確認してください。',
    importError: '画像または解析状況を読み込めません。現在の入力は保持されています。',
    imageType: '5 MB以下のJPEG・PNG・WebP画像を選んでください。', uploadReady: 'アップロードが完了しました。開始前に解析料金を確認してください。',
    importPending: '画像を解析中です。入力の編集を続けられます。結果は確認後にのみ入力へ適用します。',
    sourcePending: 'プレビュー料金を確認する前に、取り込んだ画像を確定してください。', quoteChanged: '入力が変更されました。開始前に料金を確認し直してください。'
  }
} as const;
export function assetQuoteMessages(language: UiLanguage): typeof copy[UiLanguage] { return copy[language]; }

export function assetQuoteMessage(language: UiLanguage, key: keyof typeof copy.en, values: Record<string, string | number> = {}): string { return formatMessageTemplate(copy[language][key], values); }
