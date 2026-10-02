import { assertImageDeliveryAllowed, readGenerationImageProvenance, type ImageDeliveryAudience } from '../../domain/generation/ImageAccessPolicy.js';
import { randomUUID } from 'node:crypto';
import { CREDIT_COSTS } from '../../domain/constants/credits.js';
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
} from '../../domain/errors/index.js';
import { buildEntityStateReferenceImageKey } from '../../domain/state/StateReferenceImageKey.js';
import { isReservedFencedStateReferenceNamespace } from '../../domain/state/FencedStateReferenceKey.js';
import { computeStateReferenceFingerprint } from '../../domain/state/StateReferenceFingerprint.js';
import type { GenerationJob } from '../../domain/types/job.js';
import {
  isReadyEntityStateReferenceContext,
  type ConfirmedEntityStateReference,
  type EntityStateReferenceContext,
  type EntityStateReferenceDescriptor,
} from '../../domain/types/entityStateReference.js';
import type {
  EntityImageStoragePort,
  StoredEntityImage,
} from '../../infrastructure/aws/S3EntityImageStorage.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { EntityStateReferenceRepository } from '../../repositories/EntityStateReferenceRepository.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import {
  isGenerationJobCancellationRace,
  isUniqueViolation,
} from '../../repositories/GenerationJobRepository.js';
import { ensureAllowedReferenceSourceKey } from './EntityReferenceSourceKeyPolicy.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import {
  DEFAULT_GENERATION_CAPACITY_LIMITS,
  type GenerationCapacityLimits,
} from '../generation/GenerationCapacityGuard.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
import type { EntityGenerationQueuePort } from './EntityGenerationQueue.js';
import type { FencedStateReferenceConfirmationPort } from './FencedStateReferenceConfirmationService.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from './EntityGenerationRecoveryService.js';

const STATE_REFERENCE_PRICING_VERSION = 'entity-state-reference-v1';

export interface EntityStateReferenceServicePort {
  enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    stateId: string,
    organizationId?: string | null,
  ): Promise<{ jobId: string; stateRevision: string }>;
  confirmReference(
    userId: string,
    entityId: string,
    stateId: string,
    input: {
      jobId: string;
      candidateS3Key: string;
      expectedStateRevision: string;
    },
    organizationId?: string | null,
  ): Promise<ConfirmedEntityStateReference>;
  exportCandidateImage?(
    userId: string, entityId: string, stateId: string,
    input: { jobId: string; candidateS3Key: string; expectedStateRevision: string },
    organizationId?: string | null,
    audience?: ImageDeliveryAudience,
  ): Promise<{ imageData: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }>;
  exportReferenceImage(
    userId: string,
    entityId: string,
    stateId: string,
    organizationId?: string | null,
    audience?: ImageDeliveryAudience,
  ): Promise<{ imageData: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }>;
}

export interface EntityStateReferenceServiceDependencies {
  stateRepository: EntityStateReferenceRepository;
  generationJobRepository: GenerationJobRepository;
  creditService: CreditServicePort;
  imageStorage: EntityImageStoragePort;
  storedImageLoader: StoredImageLoaderPort;
  generationQueue: EntityGenerationQueuePort;
  imageModel: string;
  generationEnabled?: boolean;
  recoveryService?: EntityGenerationRecoveryServicePort;
  capacityLimits?: GenerationCapacityLimits;
  organizationService?: OrganizationServicePort;
  fencedConfirmationService?: FencedStateReferenceConfirmationPort;
}

export class EntityStateReferenceService implements EntityStateReferenceServicePort {
  public constructor(private readonly dependencies: EntityStateReferenceServiceDependencies) {}

