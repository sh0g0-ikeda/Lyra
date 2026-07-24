import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type {
  EntityReferenceContext,
  EntityReferenceImage,
  EntityReferenceSet,
} from '../../../../src/domain/types/entityReference.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EntityReferenceRepository } from '../../../../src/repositories/EntityRepository.js';
import type {
  CreateGenerationJobInput,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type {
  EntityImageStoragePort,
  StoredEntityImage,
} from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';
import type {
  AnalyzeEntityImportInput,
  EntityImportAnalyzerPort,
} from '../../../../src/infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import { EntityReferenceService } from '../../../../src/services/entity/EntityReferenceService.js';
import type { EntityGenerationQueuePort } from '../../../../src/services/entity/EntityGenerationQueue.js';
import type { EntityGenerationRecoveryServicePort } from '../../../../src/services/entity/EntityGenerationRecoveryService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';

const now = new Date('2026-04-25T00:00:00.000Z');
const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

class FakeEntityReferenceRepository implements EntityReferenceRepository {
  public context: EntityReferenceContext | null = buildReferenceContext();
  public savedInput: {
    entityId: string;
    userId: string;
    images: EntityReferenceImage[];
    primaryRefId: string;
    promptSupplement?: string | null;
  } | null = null;
  public deletedRefId: string | null = null;
  public usageCount = 0;

  public async findReferenceContextByIdAndUserId(): Promise<EntityReferenceContext | null> {
    return this.context;
  }

  public async saveConfirmedReferences(input: {
    entityId: string;
    userId: string;
    images: EntityReferenceImage[];
    primaryRefId: string;
    promptSupplement?: string | null;
  }): Promise<EntityReferenceSet | null> {
    this.savedInput = input;

    return {
      entityId: input.entityId,
      images: input.images,
      primaryRefId: input.primaryRefId,
      status: 'partial',
      updatedAt: now,
    };
  }

  public async deleteReferenceImage(input: {
    entityId: string;
    userId: string;
    refId: string;
  }): Promise<EntityReferenceSet | null> {
    this.deletedRefId = input.refId;

    return {
      entityId: input.entityId,
      images: [],
      primaryRefId: null,
      status: 'empty',
      updatedAt: now,
    };
  }

  public async countEntityStateUsageByReferenceId(): Promise<number> {
    return this.usageCount;
  }
}

class FakeGenerationJobRepository implements GenerationJobRepository {
  public createdInput: CreateGenerationJobInput | null = null;
  public attachedMessageId: string | null = null;
  public failedJobId: string | null = null;
  public activeEntityJob: GenerationJob | null = null;
  public activeForUser = 0;
  public activeGlobally = 0;

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    if (input.capacityLimits !== undefined) {
      if (this.activeForUser >= input.capacityLimits.perUser) {
        throw new ConflictError('Generation scope has too many active generation jobs');
      }
      if (this.activeGlobally >= input.capacityLimits.global) {
        throw new ConflictError('Generation queue is temporarily full');
      }
    }
    this.createdInput = input;

    return buildJob({
      id: input.id ?? 'job-1',
      userId: input.userId,
      jobType: input.jobType,
      generationMode: input.generationMode,
      creditCost: input.creditCost,
      params: input.params,
    });
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    return null;
  }

  public async findActivePageGenerationJob(): Promise<GenerationJob | null> {
    return null;
  }

  public async findActiveEntityGenerationJob(): Promise<GenerationJob | null> {
    return this.activeEntityJob;
  }

  public async countActiveGenerationJobsByUser(): Promise<number> {
    return this.activeForUser;
  }

  public async countActiveGenerationJobs(): Promise<number> {
    return this.activeGlobally;
  }

  public async attachQueueMessageId(_jobId: string, messageId: string): Promise<boolean> {
    this.attachedMessageId = messageId;
    return true;
  }

  public async markFailed(jobId: string): Promise<boolean> {
    this.failedJobId = jobId;
    return true;
  }

  public async prepareRetry(): Promise<boolean> {
    return false;
  }
}

class FakeCreditService implements CreditServicePort {
  public consumed: ConsumeCreditsParams | null = null;
  public refunded: RefundCreditsParams | null = null;
  public shouldFailRefund = false;

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    this.consumed = params;
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

class FakeEntityImportAnalyzer implements EntityImportAnalyzerPort {
  public input: AnalyzeEntityImportInput | null = null;
  public shouldFail = false;

  public async analyze(input: AnalyzeEntityImportInput): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
  }> {
    this.input = input;
    if (this.shouldFail) {
      throw new Error('analysis unavailable');
    }

    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine, full body, neutral background',
    };
  }
}

class FakeEntityImageStorage implements EntityImageStoragePort {
  public importedInput: { userId: string; mimeType: string } | null = null;
  public finalizedKeys: string[] = [];

