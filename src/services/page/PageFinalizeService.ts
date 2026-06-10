import { ConflictError, ConfigurationError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { GeneratedPageImage, PageGenerationContext } from '../../domain/types/page.js';
import type { BalloonRepository } from '../../repositories/BalloonRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { FinalPageImageStoragePort } from '../../infrastructure/aws/S3FinalPageImageStorage.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { PageBalloonComposerPort } from './PageBalloonComposer.js';
import { ensureOwnedPageImageKey } from '../storage/StoredImageKeyPolicy.js';

export interface PageFinalizeServicePort {
  confirmPage(userId: string, pageId: string): Promise<void>;
  reopenPage(userId: string, pageId: string): Promise<void>;
}

export class PageFinalizeService implements PageFinalizeServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly balloonRepository: BalloonRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
    private readonly pageBalloonComposer: PageBalloonComposerPort,
    private readonly finalPageImageStorage: FinalPageImageStoragePort,
  ) {}

  public async confirmPage(userId: string, pageId: string): Promise<void> {
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensurePageCanConfirm(page);

    const generatedImage = requireGeneratedImage(page);
    ensureOwnedPageImageKey(generatedImage.s3Key, userId, pageId, 'generated page image key');
    const balloons = await this.balloonRepository.findBalloonsByPageIdAndUserId(pageId, userId);
    const finalizedImage = balloons.length === 0
      ? await this.finalPageImageStorage.finalizePageImage({
          userId,
          pageId,
          sourceS3Key: generatedImage.s3Key,
          generatedImage,
        })
      : await this.composeAndStoreFinalImage(userId, pageId, generatedImage, balloons);

    const updated = await this.pageRepository.updateGeneratedImageAndState(pageId, userId, {
      status: 'confirmed',
      generationMode: page.generationMode,
      generatedImage: finalizedImage,
    });
    if (!updated) {
      throw new ConfigurationError('Failed to confirm page');
    }
  }

  private async composeAndStoreFinalImage(
    userId: string,
    pageId: string,
    generatedImage: GeneratedPageImage & { s3Key: string },
    balloons: Awaited<ReturnType<BalloonRepository['findBalloonsByPageIdAndUserId']>>,
  ): Promise<GeneratedPageImage> {
    const sourceImage = await this.storedImageLoader.loadByS3Key(generatedImage.s3Key);
    const composedImage = await this.pageBalloonComposer.compose({
      pageImage: sourceImage.imageData,
      balloons,
    });

    return this.finalPageImageStorage.storeFinalPageImage({
      userId,
      pageId,
      imageData: composedImage.imageData,
      mimeType: composedImage.mimeType,
      generatedImage,
    });
  }

  public async reopenPage(userId: string, pageId: string): Promise<void> {
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(pageId, userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    if (page.status !== 'confirmed') {
      throw new ConflictError('Only confirmed pages can be reopened');
    }

    const updated = await this.pageRepository.updateGenerationState(pageId, userId, {
      status: 'editing',
      generationMode: page.generationMode,
    });
    if (!updated) {
      throw new ConfigurationError('Failed to reopen page');
    }
  }

  private ensurePageCanConfirm(page: PageGenerationContext): void {
    if (page.status === 'confirmed') {
      throw new ConflictError('Page is already confirmed');
    }

    if (page.status === 'generating') {
      throw new ConflictError('Page is still generating');
    }
  }
}

function requireGeneratedImage(page: PageGenerationContext): GeneratedPageImage & { s3Key: string } {
  if (page.generatedImage === null || page.generatedImage.s3Key === null) {
    throw new ValidationError('Page must have a generated image before confirmation');
  }

  return {
    ...page.generatedImage,
    s3Key: page.generatedImage.s3Key,
  };
}