  public async enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    stateId: string,
    organizationId: string | null = null,
  ): Promise<{ jobId: string; stateRevision: string }> {
    if (this.dependencies.generationEnabled !== true) {
      throw new ConflictError('Entity state reference generation is temporarily disabled');
    }

    const context = await this.requireReadyContext(userId, entityId, stateId, organizationId);
    const recoveryService = this.dependencies.recoveryService ?? new NoopEntityGenerationRecoveryService();
    await recoveryService.recoverStaleJobsForEntity(userId, entityId, organizationId);
    if (
      await this.dependencies.generationJobRepository.findActiveEntityGenerationJob(
        userId,
        entityId,
        organizationId,
      ) !== null
    ) {
      throw new ConflictError('Entity reference generation is already queued or processing');
    }

    const stateInputFingerprint = computeContextFingerprint(context);
    const reservedJobId = randomUUID();
    let createdJobId: string | null = null;
    let creditsConsumed = false;

    try {
      const job = await this.dependencies.generationJobRepository.create({
        id: reservedJobId,
        userId,
        organizationId,
        jobType: 'entity_generate',
        generationMode: null,
        creditCost: CREDIT_COSTS.ENTITY_STATE_GENERATION,
        capacityLimits: this.dependencies.capacityLimits ?? DEFAULT_GENERATION_CAPACITY_LIMITS,
        params: {
          target: 'entity_state',
          entity_id: context.entityId,
          entity_type: context.entityType,
          previous_entity_status: context.entityStatus,
          entity_state_id: context.stateId,
          base_primary_ref_id: context.baseReference.refId,
          state_input_fingerprint: stateInputFingerprint,
          state_revision: context.stateRevision,
          state_name: context.stateName,
          state_description: context.stateDescription,
          image_model: this.dependencies.imageModel,
          pricing_version: STATE_REFERENCE_PRICING_VERSION,
        },
      });
      createdJobId = job.id;

      if (organizationId === null) {
        await this.dependencies.creditService.consumeCredits({
          userId,
          cost: CREDIT_COSTS.ENTITY_STATE_GENERATION,
          description: 'Entity state reference generation',
          jobId: job.id,
        });
      } else {
        await this.requireOrganizationService().consumeCredits({
          userId,
          organizationId,
          workId: context.workId,
          cost: CREDIT_COSTS.ENTITY_STATE_GENERATION,
          description: 'Entity state reference generation',
          jobId: job.id,
          eventType: 'entity_generation.started',
        });
      }
      creditsConsumed = true;

      const queued = await this.dependencies.generationQueue.enqueue({
        jobId: job.id,
        userId,
        entityId,
      });
      if (queued.messageId !== null) {
        try {
          await this.dependencies.generationJobRepository.attachQueueMessageId(job.id, queued.messageId);
        } catch {
          // The queue already accepted this job. Missing metadata is recoverable.
        }
      }
      return { jobId: job.id, stateRevision: context.stateRevision };
    } catch (error) {
      let compensationError: unknown = null;
      if (createdJobId !== null) {
        try {
          await this.dependencies.generationJobRepository.markFailed(
            createdJobId,
            'Failed to enqueue entity state reference generation job',
          );
        } catch (markError) {
          compensationError ??= markError;
        }
      }
      if (creditsConsumed) {
        try {
          await this.refundEnqueueFailure(userId, organizationId, createdJobId ?? reservedJobId);
        } catch (refundError) {
          compensationError ??= refundError;
        }
      }
      if (compensationError !== null) {
        logStateReferenceCompensationFailure(compensationError, {
          job_id: createdJobId ?? reservedJobId,
          entity_id: entityId,
          state_id: stateId,
        });
      }
      if (isGenerationJobCancellationRace(error)) {
        throw new ConflictError('Entity state reference generation was stopped before it entered the queue');
      }
      if (isUniqueViolation(error)) {
        throw new ConflictError('Entity reference generation is already queued or processing');
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new ConfigurationError('Failed to enqueue entity state reference generation job');
    }
  }

  public async confirmReference(
    userId: string,
    entityId: string,
    stateId: string,
    input: {
      jobId: string;
      candidateS3Key: string;
      expectedStateRevision: string;
    },
    organizationId: string | null = null,
  ): Promise<ConfirmedEntityStateReference> {
    // Recover durable work before reading mutable readiness or candidate data.
    // The coordinator authorizes this scope and uses only the admitted intent.
    await this.dependencies.fencedConfirmationService?.recoverPendingReference({
      userId, organizationId, entityId, stateId,
    });
    const context = await this.requireReadyContext(userId, entityId, stateId, organizationId);
    const job = await this.dependencies.generationJobRepository.findByIdAndUserId(
      input.jobId,
      userId,
      organizationId,
    );
    const candidate = requireMatchingCompletedCandidate(job, context, input);
    const fingerprint = computeContextFingerprint(context);
    const existingMatchesCandidate = context.referenceImage?.refId === candidate.refId
      && context.referenceImage.inputFingerprint === fingerprint
      && context.referenceImage.baseRefId === context.baseReference.refId;
    if (context.stateRevision !== input.expectedStateRevision && !existingMatchesCandidate) {
      throw new ConflictError('Entity state changed after the preview was generated');
    }

    const destinationKey = buildEntityStateReferenceImageKey({
      userId, entityId, stateId, refId: candidate.refId, sourceS3Key: input.candidateS3Key,
    });
    assertImageDeliveryAllowed(readGenerationImageProvenance(job?.params, job?.result));
    const descriptor: EntityStateReferenceDescriptor = {
      ...readGenerationImageProvenance(job?.params, job?.result),
      refId: candidate.refId,
      s3Key: destinationKey,
      storageOwnerUserId: userId,
      imageModel: requireStringParam(job?.params.image_model, 'image_model'),
      baseRefId: context.baseReference.refId,
      createdAt: readJobCreatedAt(job),
      inputFingerprint: fingerprint,
    };

    const confirmationInput = {
      userId, organizationId, entityId, stateId, jobId: input.jobId,
      candidateS3Key: input.candidateS3Key, expectedStateRevision: input.expectedStateRevision,
      descriptor,
    };
    // Already-confirmed legacy references remain on their original protocol.
    // V2 handles its own existing attempts even when new admission is disabled.
    if (!existingMatchesCandidate || isReservedFencedStateReferenceNamespace(context.referenceImage?.s3Key ?? '')) {
      const fenced = await this.dependencies.fencedConfirmationService?.tryConfirmReference(confirmationInput);
      if (fenced !== undefined && fenced !== null) return fenced;
    }

    // State settlement requires an explicit adapter contract. A generic base
    // copy may retry invisibly and cannot establish this attempt's completion.
    if (this.dependencies.imageStorage.finalizeStateReferenceImage === undefined) {
      throw new ConfigurationError('State reference image storage is not configured');
    }

    return this.dependencies.stateRepository.confirmReference(confirmationInput, async () => {
      const finalized = await this.finalizeCandidateImage({
        userId, entityId, stateId, refId: candidate.refId, candidateS3Key: input.candidateS3Key,
      });
      if (finalized.s3Key !== destinationKey) {
        throw new ConfigurationError('State reference copy returned an unexpected destination');
      }
    });
  }

  public async exportCandidateImage(
    userId: string, entityId: string, stateId: string,
    input: { jobId: string; candidateS3Key: string; expectedStateRevision: string },
    organizationId: string | null = null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<{ imageData: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
    const context = await this.requireReadyContext(userId, entityId, stateId, organizationId);
    const job = await this.dependencies.generationJobRepository.findByIdAndUserId(input.jobId, userId, organizationId);
    if (job?.userId !== userId || (job.organizationId ?? null) !== organizationId
      || context.stateRevision !== input.expectedStateRevision) {
      throw new ConflictError('State reference preview is stale or does not match this scope');
    }
    requireMatchingCompletedCandidate(job, context, input);
    assertImageDeliveryAllowed(readGenerationImageProvenance(job.params, job.result), audience);
    ensureAllowedReferenceSourceKey(input.candidateS3Key, userId, entityId, 'state reference candidate');
    return this.dependencies.storedImageLoader.loadByS3Key(input.candidateS3Key);
  }

  public async exportReferenceImage(
    userId: string,
    entityId: string,
    stateId: string,
    organizationId: string | null = null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<{ imageData: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
    const context = await this.requireReadyContext(userId, entityId, stateId, organizationId);
    const descriptor = context.referenceImage;
    if (
      descriptor === null
      || descriptor.baseRefId !== context.baseReference.refId
      || descriptor.inputFingerprint !== computeContextFingerprint(context)
    ) {
      throw new NotFoundError('Entity state reference image not found');
    }
    assertImageDeliveryAllowed(descriptor, audience);
    ensureOwnedEntityReferenceImageKey(
      descriptor.s3Key,
      descriptor.storageOwnerUserId,
      entityId,
      'entity state reference image key',
    );
    return this.dependencies.storedImageLoader.loadByS3Key(descriptor.s3Key);
  }

  private async requireReadyContext(
    userId: string,
    entityId: string,
    stateId: string,
    organizationId: string | null,
  ): Promise<EntityStateReferenceContext> {
    const context = await this.dependencies.stateRepository.findContextByIdAndUserId(
      entityId,
      stateId,
      userId,
      organizationId,
    );
    if (context === null) {
      throw new NotFoundError('Entity state not found');
    }
    if (context.stateName === null || context.stateDescription === null) {
      throw new ConflictError('Legacy entity state does not support generated state references');
    }
    if (context.baseReference === null) {
      throw new ConflictError('Confirm a base entity reference before generating a state reference');
    }
    if (!isReadyEntityStateReferenceContext(context)) {
      throw new ConflictError('Entity state reference inputs are invalid');
    }
    return context;
  }

  private async finalizeCandidateImage(input: {
    userId: string;
    entityId: string;
    stateId: string;
    refId: string;
    candidateS3Key: string;
  }): Promise<StoredEntityImage> {
    const finalize = this.dependencies.imageStorage.finalizeStateReferenceImage;
    if (finalize === undefined) {
      throw new ConfigurationError('State reference image storage is not configured');
    }
    return finalize.call(this.dependencies.imageStorage, {
      userId: input.userId,
      entityId: input.entityId,
      stateId: input.stateId,
      refId: input.refId,
      sourceS3Key: input.candidateS3Key,
    });
  }

  private async refundEnqueueFailure(
    userId: string,
    organizationId: string | null,
    jobId: string,
  ): Promise<void> {
    if (organizationId === null) {
      await this.dependencies.creditService.refundCredits({
        userId,
        amount: CREDIT_COSTS.ENTITY_STATE_GENERATION,
        description: 'Refund for failed entity state reference generation enqueue',
        jobId,
      });
      return;
    }
    await this.requireOrganizationService().refundCredits({
      organizationId,
      actorUserId: userId,
      amount: CREDIT_COSTS.ENTITY_STATE_GENERATION,
      description: 'Refund for failed entity state reference generation enqueue',
      jobId,
    });
  }

  private requireOrganizationService(): OrganizationServicePort {
    if (this.dependencies.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required for enterprise entity state generation');
    }
    return this.dependencies.organizationService;
  }
}

function computeContextFingerprint(context: EntityStateReferenceContext): string {
  return computeStateReferenceFingerprint({
    entityId: context.entityId,
    stateId: context.stateId,
    name: context.stateName,
    description: context.stateDescription,
    baseRefId: context.baseReference.refId,
  });
}

function requireMatchingCompletedCandidate(
  job: GenerationJob | null,
  context: EntityStateReferenceContext,
  input: { candidateS3Key: string; expectedStateRevision: string },
): { refId: string } {
  if (
    job === null
    || job.status !== 'completed'
    || job.params.target !== 'entity_state'
    || job.params.entity_id !== context.entityId
    || job.params.entity_state_id !== context.stateId
    || job.params.base_primary_ref_id !== context.baseReference.refId
    || job.params.state_input_fingerprint !== computeContextFingerprint(context)
    || job.params.state_revision !== input.expectedStateRevision
  ) {
    throw new ConflictError('State reference preview is stale or does not match this state');
  }
  const candidates = Array.isArray(job.result?.candidates) ? job.result.candidates : [];
  const candidate = candidates.find((value) => {
    const record = toRecord(value);
    return record?.s3_key === input.candidateS3Key && typeof record.ref_id === 'string';
  });
  const record = toRecord(candidate);
  if (record === null || typeof record.ref_id !== 'string' || record.ref_id.length === 0) {
    throw new ConflictError('State reference candidate is not part of the completed preview job');
  }
  return { refId: record.ref_id };
}

function readJobCreatedAt(job: GenerationJob | null): string {
  const value = job?.result?.created_at;
  if (typeof value === 'string' && Number.isFinite(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  if (job?.completedAt !== null && job?.completedAt !== undefined) {
    return job.completedAt.toISOString();
  }
  throw new ConflictError('State reference preview completion time is missing');
}

function requireStringParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConflictError(`State reference preview ${name} is invalid`);
  }
  return value;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function logStateReferenceCompensationFailure(
  error: unknown,
  metadata: Record<string, unknown>,
): void {
  console.error(JSON.stringify({
    level: 'error',
    event: 'entity_state_reference_enqueue_compensation_failed',
    message: error instanceof Error ? error.message : String(error),
    ...metadata,
  }));
}
