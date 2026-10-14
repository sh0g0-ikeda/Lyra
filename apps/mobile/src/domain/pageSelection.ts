import type { PageRecord } from '@/domain/types';

export interface OrderedPanel {
  id: string;
  order: number;
  page_id?: string;
}

/** Initial entry and a newly applied episode plan open the first editable unit. */
export function initialPageAndPanel(
  pages: readonly PageRecord[],
  panels: readonly OrderedPanel[]
): { pageId: string | null; panelId: string | null } {
  const page = [...pages].sort((left, right) => left.page_number - right.page_number || left.id.localeCompare(right.id))[0];
  if (page === undefined) return { pageId: null, panelId: null };
  return { pageId: page.id, panelId: firstPanelForPage(page.id, panels) };
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


export function firstPanelForPage(pageId: string, panels: readonly OrderedPanel[]): string | null {
  const panel = panels.filter((item) => item.page_id === undefined || item.page_id === pageId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
  return panel?.id ?? null;
}

export function adjacentPage(
  pages: readonly PageRecord[], selectedId: string, direction: -1 | 1
): PageRecord | null {
  const selected = pages.find((page) => page.id === selectedId);
  if (selected === undefined) return null;
  const ordered = pages.filter((page) => page.episode_id === selected.episode_id)
    .sort((left, right) => left.page_number - right.page_number || left.id.localeCompare(right.id));
  const index = ordered.findIndex((page) => page.id === selectedId);
  return ordered[index + direction] ?? null;
}
