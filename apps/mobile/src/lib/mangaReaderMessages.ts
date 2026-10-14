import type { UiLanguage } from '@/domain/types';

type ReaderMessageKey =
  | 'chapterHeading'
  | 'close'
  | 'emptyPages'
  | 'emptyWorks'
  | 'episodeFallback'
  | 'imageUnavailable'
  | 'loading'
  | 'loadingEpisodes'
  | 'loadingMorePages'
  | 'episodesUnavailable'
  | 'morePagesUnavailable'
  | 'notGenerated'
  | 'nextEpisode'
  | 'nextPage'
  | 'previousEpisode'
  | 'previousPage'
  | 'read'
  | 'reloadImage'
  | 'retryEpisodes'
  | 'retryMorePages'
  | 'retry'
  | 'vertical'
  | 'horizontalRtl'
  | 'workTotalEpisode';

const messages: Record<UiLanguage, Record<ReaderMessageKey, string>> = {
  ja: {
    chapterHeading: '{number}章 {title}',
    close: '閉じる', emptyPages: 'この話にはページがありません。', emptyWorks: '作品はまだありません。',
    episodeFallback: '無題の話', notGenerated: 'このページはまだ生成されていません。', imageUnavailable: '画像を読み込めません。再読み込みしてください。', loading: '読み込み中…', loadingEpisodes: '話一覧を読み込み中…', loadingMorePages: '続きのページを読み込み中…', episodesUnavailable: '話一覧を読み込めません。', morePagesUnavailable: '続きのページを読み込めません。',
    nextEpisode: '次話', nextPage: '次のページ', previousEpisode: '前話', previousPage: '前のページ', read: '読む',
    reloadImage: '画像を再読み込み', retry: '再試行', retryEpisodes: '話一覧を再試行', retryMorePages: '続きのページを再試行', vertical: '縦読み', horizontalRtl: '横読み（右開き）',
    workTotalEpisode: '作品通算{number}話',
  },
  en: {
    chapterHeading: 'Chapter {number} {title}',
    close: 'Close', emptyPages: 'This episode has no pages yet.', emptyWorks: 'No works yet.',
    episodeFallback: 'Untitled episode', notGenerated: 'This page has not been generated yet.', imageUnavailable: 'The image could not be loaded. Reload it to try again.', loading: 'Loading…', loadingEpisodes: 'Loading episodes…', loadingMorePages: 'Loading more pages…', episodesUnavailable: 'The episode list could not be loaded.', morePagesUnavailable: 'More pages could not be loaded.',
    nextEpisode: 'Next episode', nextPage: 'Next page', previousEpisode: 'Previous episode', previousPage: 'Previous page', read: 'Read',
    reloadImage: 'Reload image', retry: 'Retry', retryEpisodes: 'Retry episode list', retryMorePages: 'Retry more pages', vertical: 'Vertical', horizontalRtl: 'Horizontal (RTL)',
    workTotalEpisode: 'Episode {number}',
  },
};

export function readerMessage(
  language: UiLanguage,
  key: ReaderMessageKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  const template = messages[language][key];
  return values === undefined ? template : template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu, (match, name: string) => values[name] === undefined ? match : String(values[name]));
}
