import { assertImageDeliveryAllowed, type ImageDeliveryAudience } from '../../domain/generation/ImageAccessPolicy.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { resolveEntityImageProvenance } from './EntityImageProvenance.js';
import { NotFoundError } from '../../domain/errors/index.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { EntityReferenceRepository } from '../../repositories/EntityRepository.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';
import { ensureAllowedReferenceSourceKey } from './EntityReferenceSourceKeyPolicy.js';

export interface ExportedEntityReferenceImage {
  imageData: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface EntityReferenceImageExportServicePort {
  exportReferenceImage(
    userId: string,
    entityId: string,
    refId: string,
    organizationId?: string | null,
    audience?: ImageDeliveryAudience,
  ): Promise<ExportedEntityReferenceImage>;
  exportCandidateImage(
    userId: string,
    entityId: string,
    s3Key: string,
    organizationId?: string | null,
    audience?: ImageDeliveryAudience,
  ): Promise<ExportedEntityReferenceImage>;
}

export class EntityReferenceImageExportService implements EntityReferenceImageExportServicePort {
  public constructor(
    private readonly entityRepository: EntityReferenceRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
    private readonly jobs?: Pick<GenerationJobRepository, 'findByIdAndUserId'>,
  ) {}

  public async exportReferenceImage(
    userId: string,
    entityId: string,
    refId: string,
    organizationId: string | null = null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<ExportedEntityReferenceImage> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    const referenceImage = entity.referenceSet.images.find((image) => image.refId === refId);
    if (referenceImage === undefined) {
      throw new NotFoundError('Reference image not found');
    }

    assertImageDeliveryAllowed(referenceImage, audience);
    ensureOwnedEntityReferenceImageKey(referenceImage.s3Key, entity.userId, entity.entityId);
    return this.storedImageLoader.loadByS3Key(referenceImage.s3Key);
  }

  public async exportCandidateImage(
    userId: string,
    entityId: string,
    s3Key: string,
    organizationId: string | null = null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<ExportedEntityReferenceImage> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    ensureAllowedReferenceSourceKey(s3Key, userId, entity.entityId, 's3_key');
    const provenance = await resolveEntityImageProvenance({ userId, entityId, organizationId, s3Key, references: entity.referenceSet.images, jobs: this.jobs });
    assertImageDeliveryAllowed(provenance, audience);
    return this.storedImageLoader.loadByS3Key(s3Key);
  }
}
