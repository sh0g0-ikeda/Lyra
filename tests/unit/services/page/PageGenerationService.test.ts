import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { PageGenerationContext, PageGenerationStateUpdate, PageSummary } from '../../../../src/domain/types/page.js';
import type { PageGenerationQueuePayload } from '../../../../src/domain/types/pageGeneration.js';
import type {
  CreateGenerationJobInput,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type {
  EntityPrimaryReferenceImage,
  EntityRepository,
} from '../../../../src/repositories/EntityRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type {
  EnqueuePageGenerationResult,
  PageGenerationQueuePort,
} from '../../../../src/services/page/PageGenerationQueue.js';
import { ModeSelector } from '../../../../src/services/page/ModeSelector.js';
import { PageGenerationService } from '../../../../src/services/page/PageGenerationService.js';

const userId = 'user-1';
const pageId = '11111111-1111-4111-8111-111111111111';

class FakePageRepository implements PageRepository {
  public context: PageGenerationContext | null = buildPageContext();
  public updates: PageGenerationStateUpdate[] = [];
  public shouldRejectUpdate = false;

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(): Promise<PageSummary | null> {
    return null;
  }

  public async findGenerationContextByIdAndUserId(
    requestedPageId: string,
    _userId: string,
  ): Promise<PageGenerationContext | null> {
    return this.context === null ? null : { ...this.context, pageId: requestedPageId };
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    this.updates.push(input);
    return !this.shouldRejectUpdate;
  }

  public async updateGeneratedImageAndState(): Promise<boolean> {
    throw new Error('not used');
  }

  public async findPromptContextByIdAndUserId(): Promise<null> {
    return null;
  }

  public async findAutofillContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async updatePageSettings(): Promise<PageSummary | null> {
    throw new Error('not used');
  }
}

class FakeGenerationJobRepository implements GenerationJobRepository {
  public created: CreateGenerationJobInput | null = null;
  public attachedMessageId: string | null = null;
  public failedJobId: string | null = null;
  public failedMessage: string | null = null;
  public shouldFailAttach = false;

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    this.created = input;
    return buildJob({
      generationMode: input.generationMode,
      creditCost: input.creditCost,
      params: input.params,
    });
  }

  public async findById(): Promise<GenerationJob | null> {
    return buildJob();
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    return buildJob();
  }

  public async attachQueueMessageId(_jobId: string, messageId: string): Promise<boolean> {
    if (this.shouldFailAttach) {
      throw new Error('failed to store queue message id');
    }

    this.attachedMessageId = messageId;
    return true;
  }

  public async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    this.failedJobId = jobId;
    this.failedMessage = errorMessage;
    return true;
  }

  public async prepareRetry(): Promise<boolean> {
    return true;
  }
}

class FakeEntityRepository implements EntityRepository {
  public entities = [
    buildEntity('entity-1', 'Aoi', 'character'),
    buildEntity('entity-2', 'Leo', 'character'),
  ];

  public references: EntityPrimaryReferenceImage[] = [
    {
      entityId: 'entity-1',
      refId: 'ref-1',
      s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
      cdnUrl: 'https://img.lyra.test/entity-1.png',
    },
    {
      entityId: 'entity-2',
      refId: 'ref-2',
      s3Key: 'saved/user-1/entities/entity-2/ref-2.png',
      cdnUrl: 'https://img.lyra.test/entity-2.png',
    },
  ];

  public async create(): Promise<never> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(): Promise<null> {
    return null;
  }

  public async findByWorkIdAndUserId() {
    return this.entities;
  }

  public async countByIdsAndWorkIdAndUserId(): Promise<number> {
    return 0;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
  ): Promise<EntityPrimaryReferenceImage[]> {
    return this.references.filter((reference) => entityIds.includes(reference.entityId));
  }

  public async update(): Promise<null> {
    return null;
  }

  public async delete(): Promise<boolean> {
    return false;
  }
}

class FakeCreditService implements CreditServicePort {
  public consumed: ConsumeCreditsParams[] = [];
  public refunded: RefundCreditsParams[] = [];

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    this.consumed.push(params);
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunded.push(params);
    return this.getBalance();
  }
}

class FakeQueue implements PageGenerationQueuePort {
  public shouldFail = false;
  public lastPayload: PageGenerationQueuePayload | null = null;

  public async enqueue(payload: PageGenerationQueuePayload): Promise<EnqueuePageGenerationResult> {
    this.lastPayload = payload;
    if (this.shouldFail) {
      throw new Error('queue down');
    }

    return { messageId: 'message-1' };
  }
}

