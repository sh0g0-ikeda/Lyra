export const navigationTranslations = {
  ja: {
    'navigation.openStory': 'ストーリーを開く',
    'navigation.manga': '漫画',
    'navigation.assets': 'アセット',
    'navigation.myPage': 'マイページ',
    'navigation.workflow': '漫画の制作工程',
    'navigation.library': '漫画一覧',
    'navigation.libraryHelp': '作品・章・話を選び、続きから制作できます。',
    'navigation.chooseWork': '作品・章・話を選ぶ',
    'navigation.createManga': '漫画を作成',
    'navigation.resume': '選択中の話を続ける',
    'navigation.resumeAt': '「{step}」から再開',
    'navigation.nextCharacters': '次へ：キャラクター',
    'navigation.nextPages': '次へ：ページ',
    'navigation.previous': '前の工程へ',
    'navigation.guide': '作り方を見る',
    'navigation.openWork': '{title}を開く',
    'navigation.moreWorks': '作品をさらに読み込む',
    'navigation.loadingResume': '保存済みの制作状況を読み込み中…',
    'navigation.retryResume': '制作状況を再読み込み'
  },
  en: {
    'navigation.openStory': 'Open story',
    'navigation.manga': 'Manga',
    'navigation.assets': 'Assets',
    'navigation.myPage': 'My Page',
    'navigation.workflow': 'Manga creation steps',
    'navigation.library': 'Manga library',
    'navigation.libraryHelp': 'Choose a work, chapter, and episode to continue creating.',
    'navigation.chooseWork': 'Choose work, chapter, and episode',
    'navigation.createManga': 'Create manga',
    'navigation.resume': 'Continue selected episode',
    'navigation.resumeAt': 'Resume at {step}',
    'navigation.nextCharacters': 'Next: Characters',
    'navigation.nextPages': 'Next: Pages',
    'navigation.previous': 'Previous step',
    'navigation.guide': 'How to create manga',
    'navigation.openWork': 'Open {title}',
    'navigation.moreWorks': 'Load more works',
    'navigation.loadingResume': 'Loading saved creation progress…',
    'navigation.retryResume': 'Reload creation progress'
  }
} as const;

export type NavigationTranslationKey = keyof typeof navigationTranslations.ja;