  public async storeImportedImage(input: {
    userId: string;
    imageData: Buffer;
    mimeType: string;
  }): Promise<StoredEntityImage> {
    this.importedInput = { userId: input.userId, mimeType: input.mimeType };
    return {
      s3Key: 'tmp/user-1/entities/imports/source.png',
      cdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    };
  }

  public async storeGeneratedCandidate(): Promise<StoredEntityImage> {
    return {
      s3Key: 'session/user-1/entities/entity-1/job-1-1.png',
      cdnUrl: 'https://cdn.lyra.test/session/user-1/entities/entity-1/job-1-1.png',
    };
  }

  public async finalizeReferenceImage(input: {
    userId: string;
    entityId: string;
    refId: string;
    sourceS3Key: string;
  }): Promise<StoredEntityImage> {
    this.finalizedKeys.push(input.sourceS3Key);

    return {
      s3Key: `saved/${input.userId}/entities/${input.entityId}/${input.refId}.png`,
      cdnUrl: `https://cdn.lyra.test/saved/${input.userId}/entities/${input.entityId}/${input.refId}.png`,
    };
  }
}

class FakeEntityGenerationQueue implements EntityGenerationQueuePort {
  public payload: Record<string, unknown> | null = null;
  public shouldFail = false;

  public async enqueue(payload: { jobId: string; userId: string; entityId: string }): Promise<{
    messageId: string | null;
  }> {
    this.payload = payload;
    if (this.shouldFail) {
      throw new Error('queue down');
    }

    return { messageId: 'message-1' };
  }
}

class FakeEntityGenerationRecoveryService implements EntityGenerationRecoveryServicePort {
  public recoveredEntities: Array<{ userId: string; entityId: string }> = [];

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForEntity(userId: string, entityId: string): Promise<number> {
    this.recoveredEntities.push({ userId, entityId });
    return 0;
  }
}

