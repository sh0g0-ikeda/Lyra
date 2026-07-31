import { randomUUID } from 'node:crypto';
import { CREDIT_COSTS } from '../../domain/constants/credits.js';
import {
  ENTITY_IMPORT_MAX_FILE_SIZE_BYTES,
  ENTITY_REFERENCE_LIMITS,
} from '../../domain/constants/entityReference.js';
import {
  imageDataMatchesEntityReferenceUploadMimeType,
  type EntityReferenceUploadMimeType,
} from '../../domain/constants/entityReferenceUpload.js';
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type { EntityType } from '../../domain/types/entity.js';
import type {
  EntityImportAnalysis,
  EntityReferenceImage,
  EntityReferenceSet,
} from '../../domain/types/entityReference.js';
import { parseStructuredFields } from '../../lib/validators/entity.schema.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { isUniqueViolation } from '../../repositories/GenerationJobRepository.js';
import type { EntityReferenceRepository } from '../../repositories/EntityRepository.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type { EntityGenerationQueuePort } from './EntityGenerationQueue.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from './EntityGenerationRecoveryService.js';
import type { EntityImportAnalyzerPort } from '../../infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import type { EntityImageStoragePort } from '../../infrastructure/aws/S3EntityImageStorage.js';
import {
  DEFAULT_GENERATION_CAPACITY_LIMITS,
  type GenerationCapacityLimits,
} from '../generation/GenerationCapacityGuard.js';
import { ensureAllowedReferenceSourceKey } from './EntityReferenceSourceKeyPolicy.js';

export interface ConfirmEntityReferencesRequest {
  selectedS3Keys: string[];
  primaryS3Key?: string;
  promptSupplement?: string | null;
}

export interface EntityReferenceServicePort {
  getReferenceSet(userId: string, entityId: string, organizationId?: string | null): Promise<EntityReferenceSet>;
  importImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageBase64: string;
    },
    organizationId?: string | null,
  ): Promise<EntityImportAnalysis>;
  importUploadedImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageData: Buffer;
      mimeType: EntityReferenceUploadMimeType;
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
    organizationId?: string | null,
  ): Promise<EntityImportAnalysis>;
  enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    input?: {
      sourceS3Key?: string | null;
    },
    organizationId?: string | null,
  ): Promise<{ jobId: string }>;
  confirmReferences(
    userId: string,
    entityId: string,
    input: ConfirmEntityReferencesRequest,
    organizationId?: string | null,
  ): Promise<EntityReferenceSet>;
  deleteReference(
    userId: string,
    entityId: string,
    refId: string,
    organizationId?: string | null,
  ): Promise<EntityReferenceSet>;
}

/**
 * Handles entity import/reference workflows: temporary upload analysis, async
 * candidate generation, and reference_set confirmation.
 */
export class EntityReferenceService implements EntityReferenceServicePort {
  public constructor(
    private readonly entityRepository: EntityReferenceRepository,
    private readonly generationJobRepository: GenerationJobRepository,
    private readonly creditService: CreditServicePort,
    private readonly imageAnalyzer: EntityImportAnalyzerPort,
    private readonly imageStorage: EntityImageStoragePort,
    private readonly generationQueue: EntityGenerationQueuePort,
    private readonly capacityLimits: GenerationCapacityLimits = DEFAULT_GENERATION_CAPACITY_LIMITS,
    private readonly generationEnabled = true,
    private readonly recoveryService: EntityGenerationRecoveryServicePort = new NoopEntityGenerationRecoveryService(),
    private readonly importAnalysisEnabled = true,
    private readonly organizationService?: OrganizationServicePort,
  ) {}

