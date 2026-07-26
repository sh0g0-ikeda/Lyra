import type { PageRecord } from '@/domain/types';

export function selectPageForEpisode(
  page: PageRecord | null | undefined,
  activeEpisodeId: string | null
): PageRecord | null {
  if (
    page === null ||
    page === undefined ||
    activeEpisodeId === null ||
    page.episode_id !== activeEpisodeId
  ) {
    return null;
  }
  return page;
}
