import { NotFoundError } from '../../domain/errors/index.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { EntityReferenceRepository } from '../../repositories/EntityRepository.js';

export interface ExportedEntityReferenceImage {
  imageData: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface EntityReferenceImageExportServicePort {
  exportReferenceImage(
    userId: string,
    entityId: string,
    refId: string,
  ): Promise<ExportedEntityReferenceImage>;
}

export class EntityReferenceImageExportService implements EntityReferenceImageExportServicePort {
  public constructor(
    private readonly entityRepository: EntityReferenceRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
  ) {}

  public async exportReferenceImage(
    userId: string,
    entityId: string,
    refId: string,
  ): Promise<ExportedEntityReferenceImage> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    const referenceImage = entity.referenceSet.images.find((image) => image.refId === refId);
    if (referenceImage === undefined) {
      throw new NotFoundError('Reference image not found');
    }

    return this.storedImageLoader.loadByS3Key(referenceImage.s3Key);
  }
}
