import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import { ensureOwnedPageImageKey } from '../storage/StoredImageKeyPolicy.js';

export interface ExportedPageImage {
  imageData: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface PageExportServicePort {
  exportGeneratedImage(userId: string, pageId: string): Promise<ExportedPageImage>;
}

export class PageExportService implements PageExportServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
  ) {}

  public async exportGeneratedImage(userId: string, pageId: string): Promise<ExportedPageImage> {
    const page = await this.pageRepository.findPageByIdAndUserId(pageId, userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    if (page.generatedImage === null || page.generatedImage.s3Key === null) {
      throw new ValidationError('Page does not have an exportable generated image');
    }

    ensureOwnedPageImageKey(page.generatedImage.s3Key, userId, pageId, 'generated page image key');
    return this.storedImageLoader.loadByS3Key(page.generatedImage.s3Key);
  }
}
