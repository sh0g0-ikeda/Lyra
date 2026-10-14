import { canDisplayMobileImage } from '@/domain/imageAccess';
import type { RemoteImageSource } from '@/domain/imageSourceCandidates';
import type { ChapterRecord, EpisodeRecord, PageRecord } from '@/domain/types';

export interface MangaReadingEpisode {
  chapterId: string;
  chapterOrdinal: number;
  chapterTitle: string | null;
  displayOrdinal: number;
  episode: EpisodeRecord;
  episodeId: string;
}

type ReaderChapter = Pick<ChapterRecord, 'id' | 'order' | 'title'>;
type ReaderEpisode = EpisodeRecord;

export function buildMangaReadingOrder(
  chapters: readonly ReaderChapter[],
  episodesByChapter: Readonly<Record<string, readonly ReaderEpisode[] | undefined>>,
): MangaReadingEpisode[] {
  const orderedChapters = [...chapters].sort((left, right) => left.order - right.order);
  const episodes: MangaReadingEpisode[] = [];

  for (const [chapterIndex, chapter] of orderedChapters.entries()) {
    const chapterEpisodes = [...(episodesByChapter[chapter.id] ?? [])]
      .sort((left, right) => left.order - right.order);
    for (const episode of chapterEpisodes) {
      episodes.push({
        chapterId: chapter.id,
        chapterOrdinal: chapterIndex + 1,
        chapterTitle: chapter.title,
        displayOrdinal: episodes.length + 1,
        episode,
        episodeId: episode.id,
      });
    }
  }

  return episodes;
}

export function findAdjacentEpisode(
  episodes: readonly MangaReadingEpisode[],
  episodeId: string,
  direction: 'next' | 'previous',
): MangaReadingEpisode | null {
  const index = episodes.findIndex((episode) => episode.episodeId === episodeId);
  if (index < 0) return null;
  return episodes[index + (direction === 'next' ? 1 : -1)] ?? null;
}
export interface MangaReaderImageScope { sessionKey: string; organizationId: string | null; episodeId: string; }

export function readerCdnImageSource(page: PageRecord, scope: MangaReaderImageScope): RemoteImageSource | null {
  const uri = page.generated_image?.cdn_url;
  if (page.episode_id !== scope.episodeId || !canDisplayMobileImage(page.generated_image) || uri === null || uri === undefined) return null;
  try { if (new URL(uri).protocol !== 'https:') return null; } catch { return null; }
  const revision = page.generated_image?.generated_at ?? page.updated_at;
  return { uri, cacheKey: ['reader-image', scope.sessionKey, scope.organizationId ?? 'personal', scope.episodeId, page.id, revision].map(encodeURIComponent).join(':') };
}