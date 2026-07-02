import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import { ensureOwnedPageImageKey, ensurePageImageKeyForPage } from '../storage/StoredImageKeyPolicy.js';

export interface ExportedPageImage {
  imageData: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface PageExportServicePort {
  exportGeneratedImage(userId: string, pageId: string, organizationId?: string | null): Promise<ExportedPageImage>;
}

export class PageExportService implements PageExportServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
    private readonly organizationService?: OrganizationServicePort,
  ) {}

  public async exportGeneratedImage(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<ExportedPageImage> {
    const page = await this.pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    if (page.generatedImage === null || page.generatedImage.s3Key === null) {
      throw new ValidationError('Page does not have an exportable generated image');
    }

    if (organizationId === null) {
      ensureOwnedPageImageKey(page.generatedImage.s3Key, userId, pageId, 'generated page image key');
    } else {
      ensurePageImageKeyForPage(page.generatedImage.s3Key, pageId, 'generated page image key');
    }
    const exportedImage = await this.storedImageLoader.loadByS3Key(page.generatedImage.s3Key);
    await this.recordEnterpriseExport(userId, pageId, organizationId);
    return exportedImage;
  }

  private async recordEnterpriseExport(
    userId: string,
    pageId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (organizationId === null || this.organizationService === undefined) {
      return;
    }

    try {
      const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId, organizationId);
      if (page === null) {
        return;
      }
      await this.organizationService.recordWorkExported({
        organizationId,
        userId,
        workId: page.workId,
        pageId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[page-export] failed to record enterprise page export ${pageId}: ${reason}`);
    }
  }
}
