import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ENTITY_REFERENCE_UPLOAD_MAX_TOKEN_LENGTH,
  ENTITY_REFERENCE_UPLOAD_PRESIGN_TTL_SECONDS,
  ENTITY_REFERENCE_UPLOAD_PURPOSE,
  ENTITY_REFERENCE_UPLOAD_TOKEN_BYTES,
  extensionForEntityReferenceUploadMimeType,
  imageDataMatchesEntityReferenceUploadMimeType,
  isEntityReferenceUploadMimeType,
  isEntityReferenceUploadSize,
  type EntityReferenceUploadMimeType,
} from '../../domain/constants/entityReferenceUpload.js';
import {
  ConfigurationError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type { EntityType } from '../../domain/types/entity.js';
import type {
  EntityImportAnalysis,
  EntityReferenceContext,
} from '../../domain/types/entityReference.js';
import type {
  EntityReferenceUploadTokenRepository,
} from '../../repositories/EntityReferenceUploadTokenRepository.js';
import type { EntityReferenceRepository } from '../../repositories/EntityRepository.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type { EntityReferenceServicePort } from './EntityReferenceService.js';
import type {
  EntityReferenceUploadStoragePort,
} from './EntityReferenceUploadStorage.js';

export interface EntityReferenceUploadServicePort {
  createPresignedUpload(
    userId: string,
    input: {
      mimeType: EntityReferenceUploadMimeType;
      sizeBytes: number;
      entityId?: string | null;
    },
    organizationId?: string | null,
  ): Promise<{
    uploadUrl: string;
    uploadToken: string;
    expiresAt: Date;
    uploadHeaders: {
      'Content-Type': EntityReferenceUploadMimeType;
      'x-amz-server-side-encryption': 'AES256';
    };
  }>;
  importUploadedImage(
    userId: string,
    input: {
      uploadToken: string;
      entityType: EntityType;
      entityId?: string | null;
    },
    organizationId?: string | null,
  ): Promise<EntityReferenceUploadImportResult>;
}

export interface EntityReferenceUploadImportResult extends EntityImportAnalysis {
  entityId: string | null;
}

export interface EntityReferenceUploadServiceDependencies {
  uploadTokenRepository: EntityReferenceUploadTokenRepository;
  uploadStorage: EntityReferenceUploadStoragePort;
  entityReferenceRepository: Pick<
    EntityReferenceRepository,
    'findReferenceContextByIdAndUserId'
  >;
  entityReferenceService: Pick<EntityReferenceServicePort, 'importUploadedImage'>;
  organizationService?: Pick<OrganizationServicePort, 'requireMembership'>;
  now?: () => Date;
  tokenGenerator?: () => string;
}

export class EntityReferenceUploadService implements EntityReferenceUploadServicePort {
  private readonly now: () => Date;
  private readonly tokenGenerator: () => string;

  public constructor(
    private readonly dependencies: EntityReferenceUploadServiceDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.tokenGenerator = dependencies.tokenGenerator
      ?? (() => randomBytes(ENTITY_REFERENCE_UPLOAD_TOKEN_BYTES).toString('base64url'));
  }

  public async createPresignedUpload(
    userId: string,
    input: {
      mimeType: EntityReferenceUploadMimeType;
      sizeBytes: number;
      entityId?: string | null;
    },
    organizationId: string | null = null,
  ): Promise<{
    uploadUrl: string;
    uploadToken: string;
    expiresAt: Date;
    uploadHeaders: {
      'Content-Type': EntityReferenceUploadMimeType;
      'x-amz-server-side-encryption': 'AES256';
    };
  }> {
    assertUploadMetadata(input.mimeType, input.sizeBytes);
    await this.requireScope(userId, organizationId);
    const entityId = input.entityId ?? null;
    await this.requireBoundEntity(userId, entityId, organizationId);

    const uploadToken = this.tokenGenerator();
    if (
      uploadToken.length === 0
      || uploadToken.length > ENTITY_REFERENCE_UPLOAD_MAX_TOKEN_LENGTH
    ) {
      throw new ConfigurationError('Entity reference upload token generator is invalid');
    }

    const expiresAt = new Date(
      this.now().getTime() + ENTITY_REFERENCE_UPLOAD_PRESIGN_TTL_SECONDS * 1000,
    );
    const s3Key = buildTemporaryUploadKey(userId, input.mimeType);
    const uploadUrl = await this.dependencies.uploadStorage.createPresignedPutUrl({
      s3Key,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: ENTITY_REFERENCE_UPLOAD_PRESIGN_TTL_SECONDS,
    });
    await this.dependencies.uploadTokenRepository.create({
      tokenHash: hashUploadToken(uploadToken),
      userId,
      organizationId,
      entityId,
      purpose: ENTITY_REFERENCE_UPLOAD_PURPOSE,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      s3Key,
      expiresAt,
    });

    return {
      uploadUrl,
      uploadToken,
      expiresAt,
      uploadHeaders: {
        'Content-Type': input.mimeType,
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }

  public async importUploadedImage(
    userId: string,
    input: {
      uploadToken: string;
      entityType: EntityType;
      entityId?: string | null;
    },
    organizationId: string | null = null,
  ): Promise<EntityReferenceUploadImportResult> {
    if (
      input.uploadToken.length === 0
      || input.uploadToken.length > ENTITY_REFERENCE_UPLOAD_MAX_TOKEN_LENGTH
    ) {
      throw invalidUploadError();
    }
    await this.requireScope(userId, organizationId);

    const tokenLookup = {
      tokenHash: hashUploadToken(input.uploadToken),
      userId,
      organizationId,
      purpose: ENTITY_REFERENCE_UPLOAD_PURPOSE,
    } as const;
    const upload = await this.dependencies.uploadTokenRepository.inspect(tokenLookup);
    if (
      upload === null
      || (input.entityId !== undefined && input.entityId !== upload.entityId)
    ) {
      throw invalidUploadError();
    }

    const boundEntity = await this.requireBoundEntity(
      userId,
      upload.entityId,
      organizationId,
    );
    if (boundEntity !== null && boundEntity.entityType !== input.entityType) {
      throw invalidUploadError();
    }

    const image = await this.dependencies.uploadStorage.loadUploadedImage({
      s3Key: upload.s3Key,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
    });
    if (
      image === null
      || image.mimeType !== upload.mimeType
      || image.imageData.length !== upload.sizeBytes
      || !imageDataMatchesEntityReferenceUploadMimeType(
        image.imageData,
        upload.mimeType,
      )
    ) {
      throw new ValidationError('Uploaded image does not match the approved upload');
    }

    const stabilizedImage = await this.dependencies.uploadStorage.stabilizeUploadedImage({
      sourceS3Key: upload.s3Key,
      destinationS3Key: buildTemporaryUploadKey(userId, upload.mimeType),
      mimeType: upload.mimeType,
      eTag: image.eTag,
    });
    const consumedUpload = await this.dependencies.uploadTokenRepository.consume(tokenLookup);
    if (consumedUpload === null || consumedUpload.id !== upload.id) {
      throw invalidUploadError();
    }

    const analysis = await this.dependencies.entityReferenceService.importUploadedImage(
      userId,
      {
        entityType: input.entityType,
        imageData: image.imageData,
        mimeType: image.mimeType,
        tmpImageS3Key: stabilizedImage.s3Key,
        tmpImageCdnUrl: stabilizedImage.cdnUrl,
      },
      organizationId,
    );

    return {
      ...analysis,
      entityId: upload.entityId,
    };
  }

  private async requireScope(
    userId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (organizationId === null) {
      return;
    }
    if (this.dependencies.organizationService === undefined) {
      throw new ConfigurationError(
        'Organization service is required for entity reference upload',
      );
    }
    await this.dependencies.organizationService.requireMembership(
      organizationId,
      userId,
      'generate',
    );
  }

  private async requireBoundEntity(
    userId: string,
    entityId: string | null,
    organizationId: string | null,
  ): Promise<EntityReferenceContext | null> {
    if (entityId === null) {
      return null;
    }
    const entity = await this.dependencies.entityReferenceRepository
      .findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }
    return entity;
  }
}

function assertUploadMetadata(
  mimeType: string,
  sizeBytes: number,
): asserts mimeType is EntityReferenceUploadMimeType {
  if (
    !isEntityReferenceUploadMimeType(mimeType)
    || !isEntityReferenceUploadSize(sizeBytes)
  ) {
    throw new ValidationError('Upload metadata is invalid');
  }
}

function hashUploadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildTemporaryUploadKey(
  userId: string,
  mimeType: EntityReferenceUploadMimeType,
): string {
  return `tmp/${userId}/entities/imports/${randomUUID()}.${extensionForEntityReferenceUploadMimeType(mimeType)}`;
}

function invalidUploadError(): ValidationError {
  return new ValidationError('Upload is invalid or has expired');
}
