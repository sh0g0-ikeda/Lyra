import type { UiLanguage } from '@/domain/types';
import {
  componentTranslations,
  type ComponentTranslationKey
} from '@/lib/i18nComponentMessages';
import {
  generatedTranslations,
  type GeneratedTranslationKey
} from '@/lib/i18nGenerated';
import {
  screenTranslations,
  type ScreenTranslationKey
} from '@/lib/i18nScreenMessages';
import {
  sharedTranslations,
  type SharedTranslationKey
} from '@/lib/i18nSharedMessages';

type BaseTranslationKey =
  | 'account'
  | 'apiSetupRequired'
  | 'applyDraft'
  | 'applyStoryPlan'
  | 'applyTemplate'
  | 'atmosphere'
  | 'background'
  | 'billing'
  | 'billingWebOnly'
  | 'candidateToken'
  | 'characters'
  | 'chapter'
  | 'chapters'
  | 'confirmPage'
  | 'confirmReference'
  | 'continuityNote'
  | 'create'
  | 'createChapter'
  | 'createEpisode'
  | 'createScene'
  | 'createWork'
  | 'credits'
  | 'description'
  | 'dialogue'
  | 'dialogueMode'
  | 'emptyCharacters'
  | 'emptyChapters'
  | 'emptyEpisodes'
  | 'emptyPages'
  | 'emptyScenes'
  | 'emptyWorks'
  | 'episode'
  | 'episodes'
  | 'estimatedPages'
  | 'frames'
  | 'fullDraft'
  | 'generate'
  | 'generateReference'
  | 'guide'
  | 'imageImport'
  | 'insufficientCreditsWeb'
  | 'instruction'
  | 'language'
  | 'location'
  | 'login'
  | 'logout'
  | 'lyraSubtitle'
  | 'name'
  | 'notes'
  | 'pageList'
  | 'pagePurpose'
  | 'pageSettings'
  | 'pageSkeleton'
  | 'pages'
  | 'panelRole'
  | 'panels'
  | 'panelSize'
  | 'plan'
  | 'profile'
  | 'promptSupplement'
  | 'purpose'
  | 'referenceSet'
  | 'reopenPage'
  | 'refresh'
  | 'save'
  | 'saveScene'
  | 'scene'
  | 'scenes'
  | 'selectEpisodeFirst'
  | 'selectWorkFirst'
  | 'situation'
  | 'sourceS3Key'
  | 'story'
  | 'storyAi'
  | 'storyFailure'
  | 'styleReference'
  | 'styleReferenceNotes'
  | 'styleReferenceTitle'
  | 'suggestedFields'
  | 'theme'
  | 'time'
  | 'title'
  | 'tutorial'
  | 'webCreditManagement'
  | 'work'
  | 'works';