describe('PageGenerationService', () => {
  it('initial standard は10crでenqueueする', async () => {
    const pageRepository = new FakePageRepository();
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const queue = new FakeQueue();
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      queue,
      new ModeSelector(),
    );

    const result = await service.enqueuePageGeneration(userId, pageId);

    expect(result).toEqual({ jobId: '44444444-4444-4444-8444-444444444444' });
    expect(creditService.consumed[0]).toMatchObject({
      cost: 1,
      description: 'Page generation (standard)',
    });
    expect(jobRepository.created?.params).toMatchObject({
      page_id: pageId,
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'designing',
      previous_generation_mode: null,
    });
    expect(pageRepository.updates[0]).toEqual({
      status: 'generating',
      generationMode: 'standard',
    });
    expect(queue.lastPayload).toMatchObject({
      pageId,
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      creditCost: 1,
      requiresPlanner: false,
      previousPageStatus: 'designing',
      previousGenerationMode: null,
    });
  });

  it('initial thinking は14crになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({
      frameCount: 5,
      panels: [
        buildPanelContext('entity-1'),
        buildPanelContext('entity-2'),
        buildPanelContext('entity-3'),
        buildPanelContext('entity-4'),
        buildPanelContext('entity-5'),
      ],
    });
    const creditService = new FakeCreditService();
    const queue = new FakeQueue();
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      creditService,
      queue,
      new ModeSelector(),
    );

    await service.enqueuePageGeneration(userId, pageId);

    expect(creditService.consumed[0]?.cost).toBe(1);
    expect(queue.lastPayload?.generationMode).toBe('thinking');
  });

  it('generated_image があるページは22crのregenerateになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({
      generatedImage: {
        s3Key: 'session/user/page.png',
        cdnUrl: 'https://img.lyra.app/page.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
      status: 'generated',
    });
    const creditService = new FakeCreditService();
    const queue = new FakeQueue();
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      creditService,
      queue,
      new ModeSelector(),
    );

    await service.enqueuePageGeneration(userId, pageId);

    expect(creditService.consumed[0]?.cost).toBe(1);
    expect(queue.lastPayload).toMatchObject({
      requestKind: 'regenerate',
      quality: 'high',
      requiresPlanner: true,
    });
  });

  it('panelが無い場合はVALIDATION_ERRORになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ panels: [], frameCount: 0 });
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(ValidationError);
  });

  it('confirmed pageはCONFLICTになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'confirmed' });
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('generating pageはCONFLICTになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'generating' });
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('pageが存在しない場合はNOT_FOUNDになる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = null;
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('queue失敗時はrefundと状態復元を行う', async () => {
    const pageRepository = new FakePageRepository();
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const queue = new FakeQueue();
    queue.shouldFail = true;
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      queue,
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });

    expect(jobRepository.failedJobId).toBe('44444444-4444-4444-8444-444444444444');
    expect(pageRepository.updates).toEqual([
      { status: 'generating', generationMode: 'standard' },
      { status: 'designing', generationMode: null },
    ]);
    expect(creditService.refunded[0]).toMatchObject({
      amount: 1,
      description: 'Refund for failed page generation enqueue',
      jobId: '44444444-4444-4444-8444-444444444444',
    });
  });
  it('page state updateに失敗した場合はjob failedとrefundで補償する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.shouldRejectUpdate = true;
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'Failed to update page generation state',
    });

    expect(jobRepository.failedJobId).toBe('44444444-4444-4444-8444-444444444444');
    expect(creditService.refunded[0]).toMatchObject({
      amount: 1,
      jobId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('queue message idの保存失敗ではenqueue済みジョブを失敗扱いしない', async () => {
    const pageRepository = new FakePageRepository();
    const jobRepository = new FakeGenerationJobRepository();
    jobRepository.shouldFailAttach = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
    );

    const result = await service.enqueuePageGeneration(userId, pageId);

    expect(result).toEqual({ jobId: '44444444-4444-4444-8444-444444444444' });
    expect(jobRepository.failedJobId).toBeNull();
    expect(creditService.refunded).toEqual([]);
    expect(pageRepository.updates).toEqual([{ status: 'generating', generationMode: 'standard' }]);
  });
});

it('frame count must be present before generation', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({ frameCount: 0 });
  const service = new PageGenerationService(
    pageRepository,
    new FakeEntityRepository(),
    new FakeGenerationJobRepository(),
    new FakeCreditService(),
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(ValidationError);
});

it('frame count and panel count must match before generation', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    frameCount: 6,
    panels: [
      buildPanelContext('entity-1'),
      buildPanelContext('entity-2'),
      buildPanelContext('entity-3'),
      buildPanelContext('entity-4'),
    ],
  });
  const service = new PageGenerationService(
    pageRepository,
    new FakeEntityRepository(),
    new FakeGenerationJobRepository(),
    new FakeCreditService(),
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toBeInstanceOf(ValidationError);
});

it('assigned character reference が未確定なら VALIDATION_ERROR になる', async () => {
  const pageRepository = new FakePageRepository();
  const entityRepository = new FakeEntityRepository();
  entityRepository.references = [entityRepository.references[0]!];
  pageRepository.context = buildPageContext({
    frameCount: 2,
    panels: [buildPanelContext('entity-1'), buildPanelContext('entity-2')],
  });
  const service = new PageGenerationService(
    pageRepository,
    entityRepository,
    new FakeGenerationJobRepository(),
    new FakeCreditService(),
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: expect.stringContaining('Leo'),
  });
});

function buildPageContext(overrides: Partial<PageGenerationContext> = {}): PageGenerationContext {
  return {
    pageId,
    workId: 'work-1',
    layoutConfig: {},
    generatedImage: null,
    generationMode: null,
    status: 'designing',
    frameCount: 1,
    panels: [buildPanelContext('entity-1')],
    ...overrides,
  };
}

function buildPanelContext(entityId: string): PageGenerationContext['panels'][number] {
  return {
    panelId: `panel-${entityId}`,
    entities: [
      {
        entityId,
        role: 'primary',
        expression: 'calm',
        customExpression: null,
        action: 'standing_firm',
        customAction: null,
        position: 'center',
        facingDirection: null,
        effectNote: null,
        stateId: null,
      },
    ],
  };
}

function buildEntity(
  id: string,
  name: string,
  entityType: 'character' | 'nonhuman' | 'object',
) {
  return {
    id,
    workId: 'work-1',
    userId,
    entityType,
    name,
    freeDescription: null,
    promptSupplement: null,
    structuredFields: {},
    speechProfile: {},
    status: 'draft' as const,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };
}

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId,
    jobType: 'page_generate',
    status: 'queued',
    generationMode: 'standard',
    creditCost: 1,
    params: {
      page_id: pageId,
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'designing',
      previous_generation_mode: null,
    },
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}
