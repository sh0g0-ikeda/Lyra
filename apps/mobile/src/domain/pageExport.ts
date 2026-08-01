import type { CreateEpisodeExportPayload, ExportFormat } from '@/domain/types';

const MAX_EXPORT_PAGE_COUNT = 100;
const MAX_EXPORT_FILENAME_LENGTH = 160;

export interface PageExportCandidate {
  id: string;
  pageNumber: number;
  hasGeneratedImage: boolean;
}

export type PageExportMode = 'selected' | 'all';
export type PageExportSelectionErrorCode =
  | 'NO_EXPORTABLE_PAGES'
  | 'TOO_MANY_EXPORT_PAGES'
  | 'EXPORT_FILENAME_TOO_LONG';

export class PageExportSelectionError extends Error {
  public readonly code: PageExportSelectionErrorCode;

  public constructor(code: PageExportSelectionErrorCode, message: string) {
    super(message);
    this.name = 'PageExportSelectionError';
    this.code = code;
  }
}

export function buildEpisodeExportPayload(input: {
  filename: string;
  format: ExportFormat;
  mode: PageExportMode;
  pages: readonly PageExportCandidate[];
  selectedPageIds: readonly string[];
}): CreateEpisodeExportPayload {
  const selectedIds = new Set(input.selectedPageIds);
  const pageIds = input.pages
    .filter(
      (page) =>
        page.hasGeneratedImage &&
        (input.mode === 'all' || selectedIds.has(page.id))
    )
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => page.id);

  if (pageIds.length === 0) {
    throw new PageExportSelectionError(
      'NO_EXPORTABLE_PAGES',
      'No generated pages were selected for export.'
    );
  }
  if (pageIds.length > MAX_EXPORT_PAGE_COUNT) {
    throw new PageExportSelectionError(
      'TOO_MANY_EXPORT_PAGES',
      `An export can contain at most ${MAX_EXPORT_PAGE_COUNT} pages.`
    );
  }

  const filename = input.filename.trim();
  if (filename.length > MAX_EXPORT_FILENAME_LENGTH) {
    throw new PageExportSelectionError(
      'EXPORT_FILENAME_TOO_LONG',
      `The export filename must be ${MAX_EXPORT_FILENAME_LENGTH} characters or fewer.`
    );
  }

  return {
    format: input.format,
    page_ids: pageIds,
    ...(filename.length === 0 ? {} : { filename })
  };
}
