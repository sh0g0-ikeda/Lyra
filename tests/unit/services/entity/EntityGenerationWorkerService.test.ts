import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type { EntityReferenceRepository } from '../../../../src/repositories/EntityRepository.js';
import type {
  CompleteEntityGenerationInput,
  EntityGenerationExecutionRepository,
} from '../../../../src/repositories/EntityGenerationExecutionRepository.js';
import type {
  EntityImageStoragePort,
  StoredEntityImage,
} from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';
import type {
  EntityReferenceGeneratorPort,
  GenerateEntityReferenceCandidatesInput,
} from '../../../../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';
import type { EntityReferencePromptBuilderPort } from '../../../../src/services/entity/EntityReferencePromptBuilder.js';
import {
  EntityGenerationWorkerService,
} from '../../../../src/services/entity/EntityGenerationWorkerService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';

const now = new Date('2026-04-25T00:00:00.000Z');

class FakeExecutionRepository implements EntityGenerationExecutionRepository {
  public job: GenerationJob | null = buildJob();
  public completed: CompleteEntityGenerationInput | null = null;
  public failed: { jobId: string; userId: string; errorMessage: string } | null = null;

  public async claimQueuedEntityGenerationJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async completeEntityGeneration(input: CompleteEntityGenerationInput): Promise<boolean> {
    this.completed = input;
    return true;
  }

  public async failEntityGeneration(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
  }): Promise<boolean> {
    this.failed = input;
    return true;
  }
}

class FakeEntityReferenceRepository implements EntityReferenceRepository {
  public async findReferenceContextByIdAndUserId(): Promise<EntityReferenceContext | null> {
    return {
      entityId: 'entity-1',
      workId: 'work-1',
      userId: 'user-1',
      entityType: 'character',
      name: 'Mizuki',
      freeDescription: 'Black long hair swordswoman',
      structuredFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine',
      status: 'draft',
      referenceSet: {
        entityId: 'entity-1',
        images: [],
        primaryRefId: null,
        status: 'empty',
        updatedAt: now,
      },
    };
  }

  public async saveConfirmedReferences(): Promise<never> {
    throw new Error('not used');
  }

  public async deleteReferenceImage(): Promise<never> {
    throw new Error('not used');
  }

  public async countEntityStateUsageByReferenceId(): Promise<number> {
    return 0;
  }
}

class FakePromptBuilder implements EntityReferencePromptBuilderPort {
  public buildGenerationPrompt(): string {
    return 'entity prompt';
  }
}

class FakeReferenceGenerator implements EntityReferenceGeneratorPort {
  public input: GenerateEntityReferenceCandidatesInput | null = null;
  public shouldThrow = false;

  public async generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: Array<{ imageData: Buffer; mimeType: string }>;
    openaiRequestId: string | null;
    costUsd: number | null;
  }> {
    this.input = input;

    if (this.shouldThrow) {
      throw new Error('generation failed');
    }

    return {
      candidates: [
        { imageData: Buffer.from('a'), mimeType: 'image/png' },
        { imageData: Buffer.from('b'), mimeType: 'image/png' },
        { imageData: Buffer.from('c'), mimeType: 'image/png' },
      ],
      openaiRequestId: 'req-1',
      costUsd: null,
    };
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public loadedS3Keys: string[] = [];

  public async loadByS3Key(s3Key: string): Promise<{ imageData: Buffer; mimeType: 'image/png' }> {
    this.loadedS3Keys.push(s3Key);

    return {
      imageData: Buffer.from('uploaded-source'),
      mimeType: 'image/png',
    };
  }
}

class FakeEntityImageStorage implements EntityImageStoragePort {
  public async storeImportedImage(): Promise<never> {
    throw new Error('not used');
  }

  public async storeGeneratedCandidate(input: {
    userId: string;
    entityId: string;
    jobId: string;
    candidateIndex: number;
    imageData: Buffer;
    mimeType: string;
  }): Promise<StoredEntityImage> {
    return {
      s3Key: `session/${input.userId}/entities/${input.entityId}/${input.jobId}-${input.candidateIndex}.png`,
      cdnUrl: `https://cdn.lyra.test/session/${input.userId}/entities/${input.entityId}/${input.jobId}-${input.candidateIndex}.png`,
    };
  }

  public async finalizeReferenceImage(): Promise<never> {
    throw new Error('not used');
  }
}

class FakeCreditService implements CreditServicePort {
  public refunded: RefundCreditsParams | null = null;

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunded = params;
    return this.getBalance();
  }
}

describe('EntityGenerationWorkerService', () => {
  it('entity_generate job を処理して candidates を保存する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    const service = buildService({
      executionRepository,
      referenceGenerator,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(referenceGenerator.input).toEqual({ prompt: 'entity prompt', inputImages: [] });
    expect(executionRepository.completed?.candidates).toHaveLength(3);
    expect(executionRepository.completed?.openaiRequestId).toBe('req-1');
  });

  it('source_s3_key がある場合は upload 画像を input image に変換して使う', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({
      params: {
        entity_id: 'entity-1',
        entity_type: 'character',
        previous_entity_status: 'draft',
        source_s3_key: 'tmp/user-1/entities/imports/source.png',
      },
    });
    const referenceGenerator = new FakeReferenceGenerator();
    const storedImageLoader = new FakeStoredImageLoader();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      storedImageLoader,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(storedImageLoader.loadedS3Keys).toEqual(['tmp/user-1/entities/imports/source.png']);
    expect(referenceGenerator.input).toEqual({
      prompt: 'entity prompt',
      inputImages: [{ dataUrl: 'data:image/png;base64,dXBsb2FkZWQtc291cmNl' }],
    });
  });

  it('生成失敗時は failed と refund に落ちる', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    const creditService = new FakeCreditService();
    referenceGenerator.shouldThrow = true;
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'generation failed',
    });
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
  });
});

function buildService(overrides: {
  executionRepository?: FakeExecutionRepository;
  entityRepository?: FakeEntityReferenceRepository;
  promptBuilder?: FakePromptBuilder;
  referenceGenerator?: FakeReferenceGenerator;
  imageStorage?: FakeEntityImageStorage;
  creditService?: FakeCreditService;
  storedImageLoader?: FakeStoredImageLoader;
} = {}): EntityGenerationWorkerService {
  return new EntityGenerationWorkerService(
    overrides.executionRepository ?? new FakeExecutionRepository(),
    overrides.entityRepository ?? new FakeEntityReferenceRepository(),
    overrides.promptBuilder ?? new FakePromptBuilder(),
    overrides.referenceGenerator ?? new FakeReferenceGenerator(),
    overrides.imageStorage ?? new FakeEntityImageStorage(),
    overrides.creditService ?? new FakeCreditService(),
    overrides.storedImageLoader ?? new FakeStoredImageLoader(),
  );
}

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'entity_generate',
    status: 'queued',
    generationMode: null,
    creditCost: 8,
    params: {
      entity_id: 'entity-1',
      entity_type: 'character',
      previous_entity_status: 'draft',
    },
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
