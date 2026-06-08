import { randomUUID } from 'node:crypto';
import { CREDIT_COSTS } from '../../domain/constants/credits.js';
import {
  ENTITY_IMPORT_MAX_FILE_SIZE_BYTES,
  ENTITY_REFERENCE_LIMITS,
} from '../../domain/constants/entityReference.js';
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
import type { EntityGenerationQueuePort } from './EntityGenerationQueue.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from './EntityGenerationRecoveryService.js';
import type { EntityImportAnalyzerPort } from '../../infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import type { EntityImageStoragePort } from '../../infrastructure/aws/S3EntityImageStorage.js';
import {
  assertGenerationCapacity,
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
  getReferenceSet(userId: string, entityId: string): Promise<EntityReferenceSet>;
  importImage(
    userId: string,
    input: {
      entityType: EntityType;
      imageBase64: string;
    },
  ): Promise<EntityImportAnalysis>;
  enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    input?: {
      sourceS3Key?: string | null;
    },
  ): Promise<{ jobId: string }>;
  confirmReferences(
    userId: string,
    entityId: string,
    input: ConfirmEntityReferencesRequest,
  ): Promise<EntityReferenceSet>;
  deleteReference(userId: string, entityId: string, refId: string): Promise<EntityReferenceSet>;
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
  ) {}

  public async getReferenceSet(userId: string, entityId: string): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId);
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
  ): Promise<EntityImportAnalysis> {
    const uploadedImage = parseImageDataUrl(input.imageBase64);
    if (uploadedImage.sizeBytes > ENTITY_IMPORT_MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('Image file is too large');
    }

    const storedImage = await this.imageStorage.storeImportedImage({
      userId,
      imageData: uploadedImage.imageData,
      mimeType: uploadedImage.mimeType,
    });
    const analysis = await this.imageAnalyzer.analyze({
      entityType: input.entityType,
      dataUrl: input.imageBase64,
    });

    return {
      suggestedFields: parseStructuredFields(input.entityType, analysis.suggestedFields),
      promptSupplement: analysis.promptSupplement.slice(0, ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH),
      tmpImageS3Key: storedImage.s3Key,
      tmpImageCdnUrl: storedImage.cdnUrl,
    };
  }

  public async enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    input?: {
      sourceS3Key?: string | null;
    },
  ): Promise<{ jobId: string }> {
    if (!this.generationEnabled) {
      throw new ConflictError('Generation is temporarily disabled');
    }

    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    const sourceS3Key = input?.sourceS3Key ?? null;
    if (sourceS3Key !== null) {
      ensureAllowedReferenceSourceKey(sourceS3Key, userId, entityId);
    }

    await this.recoveryService.recoverStaleJobsForEntity(userId, entity.entityId);
    await assertGenerationCapacity(this.generationJobRepository, userId, this.capacityLimits);
    await this.ensureNoActiveGenerationJob(userId, entity.entityId);

    let creditsConsumed = false;
    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;

    try {
      await this.creditService.consumeCredits({
        userId,
        cost: CREDIT_COSTS.ENTITY_GENERATION,
        description: 'Entity reference generation',
        jobId: reservedJobId,
      });
      creditsConsumed = true;

      const job = await this.generationJobRepository.create({
        id: reservedJobId,
        userId,
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
      if (createdJobId !== null) {
        await this.generationJobRepository.markFailed(createdJobId, 'Failed to enqueue entity generation job');
      }

      if (creditsConsumed) {
        await this.creditService.refundCredits({
          userId,
          amount: CREDIT_COSTS.ENTITY_GENERATION,
          description: 'Refund for failed entity generation enqueue',
          jobId: createdJobId ?? reservedJobId,
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
  ): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId);
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
      images: finalizedImages,
      primaryRefId: primaryReference.refId,
      promptSupplement: input.promptSupplement,
    });

    if (saved === null) {
      throw new ConfigurationError('Failed to persist entity references');
    }

    return saved;
  }

  public async deleteReference(userId: string, entityId: string, refId: string): Promise<EntityReferenceSet> {
    const entity = await this.entityRepository.findReferenceContextByIdAndUserId(entityId, userId);
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
    );
    if (usageCount > 0) {
      throw new ConflictError('Reference image is currently used by an entity state');
    }

    const updated = await this.entityRepository.deleteReferenceImage({
      entityId,
      userId,
      refId,
    });
    if (updated === null) {
      throw new ConfigurationError('Failed to delete entity reference');
    }

    return updated;
  }

  private async persistQueueMessageId(jobId: string, messageId: string): Promise<void> {
    try {
      await this.generationJobRepository.attachQueueMessageId(jobId, messageId);
    } catch {
      // The queue accepted the job already. Missing metadata should not refund
      // or mark the entity generation as failed.
    }
  }

  private async ensureNoActiveGenerationJob(userId: string, entityId: string): Promise<void> {
    const activeJob = await this.generationJobRepository.findActiveEntityGenerationJob(userId, entityId);
    if (activeJob !== null) {
      throw new ConflictError('Entity reference generation is already queued or processing');
    }
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