const baseTranslations: Record<UiLanguage, Record<BaseTranslationKey, string>> = {
  ja: {
    account: 'アカウント',
    apiSetupRequired: 'API URL と Cognito 設定を .env に入れてください。',
    applyDraft: '改善案を反映',
    applyStoryPlan: '話全体を反映',
    applyTemplate: 'コマ割りテンプレート',
    atmosphere: '雰囲気',
    background: '背景',
    billing: '請求管理',
    billingWebOnly: 'モバイル版では購入・プラン変更は行いません。',
    candidateToken: '候補トークン',
    characters: 'キャラクター',
    chapter: '章',
    chapters: '章',
    confirmPage: 'ページ確定',
    confirmReference: '参照画像を確定',
    continuityNote: '継続メモ',
    create: '作成',
    createChapter: '章を作成',
    createEpisode: '話を作成',
    createScene: 'シーンを作成',
    createWork: '作品を作成',
    credits: '残クレジット',
    description: '自由記述',
    dialogue: 'セリフ',
    dialogueMode: 'セリフ方式',
    emptyCharacters: 'キャラクターはまだありません。',
    emptyChapters: '章はまだありません。',
    emptyEpisodes: '話はまだありません。',
    emptyPages: 'ページはまだありません。',
    emptyScenes: 'シーンはまだありません。',
    emptyWorks: '作品はまだありません。',
    episode: '話',
    episodes: '話',
    estimatedPages: '想定ページ数',
    frames: '枠',
    fullDraft: '話の本文',
    generate: 'ページ生成',
    generateReference: '全身プレビュー生成',
    guide: 'ガイド',
    imageImport: '画像取り込み',
    insufficientCreditsWeb: 'クレジットが不足しています。Web版でクレジットを管理してください。',
    instruction: '指示',
    language: '言語',
    location: '場所',
    login: 'ログイン・アカウント登録はこちら',
    logout: 'ログアウト',
    lyraSubtitle: 'Lyra AI漫画エディタ',
    name: '名前',
    notes: 'メモ',
    pageList: 'ページ一覧',
    pagePurpose: 'ページの目的',
    pageSettings: 'ページ設定',
    pageSkeleton: 'ページ骨格生成',
    pages: 'ページ',
    panelRole: '役割',
    panels: 'コマ内容',
    panelSize: 'サイズ',
    plan: '現在のプラン',
    profile: 'プロフィール',
    promptSupplement: 'プロンプト補助',
    purpose: '目的',
    referenceSet: '参照画像',
    reopenPage: '再編集',
    refresh: '更新',
    save: '保存',
    saveScene: 'シーンを保存',
    scene: 'シーン',
    scenes: 'シーン',
    selectEpisodeFirst: '先にストーリーで話を選択、または作成してください。',
    selectWorkFirst: '先にストーリーで作品を選択、または作成してください。',
    situation: '状況',
    sourceS3Key: 'S3キー',
    story: 'ストーリー',
    storyAi: 'ストーリーAI',
    storyFailure: 'ストーリー操作に失敗しました。API の応答を確認してください。',
    styleReference: '画風の参考',
    styleReferenceNotes: '線、色、雰囲気など守りたいこと',
    styleReferenceTitle: '参考にしたい作品・画風',
    suggestedFields: '読み取り候補',
    theme: '作品概要',
    time: '時間帯',
    title: 'タイトル',
    tutorial: 'チュートリアル',
    webCreditManagement: 'クレジットの購入・請求管理は Web版で行ってください。',
    work: '作品',
    works: '作品'
  },
  en: {
    account: 'Account',
    apiSetupRequired: 'Set the API URL and Cognito values in .env.',
    applyDraft: 'Apply draft',
    applyStoryPlan: 'Apply story plan',
    applyTemplate: 'Layout template',
    atmosphere: 'Atmosphere',
    background: 'Background',
    billing: 'Billing',
    billingWebOnly: 'Purchases and plan changes are not available in mobile.',
    candidateToken: 'Candidate token',
    characters: 'Characters',
    chapter: 'Chapter',
    chapters: 'Chapters',
    confirmPage: 'Confirm page',
    confirmReference: 'Confirm reference',
    continuityNote: 'Continuity note',
    create: 'Create',
    createChapter: 'Create chapter',
    createEpisode: 'Create episode',
    createScene: 'Create scene',
    createWork: 'Create work',
    credits: 'Credits',
    description: 'Description',
    dialogue: 'Dialogue',
    dialogueMode: 'Dialogue mode',
    emptyCharacters: 'No characters yet.',
    emptyChapters: 'No chapters yet.',
    emptyEpisodes: 'No episodes yet.',
    emptyPages: 'No pages yet.',
    emptyScenes: 'No scenes yet.',
    emptyWorks: 'No works yet.',
    episode: 'Episode',
    episodes: 'Episodes',
    estimatedPages: 'Estimated pages',
    frames: 'Frames',
    fullDraft: 'Full draft',
    generate: 'Generate page',
    generateReference: 'Generate reference',
    guide: 'Guide',
    imageImport: 'Import image',
    insufficientCreditsWeb: 'Credit balance is insufficient. Manage credits on the web version.',
    instruction: 'Instruction',
    language: 'Language',
    location: 'Location',
    login: 'Sign in or create an account',
    logout: 'Log out',
    lyraSubtitle: 'Lyra AI manga editor',
    name: 'Name',
    notes: 'Notes',
    pageList: 'Page list',
    pagePurpose: 'Page purpose',
    pageSettings: 'Page settings',
    pageSkeleton: 'Generate page plan',
    pages: 'Pages',
    panelRole: 'Role',
    panels: 'Panels',
    panelSize: 'Size',
    plan: 'Current plan',
    profile: 'Profile',
    promptSupplement: 'Prompt supplement',
    purpose: 'Purpose',
    referenceSet: 'Reference set',
    reopenPage: 'Reopen',
    refresh: 'Refresh',
    save: 'Save',
    saveScene: 'Save scene',
    scene: 'Scene',
    scenes: 'Scenes',
    selectEpisodeFirst: 'Select or create an episode in Story first.',
    selectWorkFirst: 'Select or create a work in Story first.',
    situation: 'Situation',
    sourceS3Key: 'S3 key',
    story: 'Story',
    storyAi: 'Story AI',
    storyFailure: 'Story operation failed. Check the API response.',
    styleReference: 'Art style reference',
    styleReferenceNotes: 'Lines, colors, mood, and other constraints',
    styleReferenceTitle: 'Work or art style to reference',
    suggestedFields: 'Suggested fields',
    theme: 'Work overview',
    time: 'Time',
    title: 'Title',
    tutorial: 'Tutorial',
    webCreditManagement: 'Manage credit purchases and billing on the web version.',
    work: 'Work',
    works: 'Works'
  }
};

export type TranslationKey =
  | BaseTranslationKey
  | GeneratedTranslationKey
  | ComponentTranslationKey
  | ScreenTranslationKey
  | SharedTranslationKey;

const translations: Record<UiLanguage, Record<TranslationKey, string>> = {
  ja: {
    ...baseTranslations.ja,
    ...generatedTranslations.ja,
    ...componentTranslations.ja,
    ...screenTranslations.ja,
    ...sharedTranslations.ja
  },
  en: {
    ...baseTranslations.en,
    ...generatedTranslations.en,
    ...componentTranslations.en,
    ...screenTranslations.en,
    ...sharedTranslations.en
  }
};

export type MessageParameters = Readonly<Record<string, string | number>>;

export const formatMessageTemplate = (
  template: string,
  parameters: MessageParameters
): string =>
  template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? String(parameters[name])
      : placeholder
  );

export const t = (
  language: UiLanguage,
  key: TranslationKey,
  parameters?: MessageParameters
): string => {
  const template = translations[language][key];
  return parameters === undefined
    ? template
    : formatMessageTemplate(template, parameters);
};