  public async getReferenceSet(
    userId: string,
    entityId: string,
    organizationId: string | null = null,
  ): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    return entity.referenceSet;
  }

  public async importImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageBase64: string;
    },
    organizationId: string | null = null,
  ): Promise<EntityImportAnalysis> {
    const uploadedImage = parseImageDataUrl(input.imageBase64);
    if (uploadedImage.sizeBytes > ENTITY_IMPORT_MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('Image file is too large');
    }
    if (!imageDataMatchesDeclaredMimeType(uploadedImage)) {
      throw new ValidationError('image_base64 content does not match declared image type');
    }

    return this.analyzeImportedImage(userId, {
      entityType: input.entityType,
      imageData: uploadedImage.imageData,
      mimeType: uploadedImage.mimeType,
      dataUrl: input.imageBase64,
      storedImage: null,
    }, organizationId);
  }

  public async importUploadedImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageData: Buffer;
      mimeType: EntityReferenceUploadMimeType;
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
    organizationId: string | null = null,
  ): Promise<EntityImportAnalysis> {
    if (
      input.imageData.length > ENTITY_IMPORT_MAX_FILE_SIZE_BYTES
      || !imageDataMatchesEntityReferenceUploadMimeType(input.imageData, input.mimeType)
    ) {
      throw new ValidationError('Uploaded image does not match the approved upload');
    }

    return this.analyzeImportedImage(userId, {
      entityType: input.entityType,
      imageData: input.imageData,
      mimeType: input.mimeType,
      dataUrl: `data:${input.mimeType};base64,${input.imageData.toString('base64')}`,
      storedImage: {
        s3Key: input.tmpImageS3Key,
        cdnUrl: input.tmpImageCdnUrl,
      },
    }, organizationId);
  }

  public async enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    input?: {
      sourceS3Key?: string | null;
    },
    organizationId: string | null = null,
  ): Promise<{ jobId: string }> {
    if (!this.generationEnabled) {
      throw new ConflictError('Generation is temporarily disabled');
    }

    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    const sourceS3Key = input?.sourceS3Key ?? null;
    if (sourceS3Key !== null) {
      ensureAllowedReferenceSourceKey(sourceS3Key, userId, entityId);
    }

    await this.recoveryService.recoverStaleJobsForEntity(userId, entity.entityId, organizationId);
    await this.ensureNoActiveGenerationJob(userId, entity.entityId, organizationId);

    let creditsConsumed = false;
    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
        organizationId,
        jobType: 'entity_generate',
        generationMode: null,
        creditCost: CREDIT_COSTS.ENTITY_GENERATION,
        capacityLimits: this.capacityLimits,
        params: {
          entity_id: entity.entityId,
          entity_type: entity.entityType,
          previous_entity_status: entity.status,
          ...(sourceS3Key === null ? {} : { source_s3_key: sourceS3Key }),
        },
      });
      createdJobId = job.id;

      if (organizationId === null) {
        await this.creditService.consumeCredits({
          userId,
          cost: CREDIT_COSTS.ENTITY_GENERATION,
          description: 'Entity reference generation',
          jobId: job.id,
        });
      } else {
        await this.getOrganizationService().consumeCredits({
          userId,
          organizationId,
          workId: entity.workId,
          cost: CREDIT_COSTS.ENTITY_GENERATION,
          description: 'Entity reference generation',
          jobId: job.id,
          eventType: 'entity_generation.started',
        });
      }
      creditsConsumed = true;

      const enqueueResult = await this.generationQueue.enqueue({
        jobId: job.id,
        userId,
        entityId: entity.entityId,
      });

      if (enqueueResult.messageId !== null) {
        await this.persistQueueMessageId(job.id, enqueueResult.messageId);
      }

      return { jobId: job.id };
    } catch (error) {
      let compensationError: unknown = null;

      if (createdJobId !== null) {
        try {
          await this.generationJobRepository.markFailed(createdJobId, 'Failed to enqueue entity generation job');
        } catch (markError) {
          compensationError ??= markError;
        }
      }

      if (creditsConsumed) {
        try {
          if (organizationId === null) {
            await this.creditService.refundCredits({
              userId,
              amount: CREDIT_COSTS.ENTITY_GENERATION,
              description: 'Refund for failed entity generation enqueue',
              jobId: createdJobId ?? reservedJobId,
            });
          } else {
            await this.getOrganizationService().refundCredits({
              organizationId,
              actorUserId: userId,
              amount: CREDIT_COSTS.ENTITY_GENERATION,
              description: 'Refund for failed entity generation enqueue',
              jobId: createdJobId ?? reservedJobId,
            });
          }
        } catch (refundError) {
          compensationError ??= refundError;
        }
      }

      if (compensationError !== null) {
        logEntityReferenceCompensationFailure('entity_generation_enqueue_compensation_failed', compensationError, {
          job_id: createdJobId ?? reservedJobId,
          entity_id: entity.entityId,
        });
      }

      if (error instanceof Error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError('Entity reference generation is already queued or processing');
        }

        throw error;
      }

      throw new ConfigurationError('Failed to enqueue entity generation job');
    }
  }

  public async confirmReferences(
    userId: string,
    entityId: string,
    input: ConfirmEntityReferencesRequest,
    organizationId: string | null = null,
  ): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    if (input.selectedS3Keys.length < ENTITY_REFERENCE_LIMITS.MIN_CONFIRM_COUNT) {
      throw new ValidationError('At least one reference image must be selected');
    }
    if (input.selectedS3Keys.length > ENTITY_REFERENCE_LIMITS.MAX_CONFIRM_COUNT) {
      throw new ValidationError('Too many reference images were selected');
    }
    const selectedS3Keys = [...input.selectedS3Keys];

    const primaryS3Key = input.primaryS3Key ?? selectedS3Keys[0];
    if (!selectedS3Keys.includes(primaryS3Key)) {
      throw new ValidationError('primary_s3_key must be included in selected_s3_keys');
    }
    const finalizedImages: EntityReferenceImage[] = [];

    for (const sourceS3Key of selectedS3Keys) {
      ensureAllowedReferenceSourceKey(sourceS3Key, userId, entityId);

      const refId = randomUUID();
      const storedImage = await this.imageStorage.finalizeReferenceImage({
        userId,
        entityId,
        refId,
        sourceS3Key,
      });

      finalizedImages.push({
        refId,
        s3Key: storedImage.s3Key,
        cdnUrl: storedImage.cdnUrl,
        source: sourceS3Key.startsWith(`session/${userId}/entities/${entityId}/`) ? 'generated' : 'upload',
        createdAt: new Date().toISOString(),
      });
    }

    const primaryReference = finalizedImages.find(
      (_image, index) => selectedS3Keys[index] === primaryS3Key,
    ) ?? finalizedImages[0];
    const saved = await this.entityRepository.saveConfirmedReferences({
      entityId,
      userId,
      organizationId,
      images: finalizedImages,
      primaryRefId: primaryReference.refId,
      promptSupplement: input.promptSupplement,
    });

    if (saved === null) {
      throw new ConfigurationError('Failed to persist entity references');
    }

    return saved;
  }

  public async deleteReference(
    userId: string,
    entityId: string,
    refId: string,
    organizationId: string | null = null,
  ): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    if (!entity.referenceSet.images.some((image) => image.refId === refId)) {
      throw new NotFoundError('Reference image not found');
    }

    const usageCount = await this.entityRepository.countEntityStateUsageByReferenceId(
      entityId,
      userId,
      refId,
      organizationId,
    );
    if (usageCount > 0) {
      throw new ConflictError('Reference image is currently used by an entity state');
    }

    const updated = await this.entityRepository.deleteReferenceImage({
      entityId,
      userId,
      organizationId,
      refId,
    });
    if (updated === null) {
      throw new ConfigurationError('Failed to delete entity reference');
    }

    return updated;
  }

  private async analyzeImportedImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageData: Buffer;
      mimeType: EntityReferenceUploadMimeType;
      dataUrl: string;
      storedImage: {
        s3Key: string;
        cdnUrl: string;
      } | null;
    },
    organizationId: string | null,
  ): Promise<EntityImportAnalysis> {
    if (!this.importAnalysisEnabled) {
      throw new ConflictError('Entity import analysis is temporarily disabled');
    }

    let creditsConsumed = false;
    try {
      if (organizationId === null) {
        await this.creditService.consumeCredits({
          userId,
          cost: CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS,
          description: 'Entity import analysis',
        });
      } else {
        await this.getOrganizationService().consumeCredits({
          userId,
          organizationId,
          cost: CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS,
          description: 'Entity import analysis',
          eventType: 'entity_import.started',
        });
      }
      creditsConsumed = true;

      const storedImage = input.storedImage
        ?? await this.imageStorage.storeImportedImage({
          userId,
          imageData: input.imageData,
          mimeType: input.mimeType,
        });
      const analysis = await this.imageAnalyzer.analyze({
        entityType: input.entityType,
        dataUrl: input.dataUrl,
      });

      return {
        suggestedFields: parseStructuredFields(input.entityType, analysis.suggestedFields),
        promptSupplement: analysis.promptSupplement.slice(
          0,
          ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH,
        ),
        tmpImageS3Key: storedImage.s3Key,
        tmpImageCdnUrl: storedImage.cdnUrl,
      };
    } catch (error) {
      if (creditsConsumed) {
        try {
          if (organizationId === null) {
            await this.creditService.refundCredits({
              userId,
              amount: CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS,
              description: 'Refund for failed entity import analysis',
            });
          } else {
            await this.getOrganizationService().refundCredits({
              organizationId,
              actorUserId: userId,
              amount: CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS,
              description: 'Refund for failed entity import analysis',
            });
          }
        } catch (refundError) {
          logEntityReferenceCompensationFailure('entity_import_refund_failed', refundError, {
            user_id: userId,
            organization_id: organizationId,
          });
        }
      }

      throw error;
    }
  }

  private async persistQueueMessageId(jobId: string, messageId: string): Promise<void> {
    try {
      await this.generationJobRepository.attachQueueMessageId(jobId, messageId);
    } catch {
      // The queue accepted the job already. Missing metadata should not refund
      // or mark the entity generation as failed.
    }
  }

  private async ensureNoActiveGenerationJob(
    userId: string,
    entityId: string,
    organizationId: string | null,
  ): Promise<void> {
    const activeJob = await this.generationJobRepository.findActiveEntityGenerationJob(userId, entityId, organizationId);
    if (activeJob !== null) {
      throw new ConflictError('Entity reference generation is already queued or processing');
    }
  }

  private getOrganizationService(): OrganizationServicePort {
    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required for enterprise entity generation');
    }
    return this.organizationService;
  }
}

