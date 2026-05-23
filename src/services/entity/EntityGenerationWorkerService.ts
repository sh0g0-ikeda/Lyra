import { CREDIT_COSTS } from '../../domain/constants/credits.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { PersistedEntityGenerationJobParams } from '../../domain/types/entityReference.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { EntityReferenceRepository } from '../../repositories/EntityRepository.js';
import type { EntityGenerationExecutionRepository } from '../../repositories/EntityGenerationExecutionRepository.js';
import type {
  EntityReferenceGeneratorPort,
} from '../../infrastructure/openai/OpenAIEntityReferenceGenerator.js';
import type {
  EntityImageStoragePort,
} from '../../infrastructure/aws/S3EntityImageStorage.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { EntityReferencePromptBuilderPort } from './EntityReferencePromptBuilder.js';

export interface ProcessEntityGenerationJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed';
}

export class EntityGenerationWorkerService {
  public constructor(
    private readonly executionRepository: EntityGenerationExecutionRepository,
    private readonly entityRepository: EntityReferenceRepository,
    private readonly promptBuilder: EntityReferencePromptBuilderPort,
    private readonly generator: EntityReferenceGeneratorPort,
    private readonly imageStorage: EntityImageStoragePort,
    private readonly creditService: CreditServicePort,
    private readonly storedImageLoader: StoredImageLoaderPort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEntityGenerationJobResult> {
    const job = await this.executionRepository.claimQueuedEntityGenerationJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }

    const params = parsePersistedParams(job.params);
    if (params === null) {
      await this.failJob(job.id, job.userId, job.creditCost, 'Entity generation job params are invalid');
      return { status: 'processed', jobStatus: 'failed' };
    }

    try {
      const entity = await this.entityRepository.findReferenceContextByIdAndUserId(
        params.entity_id,
        job.userId,
      );
      if (entity === null) {
        throw new ConfigurationError('Entity not found for generation job');
      }

      const prompt = this.promptBuilder.buildGenerationPrompt(entity);
      const inputImages = await buildGeneratorInputImages(params, this.storedImageLoader);
      const generated = await this.generator.generateCandidates({ prompt, inputImages });
      const storedCandidates = [];

      for (let index = 0; index < generated.candidates.length; index += 1) {
        const candidate = generated.candidates[index];
        const storedImage = await this.imageStorage.storeGeneratedCandidate({
          userId: job.userId,
          entityId: entity.entityId,
          jobId: job.id,
          candidateIndex: index + 1,
          imageData: candidate.imageData,
          mimeType: candidate.mimeType,
        });

        storedCandidates.push({
          refId: `${job.id}-${index + 1}`,
          s3Key: storedImage.s3Key,
          cdnUrl: storedImage.cdnUrl,
        });
      }

      const completed = await this.executionRepository.completeEntityGeneration({
        jobId: job.id,
        userId: job.userId,
        candidates: storedCandidates,
        openaiRequestId: generated.openaiRequestId,
        costUsd: generated.costUsd,
      });

      if (!completed) {
        throw new ConfigurationError('Failed to persist entity generation job result');
      }

      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      await this.failJob(
        job.id,
        job.userId,
        job.creditCost,
        error instanceof Error ? error.message : 'Entity generation failed',
      );
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async failJob(
    jobId: string,
    userId: string,
    creditCost: number,
    errorMessage: string,
  ): Promise<void> {
    const failed = await this.executionRepository.failEntityGeneration({
      jobId,
      userId,
      errorMessage,
    });
    if (!failed) {
      throw new ConfigurationError('Failed to mark entity generation job as failed');
    }

    if (creditCost >= CREDIT_COSTS.ENTITY_GENERATION) {
      await this.creditService.refundCredits({
        userId,
        amount: creditCost,
        description: 'Refund for failed entity generation job',
        jobId,
      });
    }
  }
}

function parsePersistedParams(value: Record<string, unknown>): PersistedEntityGenerationJobParams | null {
  const entityId = value.entity_id;
  const entityType = value.entity_type;
  const previousEntityStatus = value.previous_entity_status;
  const sourceS3Key = value.source_s3_key;

  if (
    typeof entityId !== 'string' ||
    (entityType !== 'character' && entityType !== 'nonhuman' && entityType !== 'object') ||
    (previousEntityStatus !== 'draft' && previousEntityStatus !== 'ready') ||
    (sourceS3Key !== undefined && typeof sourceS3Key !== 'string')
  ) {
    return null;
  }

  return {
    entity_id: entityId,
    entity_type: entityType,
    previous_entity_status: previousEntityStatus,
    ...(sourceS3Key === undefined ? {} : { source_s3_key: sourceS3Key }),
  };
}

async function buildGeneratorInputImages(
  params: PersistedEntityGenerationJobParams,
  storedImageLoader: StoredImageLoaderPort,
): Promise<Array<{ dataUrl: string }>> {
  if (params.source_s3_key === undefined) {
    return [];
  }

  const loadedImage = await storedImageLoader.loadByS3Key(params.source_s3_key);
  return [
    {
      dataUrl: `data:${loadedImage.mimeType};base64,${loadedImage.imageData.toString('base64')}`,
    },
  ];
}
