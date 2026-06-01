import { describe, expect, it } from 'vitest';
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
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';

const now = new Date('2026-04-25T00:00:00.000Z');

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

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    this.createdInput = input;

    return buildJob({
      id: 'job-1',
      userId: input.userId,
      jobType: input.jobType,
      generationMode: input.generationMode,
      creditCost: input.creditCost,
      params: input.params,
    });
  }

  public async findById(): Promise<GenerationJob | null> {
    return null;
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    return null;
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
    return this.getBalance();
  }
}

class FakeEntityImportAnalyzer implements EntityImportAnalyzerPort {
  public input: AnalyzeEntityImportInput | null = null;

  public async analyze(input: AnalyzeEntityImportInput): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
  }> {
    this.input = input;

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

  public async enqueue(payload: { jobId: string; userId: string; entityId: string }): Promise<{
    messageId: string | null;
  }> {
    this.payload = payload;
    return { messageId: 'message-1' };
  }
}

describe('EntityReferenceService', () => {
  it('import-image は S3 保存後に AI 解析結果を返す', async () => {
    const analyzer = new FakeEntityImportAnalyzer();
    const storage = new FakeEntityImageStorage();
    const service = buildService({
      analyzer,
      storage,
    });

    const result = await service.importImage('user-1', {
      entityType: 'character',
      imageBase64: 'data:image/png;base64,YWJj',
    });

    expect(storage.importedInput).toEqual({
      userId: 'user-1',
      mimeType: 'image/png',
    });
    expect(analyzer.input?.entityType).toBe('character');
    expect(result).toEqual({
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine, full body, neutral background',
      tmpImageS3Key: 'tmp/user-1/entities/imports/source.png',
      tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    });
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

  it('generate-reference は 8cr を消費して entity_generate job を作る', async () => {
    const jobs = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const queue = new FakeEntityGenerationQueue();
    const service = buildService({
      generationJobRepository: jobs,
      creditService,
      queue,
    });

    const result = await service.enqueueReferenceGeneration('user-1', 'entity-1');

    expect(result).toEqual({ jobId: 'job-1' });
    expect(creditService.consumed).toMatchObject({
      userId: 'user-1',
      cost: 1,
    });
    expect(jobs.createdInput).toMatchObject({
      userId: 'user-1',
      jobType: 'entity_generate',
      creditCost: 1,
      params: {
        entity_id: 'entity-1',
        entity_type: 'character',
        previous_entity_status: 'draft',
      },
    });
    expect(queue.payload).toEqual({
      jobId: 'job-1',
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
});

function buildService(overrides: {
  repository?: FakeEntityReferenceRepository;
  generationJobRepository?: FakeGenerationJobRepository;
  creditService?: FakeCreditService;
  analyzer?: FakeEntityImportAnalyzer;
  storage?: FakeEntityImageStorage;
  queue?: FakeEntityGenerationQueue;
} = {}): EntityReferenceService {
  return new EntityReferenceService(
    overrides.repository ?? new FakeEntityReferenceRepository(),
    overrides.generationJobRepository ?? new FakeGenerationJobRepository(),
    overrides.creditService ?? new FakeCreditService(),
    overrides.analyzer ?? new FakeEntityImportAnalyzer(),
    overrides.storage ?? new FakeEntityImageStorage(),
    overrides.queue ?? new FakeEntityGenerationQueue(),
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
