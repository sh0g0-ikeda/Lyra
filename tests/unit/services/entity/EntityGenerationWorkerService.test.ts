import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
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
import type { EntityReferencePromptCompilerPort } from '../../../../src/services/entity/EntityReferencePromptCompiler.js';
import { EntityGenerationWorkerService } from '../../../../src/services/entity/EntityGenerationWorkerService.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../../../src/domain/constants/imageInput.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type {
  GrantOrganizationCreditsRequest,
  OrganizationServicePort,
  RecordOrganizationGenerationRequest,
} from '../../../../src/services/organization/OrganizationService.js';

const now = new Date('2026-04-25T00:00:00.000Z');

class FakeExecutionRepository implements EntityGenerationExecutionRepository {
  public job: GenerationJob | null = buildJob();
  public completed: CompleteEntityGenerationInput | null = null;
  public failed: { jobId: string; userId: string; errorMessage: string } | null = null;
  public failureResult = true;
  public progressTouches: Array<{ jobId: string; userId: string; message: string; updatedAt: string }> = [];

  public async claimQueuedEntityGenerationJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async touchEntityGenerationProgress(input: {
    jobId: string;
    userId: string;
    message: string;
    updatedAt: string;
  }): Promise<boolean> {
    this.progressTouches.push(input);
    return true;
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
    return this.failureResult;
  }
}

class FakeEntityReferenceRepository implements EntityReferenceRepository {
  public lookups: Array<{ entityId: string; userId: string; organizationId: string | null }> = [];

