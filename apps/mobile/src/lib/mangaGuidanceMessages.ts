import type { UiLanguage } from '@/domain/types';

// Dedicated bilingual copy for U03/U11/U12; amounts come only from the server.
const messages = {
  en: {
    credits: 'Credits', personal: 'Personal', organization: 'Organization', retry: 'Retry balance',
    balance: {
      loading: 'Loading…', refreshing: 'Updating…', error: 'Could not load',
      offline: 'Offline · refresh needed', unavailable: 'Unavailable'
    },
    replay: 'View tutorial', welcome: 'Welcome to Lyra', skip: 'Skip tutorial',
    next: 'Next', previous: 'Back', finish: 'Done', close: 'Close tutorial',
    progress: 'Step',
    historyError: 'Tutorial progress could not be saved on this device. You can continue and replay it any time.',
    steps: [
      { title: '1. Story', body: 'From the Manga list, create or select a work, chapter and episode. Write and save the episode title, story and planned page count. You can then continue to Characters.' },
      { title: '2. Characters', body: 'Create or select the characters and other assets for your work. Review their settings and reference images before using them in pages. Assets are also available from the Assets tab.' },
      { title: '3. Pages', body: 'Plan the page skeleton, fill and review the panel settings, then generate page images. Moving between steps does not save inputs or start generation. Existing episodes can resume from their saved progress.' },
      { title: 'Credits and replay', body: 'The header shows credits for your active personal or organization workspace. Image generation and preview/import operations use credits. Check the operation details before running them. My Page contains available billing options and language settings. Organization credit replenishment requires billing permissions. Replay this tutorial from the Manga list or Guide.' }
    ]
  },
  ja: {
    credits: 'クレジット', personal: '個人', organization: '組織', retry: '残高を再読込',
    balance: {
      loading: '読込中…', refreshing: '更新中…', error: '残高を取得できません',
      offline: 'オフライン・再読込が必要', unavailable: '残高を確認できません'
    },
    replay: 'チュートリアルを見る', welcome: 'Lyraへようこそ', skip: 'チュートリアルをスキップ',
    next: '次へ', previous: '戻る', finish: '完了', close: 'チュートリアルを閉じる',
    progress: 'ステップ',
    historyError: 'チュートリアルの閲覧状況を端末に保存できませんでした。そのまま制作を続けられ、いつでも見直せます。',
    steps: [
      { title: '1. ストーリー', body: '漫画一覧から作品・章・話を作成または選択します。話のタイトル・本文・想定ページ数を入力して保存し、キャラクターの工程へ進みます。' },
      { title: '2. キャラクター', body: '作品で使うキャラクターやアセットを作成または選択します。設定と参照画像を確認してからページで使います。「アセット」タブからも素材を管理できます。' },
      { title: '3. ページ', body: 'ページ骨格を設計し、コマの設定を入力・確認してからページ画像を作成します。工程を移動するだけでは入力の保存や生成は実行されません。既存の話は保存済みの進行状況から再開できます。' },
      { title: 'クレジットと見直し', body: 'ヘッダーには現在選択している個人・組織のクレジット残高が表示されます。画像生成やプレビュー・取り込みの処理はクレジットを使います。実行前に各操作の説明を確認してください。マイページで利用可能な課金設定と言語を確認できます。組織の残高補充には課金の権限が必要です。この案内は漫画一覧やガイドから見直せます。' }
    ]
  }
} as const;

export function mangaGuidanceMessages(language: UiLanguage): typeof messages[UiLanguage] {
  return messages[language];
}
