import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import {
  ensureOwnedPageImageKey,
  ensurePageImageKeyForPage,
} from '../storage/StoredImageKeyPolicy.js';
import type { PageThumbnailRendererPort } from './PageThumbnailRenderer.js';

export interface PageThumbnail {
  imageData: Buffer;
  mimeType: 'image/webp';
  revision: string;
}

export interface PageThumbnailServicePort {
  getGeneratedImageThumbnailRevision(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<string>;
  getGeneratedImageThumbnail(
    userId: string,
    pageId: string,
    organizationId?: string | null,
  ): Promise<PageThumbnail>;
}

export class PageThumbnailService implements PageThumbnailServicePort {
  public constructor(
    private readonly pageRepository: Pick<PageRepository, 'findPageByIdAndUserId'>,
    private readonly storedImageLoader: StoredImageLoaderPort,
    private readonly thumbnailRenderer: PageThumbnailRendererPort,
  ) {}

  public async getGeneratedImageThumbnailRevision(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<string> {
    const source = await this.resolveThumbnailSource(userId, pageId, organizationId);
    return source.revision;
  }

  public async getGeneratedImageThumbnail(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<PageThumbnail> {
    const source = await this.resolveThumbnailSource(userId, pageId, organizationId);
    const image = await this.storedImageLoader.loadByS3Key(source.s3Key);
    const thumbnail = await this.thumbnailRenderer.render(image);

    return {
      ...thumbnail,
      revision: source.revision,
    };
  }

  private async resolveThumbnailSource(
    userId: string,
    pageId: string,
    organizationId: string | null,
  ): Promise<{ revision: string; s3Key: string }> {
    const page = await this.pageRepository.findPageByIdAndUserId(
      pageId,
      userId,
      organizationId,
    );
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const generatedImage = page.generatedImage;
    if (generatedImage === null || generatedImage.s3Key === null) {
      throw new ValidationError('Page does not have a generated image thumbnail');
    }

    if (organizationId === null) {
      ensureOwnedPageImageKey(
        generatedImage.s3Key,
        userId,
        pageId,
        'generated page thumbnail key',
      );
    } else {
      ensurePageImageKeyForPage(
        generatedImage.s3Key,
        pageId,
        'generated page thumbnail key',
      );
    }

    return {
      revision: generatedImage.generatedAt ?? page.updatedAt.toISOString(),
      s3Key: generatedImage.s3Key,
    };
  }
}