interface ParsedImageDataUrl {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  imageData: Buffer;
  sizeBytes: number;
}

function parseImageDataUrl(value: string): ParsedImageDataUrl {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
  if (match === null) {
    throw new ValidationError('image_base64 must be a PNG, JPEG, or WebP data URL');
  }

  const imageData = Buffer.from(match[2], 'base64');
  if (imageData.length === 0) {
    throw new ValidationError('image_base64 must not be empty');
  }

  return {
    mimeType: match[1] as ParsedImageDataUrl['mimeType'],
    imageData,
    sizeBytes: imageData.length,
  };
}

function imageDataMatchesDeclaredMimeType(image: ParsedImageDataUrl): boolean {
  switch (image.mimeType) {
    case 'image/png':
      return startsWithBytes(image.imageData, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWithBytes(image.imageData, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return (
        image.imageData.length >= 12 &&
        image.imageData.subarray(0, 4).toString('ascii') === 'RIFF' &&
        image.imageData.subarray(8, 12).toString('ascii') === 'WEBP'
      );
  }
}

function startsWithBytes(value: Buffer, expectedBytes: number[]): boolean {
  if (value.length < expectedBytes.length) {
    return false;
  }

  return expectedBytes.every((expectedByte, index) => value[index] === expectedByte);
}

function logEntityReferenceCompensationFailure(
  event: string,
  error: unknown,
  metadata: Record<string, unknown>,
): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      message: error instanceof Error ? error.message : String(error),
      ...metadata,
    }),
  );
}
