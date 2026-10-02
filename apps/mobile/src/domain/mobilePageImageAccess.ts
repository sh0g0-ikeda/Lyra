import { canDisplayMobileImage } from '@/domain/imageAccess';
import type { PageRecord } from '@/domain/types';
export function canUseMobilePageImage(page: Pick<PageRecord, 'generated_image'> | null | undefined): boolean {
  return page?.generated_image != null && canDisplayMobileImage(page.generated_image);
}
export function mobilePageExportCandidates(pages: readonly PageRecord[]): { id: string; pageNumber: number; hasGeneratedImage: boolean }[] {
  return pages.map((page) => ({ id: page.id, pageNumber: page.page_number, hasGeneratedImage: canUseMobilePageImage(page) }));
}