describe('EntityReferenceService', () => {
  it('generate-reference 前に対象 entity の stale processing job を回収する', async () => {
    const recoveryService = new FakeEntityGenerationRecoveryService();
    const service = buildService({
      recoveryService,
    });

    await service.enqueueReferenceGeneration('user-1', 'entity-1');

    expect(recoveryService.recoveredEntities).toEqual([
      { userId: 'user-1', entityId: 'entity-1' },
    ]);
  });

  it('import-image は S3 保存後に AI 解析結果を返す', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    const storage = new FakeEntityImageStorage();
    const creditService = new FakeCreditService();
    const service = buildService({
      analyzer,
      storage,
      creditService,
    });

    const result = await service.importImage('user-1', {
      entityType: 'character',
      imageBase64: validPngDataUrl,
    });

    expect(storage.importedInput).toEqual({
      userId: 'user-1',
      mimeType: 'image/png',
    });
    expect(analyzer.input?.entityType).toBe('character');
    expect(creditService.consumed).toMatchObject({
      userId: 'user-1',
      cost: 1,
      description: 'Entity import analysis',
    });
    expect(result).toEqual({
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine, full body, neutral background',
      tmpImageS3Key: 'tmp/user-1/entities/imports/source.png',
      tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    });
  });

  it('presigned upload 済み画像は再保存せず既存の解析・credit flow へ渡す', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    const storage = new FakeEntityImageStorage();
    const creditService = new FakeCreditService();
    const service = buildService({ analyzer, storage, creditService });

    const result = await service.importUploadedImage('user-1', {
      entityType: 'character',
      imageData: Buffer.from('iVBORw0KGgo=', 'base64'),
      mimeType: 'image/png',
      tmpImageS3Key: 'tmp/user-1/entities/imports/presigned.png',
      tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/presigned.png',
    });

    expect(storage.importedInput).toBeNull();
    expect(analyzer.input).toMatchObject({
      entityType: 'character',
      dataUrl: validPngDataUrl,
    });
    expect(creditService.consumed).toMatchObject({
      userId: 'user-1',
      cost: 1,
    });
    expect(result.tmpImageS3Key).toBe('tmp/user-1/entities/imports/presigned.png');
  });

  it('presigned upload の magic bytes が MIME と一致しない場合は解析・credit 前に拒否する', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    const creditService = new FakeCreditService();
    const service = buildService({ analyzer, creditService });

    await expect(
      service.importUploadedImage('user-1', {
        entityType: 'character',
        imageData: Buffer.from('not-a-png'),
        mimeType: 'image/png',
        tmpImageS3Key: 'tmp/user-1/entities/imports/presigned.png',
        tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/presigned.png',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(creditService.consumed).toBeNull();
    expect(analyzer.input).toBeNull();
  });

  it('import-image は MIME と実体が一致しない画像を解析前に拒否する', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    const storage = new FakeEntityImageStorage();
    const creditService = new FakeCreditService();
    const service = buildService({
      analyzer,
      storage,
      creditService,
    });

    await expect(
      service.importImage('user-1', {
        entityType: 'character',
        imageBase64: 'data:image/png;base64,YWJj',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(creditService.consumed).toBeNull();
    expect(storage.importedInput).toBeNull();
    expect(analyzer.input).toBeNull();
  });

  it('import-image の解析失敗時は消費クレジットを返金する', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    analyzer.shouldFail = true;
    const creditService = new FakeCreditService();
    const service = buildService({
      analyzer,
      creditService,
    });

    await expect(
      service.importImage('user-1', {
        entityType: 'character',
        imageBase64: validPngDataUrl,
      }),
    ).rejects.toThrow('analysis unavailable');
    expect(creditService.consumed).toMatchObject({
      userId: 'user-1',
      cost: 1,
    });
    expect(creditService.refunded).toMatchObject({
      userId: 'user-1',
      amount: 1,
      description: 'Refund for failed entity import analysis',
    });
  });

  it('import-image analysis disabled の場合はクレジット消費前に CONFLICT になる', async () => {
    const creditService = new FakeCreditService();
    const service = buildService({
      creditService,
      importAnalysisEnabled: false,
    });

    await expect(
      service.importImage('user-1', {
        entityType: 'character',
        imageBase64: validPngDataUrl,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Entity import analysis is temporarily disabled',
    });
    expect(creditService.consumed).toBeNull();
  });

  it('5MB 超の import-image は 422 になる', async () => {
    const service = buildService();
    const oversized = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`;

    await expect(
      service.importImage('user-1', {
        entityType: 'character',
        imageBase64: oversized,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('generate-reference は1crを消費して entity_generate job を作る', async () => {
    const jobs = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const queue = new FakeEntityGenerationQueue();
    const service = buildService({
      generationJobRepository: jobs,
      creditService,
      queue,
    });

    const result = await service.enqueueReferenceGeneration('user-1', 'entity-1');

    expect(result.jobId).toBe(jobs.createdInput?.id);
    expect(creditService.consumed).toMatchObject({
      userId: 'user-1',
      cost: 1,
      jobId: result.jobId,
    });
    expect(jobs.createdInput).toMatchObject({
      id: result.jobId,
      userId: 'user-1',
      jobType: 'entity_generate',
      creditCost: 1,
      capacityLimits: { perUser: 2, global: 10 },
      params: {
        entity_id: 'entity-1',
        entity_type: 'character',
        previous_entity_status: 'draft',
      },
    });
    expect(queue.payload).toEqual({
      jobId: result.jobId,
      userId: 'user-1',
      entityId: 'entity-1',
    });
    expect(jobs.attachedMessageId).toBe('message-1');
  });

  it('generate-reference は import 画像の source_s3_key を job params に積む', async () => {
    const jobs = new FakeGenerationJobRepository();
    const service = buildService({
      generationJobRepository: jobs,
    });

    await service.enqueueReferenceGeneration('user-1', 'entity-1', {
      sourceS3Key: 'tmp/user-1/entities/imports/source.png',
    });

    expect(jobs.createdInput?.params).toMatchObject({
      entity_id: 'entity-1',
      source_s3_key: 'tmp/user-1/entities/imports/source.png',
    });
  });

  it('active entity generation job が残っている場合はクレジット消費前にCONFLICTになる', async () => {
    const jobs = new FakeGenerationJobRepository();
    jobs.activeEntityJob = buildJob({ status: 'queued' });
    const creditService = new FakeCreditService();
    const service = buildService({
      generationJobRepository: jobs,
      creditService,
    });

    await expect(service.enqueueReferenceGeneration('user-1', 'entity-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Entity reference generation is already queued or processing',
    });
    expect(creditService.consumed).toBeNull();
  });

  it('user active generation limit に達している場合はクレジット消費前にCONFLICTになる', async () => {
    const jobs = new FakeGenerationJobRepository();
    jobs.activeForUser = 2;
    const creditService = new FakeCreditService();
    const service = buildService({
      generationJobRepository: jobs,
      creditService,
      capacityLimits: { perUser: 2, global: 10 },
    });

    await expect(service.enqueueReferenceGeneration('user-1', 'entity-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation scope has too many active generation jobs',
    });
    expect(creditService.consumed).toBeNull();
  });

  it('generation disabled の場合はクレジット消費前にCONFLICTになる', async () => {
    const creditService = new FakeCreditService();
    const service = buildService({
      creditService,
      capacityLimits: { perUser: 2, global: 10 },
      generationEnabled: false,
    });

    await expect(service.enqueueReferenceGeneration('user-1', 'entity-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation is temporarily disabled',
    });
    expect(creditService.consumed).toBeNull();
  });

  it('confirm は許可された tmp/session key だけ finalize する', async () => {
    const repository = new FakeEntityReferenceRepository();
    const storage = new FakeEntityImageStorage();
    const service = buildService({
      repository,
      storage,
    });

    const result = await service.confirmReferences('user-1', 'entity-1', {
      selectedS3Keys: ['tmp/user-1/entities/imports/source.png'],
      promptSupplement: 'anime heroine',
    });

    expect(storage.finalizedKeys).toEqual(['tmp/user-1/entities/imports/source.png']);
    expect(repository.savedInput?.primaryRefId).toBe(repository.savedInput?.images[0]?.refId);
    expect(repository.savedInput?.promptSupplement).toBe('anime heroine');
    expect(result.status).toBe('partial');
  });

  it('confirm は他ユーザーの S3 key を拒否する', async () => {
    const service = buildService();

    await expect(
      service.confirmReferences('user-1', 'entity-1', {
        selectedS3Keys: ['tmp/user-2/entities/imports/source.png'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('confirm rejects allowed-prefix source keys with unsupported image extensions', async () => {
    const service = buildService();

    await expect(
      service.confirmReferences('user-1', 'entity-1', {
        selectedS3Keys: ['tmp/user-1/entities/imports/source.txt'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('generate-reference rejects source keys with unsupported image extensions', async () => {
    const service = buildService();

    await expect(
      service.enqueueReferenceGeneration('user-1', 'entity-1', {
        sourceS3Key: 'session/user-1/entities/entity-1/source.txt',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('confirm は 4 枚以上を拒否する', async () => {
    const service = buildService();

    await expect(
      service.confirmReferences('user-1', 'entity-1', {
        selectedS3Keys: [
          'tmp/user-1/entities/imports/1.png',
          'tmp/user-1/entities/imports/2.png',
          'tmp/user-1/entities/imports/3.png',
          'tmp/user-1/entities/imports/4.png',
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('delete は entity_state で利用中の ref を拒否する', async () => {
    const repository = new FakeEntityReferenceRepository();
    repository.usageCount = 1;
    const service = buildService({ repository });

    await expect(service.deleteReference('user-1', 'entity-1', 'ref-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('enqueue補償の返金が失敗してもentity job failed化は行う', async () => {
    const jobs = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    creditService.shouldFailRefund = true;
    const queue = new FakeEntityGenerationQueue();
    queue.shouldFail = true;
    const service = buildService({
      generationJobRepository: jobs,
      creditService,
      queue,
    });

    await expect(service.enqueueReferenceGeneration('user-1', 'entity-1')).rejects.toThrow('queue down');

    expect(creditService.refunded).toMatchObject({
      amount: 1,
      jobId: jobs.createdInput?.id,
    });
    expect(jobs.failedJobId).toBe(jobs.createdInput?.id);
  });
});

function buildService(overrides: {
  repository?: FakeEntityReferenceRepository;
  generationJobRepository?: FakeGenerationJobRepository;
  creditService?: FakeCreditService;
  analyzer?: FakeEntityImportAnalyzer;
  storage?: FakeEntityImageStorage;
  queue?: FakeEntityGenerationQueue;
  recoveryService?: FakeEntityGenerationRecoveryService;
  capacityLimits?: { perUser: number; global: number };
  generationEnabled?: boolean;
  importAnalysisEnabled?: boolean;
} = {}): EntityReferenceService {
  return new EntityReferenceService(
    overrides.repository ?? new FakeEntityReferenceRepository(),
    overrides.generationJobRepository ?? new FakeGenerationJobRepository(),
    overrides.creditService ?? new FakeCreditService(),
    overrides.analyzer ?? new FakeEntityImportAnalyzer(),
    overrides.storage ?? new FakeEntityImageStorage(),
    overrides.queue ?? new FakeEntityGenerationQueue(),
    overrides.capacityLimits,
    overrides.generationEnabled,
    overrides.recoveryService,
    overrides.importAnalysisEnabled,
  );
}

function buildReferenceContext(
  overrides: Partial<EntityReferenceContext> = {},
): EntityReferenceContext {
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
      images: [
        {
          refId: 'ref-1',
          s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
          cdnUrl: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png',
          source: 'upload',
          createdAt: now.toISOString(),
        },
      ],
      primaryRefId: 'ref-1',
      status: 'partial',
      updatedAt: now,
    },
    ...overrides,
  };
}

function buildJob(overrides: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'entity_generate',
    status: 'queued',
    generationMode: null,
    creditCost: 1,
    params: {},
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
