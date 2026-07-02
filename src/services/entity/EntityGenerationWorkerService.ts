import { ENTITY_REFERENCE_GENERATION } from '../../domain/constants/entityReference.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  EntityReferenceContext,
  PersistedEntityGenerationJobParams,
} from '../../domain/types/entityReference.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { CreditServicePort } from '../credit/CreditService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';
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
import { ensureAllowedReferenceSourceKey } from './EntityReferenceSourceKeyPolicy.js';

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
    private readonly imageModel: string = ENTITY_REFERENCE_GENERATION.MODEL,
    private readonly generationEnabled = true,
    private readonly organizationService?: OrganizationServicePort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEntityGenerationJobResult> {
    if (!this.generationEnabled) {
      throw new ConfigurationError('Entity generation worker is temporarily disabled');
    }

    const job = await this.executionRepository.claimQueuedEntityGenerationJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }

    const params = parsePersistedParams(job.params);
    if (params === null) {
      await this.failJob(job, 'Entity generation job params are invalid', null);
      return { status: 'processed', jobStatus: 'failed' };
    }

    let workIdForAudit: string | null = null;
    try {
      const entity = await this.entityRepository.findReferenceContextByIdAndUserId(
        params.entity_id,
        job.userId,
        job.organizationId ?? null,
      );
      if (entity === null) {
        throw new ConfigurationError('Entity not found for generation job');
      }
      workIdForAudit = entity.workId;

      const draftPrompt = this.promptBuilder.buildGenerationPrompt(entity);
      const compilerBrief = this.promptBuilder.buildCompilerBrief(entity);
      const compiled = await compilePromptSafely(this.promptCompiler, entity, draftPrompt, compilerBrief);
      const inputImages = await buildGeneratorInputImages(params, job.userId, this.storedImageLoader);
      const generationPrompt = buildPreviewVariationPrompt(
        compiled.prompt,
        job.id,
        params.source_s3_key !== undefined,
      );
      const generated = await this.generator.generateCandidates({ prompt: generationPrompt, inputImages });
      assertGeneratedCandidates(generated.candidates);

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
        imageModel: this.imageModel,
        imageParams: {
          quality: ENTITY_REFERENCE_GENERATION.QUALITY,
          size: ENTITY_REFERENCE_GENERATION.SIZE,
        },
        createdAt: new Date().toISOString(),
      });

      if (!completed) {
        throw new ConfigurationError('Failed to persist entity generation job result');
      }

      await this.recordGenerationCompleted(job, entity, generated);
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      await this.failJob(job, sanitizePersistedErrorMessage(error, 'Entity generation failed'), workIdForAudit);
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async failJob(
    job: GenerationJob,
    errorMessage: string,
    workId: string | null,
  ): Promise<void> {
    const failed = await this.executionRepository.failEntityGeneration({
      jobId: job.id,
      userId: job.userId,
      errorMessage,
    });
    if (!failed) {
      return;
    }

    if (job.creditCost > 0) {
      try {
        await this.refundFailedJobCredits(job);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          `[entity-generation-worker] failed to refund failed job ${job.id}; recovery will retry missing refund ledger: ${reason}`,
        );
      }
    }

    await this.recordGenerationFailed(job, workId, errorMessage);
  }

  private async refundFailedJobCredits(job: GenerationJob): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null) {
      await this.creditService.refundCredits({
        userId: job.userId,
        amount: job.creditCost,
        description: 'Refund for failed entity generation job',
        jobId: job.id,
      });
      return;
    }

    if (this.organizationService === undefined) {
      throw new ConfigurationError('Organization service is required to refund enterprise entity generation jobs');
    }

    await this.organizationService.refundCredits({
      organizationId,
      actorUserId: job.userId,
      amount: job.creditCost,
      description: 'Refund for failed entity generation job',
      jobId: job.id,
    });
  }

  private async recordGenerationCompleted(
    job: GenerationJob,
    entity: EntityReferenceContext,
    generated: { openaiRequestId: string | null; costUsd: number | null },
  ): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null || this.organizationService === undefined) {
      return;
    }

    try {
      await this.organizationService.recordGenerationCompleted({
        organizationId,
        userId: job.userId,
        workId: entity.workId,
        jobId: job.id,
        generationType: 'entity_generate',
        metadata: {
          entity_id: entity.entityId,
          entity_type: entity.entityType,
          image_model: this.imageModel,
          cost_usd: generated.costUsd,
          openai_request_id: generated.openaiRequestId,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[entity-generation-worker] failed to record enterprise generation completion ${job.id}: ${reason}`);
    }
  }

  private async recordGenerationFailed(
    job: GenerationJob,
    workId: string | null,
    errorMessage: string,
  ): Promise<void> {
    const organizationId = job.organizationId ?? null;
    if (organizationId === null || this.organizationService === undefined) {
      return;
    }

    try {
      await this.organizationService.recordGenerationFailed({
        organizationId,
        userId: job.userId,
        workId,
        jobId: job.id,
        generationType: 'entity_generate',
        errorMessage,
        metadata: {
          entity_id: typeof job.params.entity_id === 'string' ? job.params.entity_id : null,
          entity_type: typeof job.params.entity_type === 'string' ? job.params.entity_type : null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[entity-generation-worker] failed to record enterprise generation failure ${job.id}: ${reason}`);
    }
  }
}

function assertGeneratedCandidates(
  candidates: Array<{ imageData: Buffer; mimeType: string }>,
): void {
  if (candidates.length === 0) {
    throw new ConfigurationError('Entity reference generator returned no candidates');
  }

  if (candidates.some((candidate) => candidate.imageData.length === 0)) {
    throw new ConfigurationError('Entity reference generator returned empty image data');
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
    ? 'Use the uploaded source image only as a user-supplied visual anchor for this request; if it conflicts with the current saved text, obey the current saved text.'
    : 'No source image is attached, so the current saved text prompt is the only visual source.';

  return [
    prompt.trim(),
    '',
    'Create this as a new reference preview from the current saved entity inputs only.',
    'Do not preserve, restore, imitate, or edit any previous generated preview or any previously confirmed reference image unless it is explicitly attached in this request.',
    'If the current saved text differs from earlier previews, the current saved text must win.',
    sourceImageInstruction,
    'Use a clearly new neutral presentation while keeping the authored subject readable.',
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
  userId: string,
  storedImageLoader: StoredImageLoaderPort,
): Promise<Array<{ dataUrl: string }>> {
  if (params.source_s3_key === undefined) {
    return [];
  }

  ensureAllowedReferenceSourceKey(params.source_s3_key, userId, params.entity_id, 'source_s3_key');
  const loadedImage = await storedImageLoader.loadByS3Key(params.source_s3_key);
  ensureInputImageWithinLimit(loadedImage.imageData);
  return [
    {
      dataUrl: `data:${loadedImage.mimeType};base64,${loadedImage.imageData.toString('base64')}`,
    },
  ];
}

function ensureInputImageWithinLimit(imageData: Buffer): void {
  if (imageData.length > OPENAI_INPUT_IMAGE_MAX_BYTES) {
    throw new ConfigurationError(
      `Entity generation input image is too large. Maximum size is ${OPENAI_INPUT_IMAGE_MAX_BYTES} bytes.`,
    );
  }
}
