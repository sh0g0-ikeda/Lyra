import { CREDIT_COSTS } from '../../domain/constants/credits.js';
import { ENTITY_REFERENCE_GENERATION } from '../../domain/constants/entityReference.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EntityReferenceContext,
  PersistedEntityGenerationJobParams,
} from '../../domain/types/entityReference.js';
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
import type {
  CompiledEntityReferencePrompt,
  EntityReferencePromptCompilerPort,
} from './EntityReferencePromptCompiler.js';

export interface ProcessEntityGenerationJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed';
}

export class EntityGenerationWorkerService {
  public constructor(
    private readonly executionRepository: EntityGenerationExecutionRepository,
    private readonly entityRepository: EntityReferenceRepository,
    private readonly promptBuilder: EntityReferencePromptBuilderPort,
    private readonly promptCompiler: EntityReferencePromptCompilerPort,
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

      const draftPrompt = this.promptBuilder.buildGenerationPrompt(entity);
      const compilerBrief = this.promptBuilder.buildCompilerBrief(entity);
      const compiled = await compilePromptSafely(this.promptCompiler, entity, draftPrompt, compilerBrief);
      const inputImages = await buildGeneratorInputImages(params, this.storedImageLoader);
      const generationPrompt = buildPreviewVariationPrompt(
        compiled.prompt,
        job.id,
        params.source_s3_key !== undefined,
      );
      const generated = await this.generator.generateCandidates({ prompt: generationPrompt, inputImages });
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
        structuredFields: entity.structuredFields,
        candidates: storedCandidates,
        compiledBrief: compilerBrief,
        compiledPrompt: generationPrompt,
        openaiRequestId: generated.openaiRequestId,
        costUsd: generated.costUsd,
        compiledPromptUsed: compiled.compilerProvider !== 'none',
        promptCompilerProvider: compiled.compilerProvider,
        compilerModel: compiled.compilerModel,
        compilerPromptVersion: compiled.compilerPromptVersion,
        compilerError: compiled.compilerProvider === 'none' ? 'Entity prompt compiler fallback used' : null,
        imageModel: ENTITY_REFERENCE_GENERATION.MODEL,
        imageParams: {
          quality: ENTITY_REFERENCE_GENERATION.QUALITY,
          size: ENTITY_REFERENCE_GENERATION.SIZE,
        },
        createdAt: new Date().toISOString(),
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

function buildPreviewVariationPrompt(
  prompt: string,
  jobId: string,
  isImageConditioned: boolean,
): string {
  const profile = PREVIEW_VARIATION_PROFILES[selectPreviewVariationProfileIndex(jobId)];
  const sourceImageInstruction = isImageConditioned
    ? 'Respect the uploaded source image as the core identity anchor, but do not simply recreate the exact same pose, crop, or fold pattern from earlier previews.'
    : 'Do not simply recreate the exact same pose, crop, or fold pattern from earlier previews.';

  return [
    prompt.trim(),
    '',
    'Treat this output as a fresh preview variation of the same character reference.',
    sourceImageInstruction,
    'Keep the same identity, face shape, hair silhouette, body proportions, and outfit silhouette, but vary only neutral presentation details such as stance weight distribution, arm spacing, head tilt, hair strand grouping, and fabric fold rhythm.',
    `Variation profile ${profile.code}: ${profile.instruction}`,
  ].join(' ');
}

function selectPreviewVariationProfileIndex(jobId: string): number {
  let hash = 0;

  for (let index = 0; index < jobId.length; index += 1) {
    hash = (hash * 31 + jobId.charCodeAt(index)) >>> 0;
  }

  return hash % PREVIEW_VARIATION_PROFILES.length;
}

const PREVIEW_VARIATION_PROFILES = [
  {
    code: 'A',
    instruction:
      'Slightly shift the body weight onto one leg, keep the shoulders relaxed and uneven by a small amount, let the front hair separate into clearer clumps, and keep the outfit folds broad and clean.',
  },
  {
    code: 'B',
    instruction:
      'Use a balanced upright stance, increase the spacing between the arms and torso a little, keep the bangs tidier, and make the collar and sleeve folds sharper and more structured.',
  },
  {
    code: 'C',
    instruction:
      'Use a reserved inward stance, give the head a subtle tilt, keep the hair mass compact with softer side locks, and make the fabric folds lighter and more delicate.',
  },
  {
    code: 'D',
    instruction:
      'Use a more open neutral stance, raise the chin slightly, let the ponytail or back hair arc a little wider, and make the skirt or lower-garment folds read in larger simple shapes.',
  },
] as const;

async function compilePromptSafely(
  compiler: EntityReferencePromptCompilerPort,
  context: EntityReferenceContext,
  draftPrompt: string,
  compilerBrief: string,
): Promise<CompiledEntityReferencePrompt> {
  try {
    return await compiler.compilePrompt({ context, draftPrompt, compilerBrief });
  } catch (error) {
    if (!(error instanceof ConfigurationError)) {
      throw error;
    }

    return {
      prompt: draftPrompt,
      compilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
    };
  }
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
