import type { PageRecord } from '@/domain/types';

export interface OrderedPanel {
  id: string;
  order: number;
}

/** Initial entry and a newly applied episode plan open the first editable unit. */
export function initialPageAndPanel(
  pages: readonly PageRecord[],
  panels: readonly OrderedPanel[]
): { pageId: string | null; panelId: string | null } {
  const page = [...pages].sort((left, right) => left.page_number - right.page_number || left.id.localeCompare(right.id))[0];
  if (page === undefined) return { pageId: null, panelId: null };
  const panel = [...panels].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
  return { pageId: page.id, panelId: panel?.id ?? null };
}

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
