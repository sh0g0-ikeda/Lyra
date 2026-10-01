import type { UiLanguage } from '@/domain/types';
// Copy follows the explicit 2026-09-06 editor design; input examples never become saved defaults.
const messages = {
  ja: {
    storyTitle: '1 ストーリー', charactersTitle: '2 キャラクター', pagesTitle: '3 ページ',
    storyEntry: 'まずはストーリーを入力', storyAi: 'AIでストーリーを改善', scenes: '背景や時間帯の設定',
    storyAiHelp: 'あなたの指示に従ってストーリーを改善したり、話を広げたりします！',
    characterList: 'キャラ一覧', createCharacter: 'キャラ新規作成', optionalFields: 'すべての項目を埋める必要はありません',
    importHelp: 'アップロードした画像のキャラクターを漫画に登場させられます！',
    additionalDetails: '自由入力欄', additionalHelp: '選択肢にない特徴などを記入出来ます', genericTraits: '物体・人外の特徴',
    characterPreview: '作成したキャラの画像生成', characterPreviewHelp: 'プレビュー画像を作り、気に入ったら「確定」してください',
    pageList: 'ページ一覧', pageListHelp: 'タップで選択したページを編集', artStyle: '画風の参考', storyFlow: '流れの概要',
    applyScene: '背景や時間帯の設定をページに反映', panelSettings: 'コマの設定', panelHelp: 'コマを選択して編集してください',
    fieldHelp: '入力のヒント', titleExample: '例：雨の駅での再会', storyExample: '例：主人公が駅で旧友と再会し、一緒に旅に出るまで',
    storyInputHelp: 'この話の出来事を順番に書きます。人物の行動や会話も含められます（最大8,000文字）。',
    titleHelp: 'この話を一覧で見分ける名前です（最大200文字）。',
    pagesExample: '例：4', pagesHelp: '今回この話から作成するページの枚数です。例の4は4ページを表します。',
    orderExample: '例：1', orderHelp: 'この話の中でのシーンの位置です。1は先頭、2はその次を表します。',
    locationExample: '例：夕方の駅のホーム', locationHelp: '場面の場所や背景を指定します（最大200文字）。',
    timeExample: '例：夏の夕方', timeHelp: '時間帯や季節を指定します（最大200文字）。',
    atmosphereExample: '例：雨上がりの静けさと再会の期待', atmosphereHelp: '場面の空気や感情の調子を書きます（最大2,000文字）。',
    searchChoices: '選択肢を検索', noChoices: '該当する選択肢はありません', selected: '選択中'
  },
  en: {
    storyTitle: '1 Story', charactersTitle: '2 Characters', pagesTitle: '3 Pages',
    storyEntry: 'Start by entering your story', storyAi: 'Improve your story with AI', scenes: 'Background and time settings',
    storyAiHelp: 'Improve or expand your story by following your instructions!',
    characterList: 'Character list', createCharacter: 'Create a character', optionalFields: 'You do not need to fill in every field.',
    importHelp: 'You can feature the character from an uploaded image in your manga!',
    additionalDetails: 'Additional details', additionalHelp: 'Add traits or details that are not available in the choices.', genericTraits: 'Object or non-human traits',
    characterPreview: 'Generate the character image', characterPreviewHelp: 'Generate a preview image, then select “Confirm” when you are happy with it.',
    pageList: 'Page list', pageListHelp: 'Tap a page to select and edit it.', artStyle: 'Art style reference', storyFlow: 'Story flow overview',
    applyScene: 'Apply background and time settings to the page', panelSettings: 'Panel settings', panelHelp: 'Select a panel to edit.',
    fieldHelp: 'Input tips', titleExample: 'Example: Reunion at the rainy station', storyExample: 'Example: The hero meets an old friend at the station, then they begin a journey.',
    storyInputHelp: 'Describe this episode’s events in order, including actions and dialogue (up to 8,000 characters).',
    titleHelp: 'A name that identifies this episode in the list (up to 200 characters).',
    pagesExample: 'Example: 4', pagesHelp: 'The number of pages to create for this episode. The example 4 means four pages.',
    orderExample: 'Example: 1', orderHelp: 'This scene’s position within the episode. 1 is first and 2 follows it.',
    locationExample: 'Example: A station platform at dusk', locationHelp: 'Set the location or background (up to 200 characters).',
    timeExample: 'Example: A summer evening', timeHelp: 'Set the time of day or season (up to 200 characters).',
    atmosphereExample: 'Example: Quiet after the rain, with anticipation of a reunion', atmosphereHelp: 'Describe the mood or emotional tone (up to 2,000 characters).',
    searchChoices: 'Search choices', noChoices: 'No matching choices', selected: 'Selected'
  }
} as const;
export function editorMessage(language: UiLanguage, key: keyof typeof messages.ja): string { return messages[language][key]; }