  public async findReferenceContextByIdAndUserId(
    entityId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityReferenceContext | null> {
    this.lookups.push({ entityId, userId, organizationId });
    return {
      entityId: 'entity-1',
      workId: 'work-1',
      userId: 'user-1',
      entityType: 'character',
      name: 'Mizuki',
      freeDescription: 'Black long hair swordswoman',
      structuredFields: {
        art_style: 'anime',
        hair: {
          arrangement: 'ponytail',
        },
        hair_detail: {
          back_shape: 'ponytail fall',
        },
      },
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

  public buildCompilerBrief(): string {
    return 'Target image: manga full-body character reference';
  }
}

class FakePromptCompiler implements EntityReferencePromptCompilerPort {
  public shouldThrow = false;
  public failWithConfigurationError = false;
  public draftPrompt: string | null = null;
  public compilerBrief: string | null = null;

  public async compilePrompt(input: { draftPrompt: string; compilerBrief: string }): Promise<{
    prompt: string;
    compilerProvider: 'openai';
    compilerModel: string;
    compilerPromptVersion: string;
  }> {
    this.draftPrompt = input.draftPrompt;
    this.compilerBrief = input.compilerBrief;

    if (this.shouldThrow) {
      if (this.failWithConfigurationError) {
        throw new ConfigurationError('compiler failed');
      }

      throw new Error('compiler failed');
    }

    return {
      prompt: `${input.draftPrompt} compiled`,
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'entity_ref_v2',
    };
  }
}

class FakeReferenceGenerator implements EntityReferenceGeneratorPort {
  public input: GenerateEntityReferenceCandidatesInput | null = null;
  public shouldThrow = false;
  public candidates: Array<{ imageData: Buffer; mimeType: string }> = [
    { imageData: Buffer.from('a'), mimeType: 'image/png' },
  ];

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
      candidates: this.candidates,
      openaiRequestId: 'req-1',
      costUsd: null,
    };
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public loadedS3Keys: string[] = [];
  public imageData = Buffer.from('uploaded-source');

  public async loadByS3Key(s3Key: string): Promise<{ imageData: Buffer; mimeType: 'image/png' }> {
    this.loadedS3Keys.push(s3Key);

    return {
      imageData: this.imageData,
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
  public shouldFailRefund = false;

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
    if (this.shouldFailRefund) {
      throw new Error('refund unavailable');
    }

    return this.getBalance();
  }
}

class FakeOrganizationService {
  public completedGenerations: RecordOrganizationGenerationRequest[] = [];
  public failedGenerations: Array<RecordOrganizationGenerationRequest & { errorMessage?: string | null }> = [];
  public refunds: Array<GrantOrganizationCreditsRequest & { jobId?: string | null }> = [];

  public async recordGenerationCompleted(input: RecordOrganizationGenerationRequest): Promise<void> {
    this.completedGenerations.push(input);
  }

  public async recordGenerationFailed(
    input: RecordOrganizationGenerationRequest & { errorMessage?: string | null },
  ): Promise<void> {
    this.failedGenerations.push(input);
  }

  public async refundCredits(
    input: GrantOrganizationCreditsRequest & { jobId?: string | null },
  ): Promise<unknown> {
    this.refunds.push(input);
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }
}

describe('EntityGenerationWorkerService', () => {
  it('entity_generate job を処理して candidates を保存する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    const promptCompiler = new FakePromptCompiler();
    const service = buildService({
      executionRepository,
      promptCompiler,
      referenceGenerator,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(executionRepository.progressTouches).toHaveLength(1);
    expect(executionRepository.progressTouches[0]).toMatchObject({ jobId: 'job-1', userId: 'user-1' });
    expect(promptCompiler.draftPrompt).toBe('entity prompt');
    expect(promptCompiler.compilerBrief).toContain('Target image: manga full-body character reference');
    expect(referenceGenerator.input?.inputImages).toEqual([]);
    expect(referenceGenerator.input?.prompt).toContain('entity prompt compiled');
    expect(referenceGenerator.input?.prompt).toContain('current saved entity inputs only');
    expect(referenceGenerator.input?.prompt).toContain('current saved text must win');
    expect(referenceGenerator.input?.prompt).toContain('Variation profile');
    expect(executionRepository.completed?.candidates).toHaveLength(1);
    expect(executionRepository.completed?.openaiRequestId).toBe('req-1');
    expect(executionRepository.completed?.compiledBrief).toContain('Target image: manga full-body character reference');
    expect(executionRepository.completed?.compiledPrompt).toContain('entity prompt compiled');
    expect(executionRepository.completed?.compiledPrompt).toContain('Variation profile');
    expect(executionRepository.completed?.compiledPromptUsed).toBe(true);
    expect(executionRepository.completed?.promptCompilerProvider).toBe('openai');
    expect(executionRepository.completed?.compilerModel).toBe('gpt-5.4-mini');
    expect(executionRepository.completed?.compilerPromptVersion).toBe('entity_ref_v2');
    expect(executionRepository.completed?.compilerError).toBeNull();
    expect(executionRepository.completed?.imageModel).toBe('gpt-image-2');
    expect(executionRepository.completed?.imageParams).toEqual({
      quality: 'medium',
      size: '1024x1536',
    });
  });

  it('prompt compiler が設定系エラーなら draft prompt で続行する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.shouldThrow = true;
    promptCompiler.failWithConfigurationError = true;
    const service = buildService({
      executionRepository,
      promptCompiler,
      referenceGenerator,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(referenceGenerator.input?.inputImages).toEqual([]);
    expect(referenceGenerator.input?.prompt).toContain('entity prompt');
    expect(referenceGenerator.input?.prompt).toContain('current saved entity inputs only');
    expect(referenceGenerator.input?.prompt).toContain('current saved text must win');
    expect(executionRepository.completed?.compiledPromptUsed).toBe(false);
    expect(executionRepository.completed?.promptCompilerProvider).toBe('none');
    expect(executionRepository.completed?.compilerModel).toBeNull();
    expect(executionRepository.completed?.compilerPromptVersion).toBeNull();
    expect(executionRepository.completed?.compilerError).toBe('Entity prompt compiler fallback used');
  });

  it('prompt compiler の通常エラーは fallback せず failed にする', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.shouldThrow = true;
    const service = buildService({
      executionRepository,
      promptCompiler,
      referenceGenerator,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failed?.errorMessage).toBe('compiler failed');
    expect(executionRepository.completed).toBeNull();
    expect(referenceGenerator.input).toBeNull();
  });

  it('source_s3_key がある場合は upload 画像を input image として使う', async () => {
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
    expect(referenceGenerator.input?.inputImages).toEqual([
      { dataUrl: 'data:image/png;base64,dXBsb2FkZWQtc291cmNl' },
    ]);
    expect(referenceGenerator.input?.prompt).toContain('entity prompt compiled');
    expect(referenceGenerator.input?.prompt).toContain(
      'Use the uploaded source image only as a user-supplied visual anchor',
    );
    expect(referenceGenerator.input?.prompt).toContain('obey the current saved text');
  });

  it('source_s3_key が別ユーザー範囲なら読み込まず failed と refund にする', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({
      params: {
        entity_id: 'entity-1',
        entity_type: 'character',
        previous_entity_status: 'draft',
        source_s3_key: 'tmp/user-2/entities/imports/source.png',
      },
    });
    const referenceGenerator = new FakeReferenceGenerator();
    const storedImageLoader = new FakeStoredImageLoader();
    const creditService = new FakeCreditService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      storedImageLoader,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(storedImageLoader.loadedS3Keys).toEqual([]);
    expect(referenceGenerator.input).toBeNull();
    expect(executionRepository.failed?.errorMessage).toContain('source_s3_key');
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
  });

  it('source_s3_key の画像が入力上限を超える場合は生成せず failed と refund にする', async () => {
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
    storedImageLoader.imageData = Buffer.alloc(OPENAI_INPUT_IMAGE_MAX_BYTES + 1);
    const creditService = new FakeCreditService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      storedImageLoader,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(storedImageLoader.loadedS3Keys).toEqual(['tmp/user-1/entities/imports/source.png']);
    expect(referenceGenerator.input).toBeNull();
    expect(executionRepository.failed?.errorMessage).toContain('input image is too large');
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
  });

  it('保存済みcreditCostが正なら定価未満でもrefundする', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({ creditCost: 1 });
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
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 1,
      jobId: 'job-1',
    });
  });

  it('保存済みcreditCostが0ならrefundしない', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({ creditCost: 0 });
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
    expect(creditService.refunded).toBeNull();
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

  it('configured image model を完了メタデータに記録する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const service = buildService({
      executionRepository,
      imageModel: 'gpt-image-2-mini',
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(executionRepository.completed?.imageModel).toBe('gpt-image-2-mini');
  });

  it('job ごとに variation profile が変わる', async () => {
    const executionRepositoryA = new FakeExecutionRepository();
    executionRepositoryA.job = buildJob({ id: '1' });
    const generatorA = new FakeReferenceGenerator();
    const serviceA = buildService({
      executionRepository: executionRepositoryA,
      referenceGenerator: generatorA,
    });

    const executionRepositoryB = new FakeExecutionRepository();
    executionRepositoryB.job = buildJob({ id: '4' });
    const generatorB = new FakeReferenceGenerator();
    const serviceB = buildService({
      executionRepository: executionRepositoryB,
      referenceGenerator: generatorB,
    });

    await serviceA.processJob('1');
    await serviceB.processJob('4');

    expect(generatorA.input?.prompt).not.toBe(generatorB.input?.prompt);
  });

  it('返金が失敗した場合でもentity generation jobはfailedへ進めてSQS再試行にしない', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    referenceGenerator.shouldThrow = true;
    const creditService = new FakeCreditService();
    creditService.shouldFailRefund = true;
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
    expect(executionRepository.failed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'generation failed',
    });
  });

