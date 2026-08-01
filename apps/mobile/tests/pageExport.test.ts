import { describe, expect, it } from 'vitest';

import {
  PageExportSelectionError,
  buildEpisodeExportPayload
} from '@/domain/pageExport';

const pages = [
  { id: 'page-3', pageNumber: 3, hasGeneratedImage: true },
  { id: 'page-1', pageNumber: 1, hasGeneratedImage: true },
  { id: 'page-2', pageNumber: 2, hasGeneratedImage: false }
];

describe('page export', () => {
  it('選択された生成済みページだけをページ順でexport payloadへ含める', () => {
    expect(
      buildEpisodeExportPayload({
        filename: '第一話',
        format: 'zip',
        mode: 'selected',
        pages,
        selectedPageIds: ['page-3', 'page-2', 'page-1']
      })
    ).toEqual({
      filename: '第一話',
      format: 'zip',
      page_ids: ['page-1', 'page-3']
    });
  });

  it('全選択では生成済みページだけをPDFへ含める', () => {
    expect(
      buildEpisodeExportPayload({
        filename: '  ',
        format: 'pdf',
        mode: 'all',
        pages,
        selectedPageIds: []
      })
    ).toEqual({
      format: 'pdf',
      page_ids: ['page-1', 'page-3']
    });
  });

  it('対象ページがない場合は空jobを作らない', () => {
    expect(() =>
      buildEpisodeExportPayload({
        filename: 'empty',
        format: 'pdf',
        mode: 'selected',
        pages,
        selectedPageIds: ['page-2']
      })
    ).toThrowError(
      expect.objectContaining<Partial<PageExportSelectionError>>({
        code: 'NO_EXPORTABLE_PAGES'
      })
    );
  });

  it('backend上限の100ページを超えるrequestを端末でも拒否する', () => {
    const manyPages = Array.from({ length: 101 }, (_, index) => ({
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      hasGeneratedImage: true
    }));

    expect(() =>
      buildEpisodeExportPayload({
        filename: 'too-many',
        format: 'zip',
        mode: 'all',
        pages: manyPages,
        selectedPageIds: []
      })
    ).toThrowError(
      expect.objectContaining<Partial<PageExportSelectionError>>({
        code: 'TOO_MANY_EXPORT_PAGES'
      })
    );
  });
});
