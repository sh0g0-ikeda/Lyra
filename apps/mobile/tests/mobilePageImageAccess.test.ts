import { describe, expect, it } from 'vitest';
import { canUseMobilePageImage, mobilePageExportCandidates } from '@/domain/mobilePageImageAccess';
import { buildEpisodeExportPayload } from '@/domain/pageExport';
import type { PageRecord } from '@/domain/types';
const page = (id: string, model?: string): PageRecord => ({ id, page_number: Number(id), generated_image: { image_model: model, generation_mode: null, generated_at: null } } as PageRecord);
describe('Mobileページ画像の公開範囲', () => {
  it('保存画像のないページとunsupported画像をpreview/download対象にしない', () => {
    expect(canUseMobilePageImage(null)).toBe(false);
    expect(canUseMobilePageImage({ generated_image: null })).toBe(false);
    expect(canUseMobilePageImage(page('1', 'hy4-preview'))).toBe(false);
    expect(canUseMobilePageImage(page('2', 'gpt-image-2'))).toBe(true);
    expect(canUseMobilePageImage(page('3'))).toBe(true);
  });
  it('選択/export-allのどちらでもunsupported画像を含めない', () => {
    const pages = mobilePageExportCandidates([page('1', 'hy4-preview'), page('2', 'gpt-image-2'), page('3')]);
    for (const mode of ['all', 'selected'] as const) expect(buildEpisodeExportPayload({ pages, mode, selectedPageIds: ['1', '2', '3'], filename: 'manga', format: 'pdf' }).page_ids).toEqual(['2', '3']);
  });
});