  it('failed 更新が0件なら既にterminal化されたjobとしてrefundせずSQS再試行を要求しない', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.failureResult = false;
    const referenceGenerator = new FakeReferenceGenerator();
    referenceGenerator.shouldThrow = true;
    const creditService = new FakeCreditService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(creditService.refunded).toBeNull();
    expect(executionRepository.failed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'generation failed',
    });
  });

  it('generator returns no candidates then job fails and refunds', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    referenceGenerator.candidates = [];
    const creditService = new FakeCreditService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.completed).toBeNull();
    expect(executionRepository.failed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'Entity reference generator returned no candidates',
    });
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
  });

  it('generator returns empty candidate image data then job fails and refunds', async () => {
    const executionRepository = new FakeExecutionRepository();
    const referenceGenerator = new FakeReferenceGenerator();
    referenceGenerator.candidates = [{ imageData: Buffer.alloc(0), mimeType: 'image/png' }];
    const creditService = new FakeCreditService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.completed).toBeNull();
    expect(executionRepository.failed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'Entity reference generator returned empty image data',
    });
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 8,
      jobId: 'job-1',
    });
  });

  it('法人キャラ生成は組織スコープで読み込み、完了を組織利用履歴へ記録する', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({ organizationId: 'org-1' });
    const entityRepository = new FakeEntityReferenceRepository();
    const organizationService = new FakeOrganizationService();
    const service = buildService({
      executionRepository,
      entityRepository,
      organizationService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(entityRepository.lookups).toEqual([
      { entityId: 'entity-1', userId: 'user-1', organizationId: 'org-1' },
    ]);
    expect(organizationService.completedGenerations).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        workId: 'work-1',
        jobId: 'job-1',
        generationType: 'entity_generate',
        metadata: expect.objectContaining({
          entity_id: 'entity-1',
          entity_type: 'character',
          image_model: 'gpt-image-2',
          openai_request_id: 'req-1',
        }),
      }),
    ]);
  });

  it('法人キャラ生成の失敗は個人残高ではなく組織残高へ返金して監査する', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.job = buildJob({ organizationId: 'org-1' });
    const referenceGenerator = new FakeReferenceGenerator();
    referenceGenerator.shouldThrow = true;
    const creditService = new FakeCreditService();
    const organizationService = new FakeOrganizationService();
    const service = buildService({
      executionRepository,
      referenceGenerator,
      creditService,
      organizationService,
    });

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(creditService.refunded).toBeNull();
    expect(organizationService.refunds).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        amount: 8,
        jobId: 'job-1',
      }),
    ]);
    expect(organizationService.failedGenerations).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        workId: 'work-1',
        jobId: 'job-1',
        generationType: 'entity_generate',
        errorMessage: 'generation failed',
      }),
    ]);
  });
});

function buildService(overrides: {
  executionRepository?: FakeExecutionRepository;
  entityRepository?: FakeEntityReferenceRepository;
  promptBuilder?: FakePromptBuilder;
  promptCompiler?: FakePromptCompiler;
  referenceGenerator?: FakeReferenceGenerator;
  imageStorage?: FakeEntityImageStorage;
  creditService?: FakeCreditService;
  storedImageLoader?: FakeStoredImageLoader;
  imageModel?: string;
  organizationService?: FakeOrganizationService;
} = {}): EntityGenerationWorkerService {
  return new EntityGenerationWorkerService(
    overrides.executionRepository ?? new FakeExecutionRepository(),
    overrides.entityRepository ?? new FakeEntityReferenceRepository(),
    overrides.promptBuilder ?? new FakePromptBuilder(),
    overrides.promptCompiler ?? new FakePromptCompiler(),
    overrides.referenceGenerator ?? new FakeReferenceGenerator(),
    overrides.imageStorage ?? new FakeEntityImageStorage(),
    overrides.creditService ?? new FakeCreditService(),
    overrides.storedImageLoader ?? new FakeStoredImageLoader(),
    overrides.imageModel,
    true,
    overrides.organizationService as unknown as OrganizationServicePort | undefined,
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
