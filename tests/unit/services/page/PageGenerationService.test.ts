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
  EntityResolvedReferenceImage,
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
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';
import { ModeSelector } from '../../../../src/services/page/ModeSelector.js';
import type { PageGenerationRecoveryServicePort } from '../../../../src/services/page/PageGenerationRecoveryService.js';
import { PageGenerationService } from '../../../../src/services/page/PageGenerationService.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../../../src/domain/constants/generation.js';

const userId = 'user-1';
const pageId = '11111111-1111-4111-8111-111111111111';

class FakePageRepository implements PageRepository {
  public context: PageGenerationContext | null = buildPageContext();
  public updates: PageGenerationStateUpdate[] = [];
  public shouldRejectUpdate = false;
  public eventLog: string[] | null = null;

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
    this.eventLog?.push(`page:${input.status}`);
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
  public activePageJob: GenerationJob | null = null;
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
    this.created = input;
    return buildJob({
      id: input.id ?? '44444444-4444-4444-8444-444444444444',
      generationMode: input.generationMode,
      creditCost: input.creditCost,
      params: input.params,
    });
  }

  public async findByIdAndUserId(): Promise<GenerationJob | null> {
    return buildJob();
  }

  public async findActivePageGenerationJob(): Promise<GenerationJob | null> {
    return this.activePageJob;
  }

  public async findActiveEntityGenerationJob(): Promise<GenerationJob | null> {
    return null;
  }

  public async countActiveGenerationJobsByUser(): Promise<number> {
    return this.activeForUser;
  }

  public async countActiveGenerationJobs(): Promise<number> {
    return this.activeGlobally;
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
  public lastFindByWorkArgs: { workId: string; userId: string; organizationId: string | null } | null = null;
  public lastReferenceArgs:
    | { entityIds: string[]; workId: string; userId: string; organizationId: string | null }
    | null = null;

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
  public resolvedReferences: EntityResolvedReferenceImage[] = [];

  public async create(): Promise<never> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(): Promise<null> {
    return null;
  }

  public async findByWorkIdAndUserId(
    workId: string,
    requestedUserId: string,
    organizationId: string | null = null,
  ) {
    this.lastFindByWorkArgs = { workId, userId: requestedUserId, organizationId };
    return this.entities;
  }

  public async countByIdsAndWorkIdAndUserId(): Promise<number> {
    return 0;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    requestedUserId: string,
    organizationId: string | null = null,
  ): Promise<EntityPrimaryReferenceImage[]> {
    this.lastReferenceArgs = { entityIds, workId, userId: requestedUserId, organizationId };
    return this.references.filter((reference) => entityIds.includes(reference.entityId));
  }

  public async findResolvedReferenceImagesByAssignmentsAndUserId(): Promise<EntityResolvedReferenceImage[]> {
    return this.resolvedReferences;
  }

  public async update(): Promise<null> {
    return null;
  }

  public async delete(): Promise<boolean> {
    return false;
  }
}

class FakeOrganizationService {
  public consumed: unknown[] = [];
  public async requireMembership(): Promise<unknown> {
    return {};
  }

  public async consumeCredits(input: unknown): Promise<unknown> {
    this.consumed.push(input);
    return {};
  }
}

class FakeCreditService implements CreditServicePort {
  public consumed: ConsumeCreditsParams[] = [];
  public refunded: RefundCreditsParams[] = [];
  public shouldFailRefund = false;
  public consumeError: unknown = null;
  public eventLog: string[] | null = null;

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(): Promise<CreditBalanceSnapshot> {
    return this.getBalance();
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    this.eventLog?.push('credit:consume');
    if (this.consumeError !== null) {
      throw this.consumeError;
    }
    this.consumed.push(params);
    return this.getBalance();
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunded.push(params);
    if (this.shouldFailRefund) {
      throw new Error('refund unavailable');
    }

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

class FakeRecoveryService implements PageGenerationRecoveryServicePort {
  public pageIds: string[] = [];

  public async recoverAllStaleJobs(): Promise<number> {
    return 0;
  }

  public async recoverStaleJobsForPage(_userId: string, pageId: string): Promise<number> {
    this.pageIds.push(pageId);
    return 0;
  }
}

describe('PageGenerationService', () => {
  it('generate前に対象pageのstale processing jobを回収する', async () => {
    const recoveryService = new FakeRecoveryService();
    const service = new PageGenerationService(
      new FakePageRepository(),
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
      recoveryService,
    );

    await service.enqueuePageGeneration(userId, pageId);

    expect(recoveryService.pageIds).toEqual([pageId]);
  });

  it('initial standard は3crでenqueueする', async () => {
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

    expect(result.jobId).toBe(jobRepository.created?.id);
    expect(creditService.consumed[0]).toMatchObject({
      cost: 3,
      description: 'Page generation (standard)',
      jobId: result.jobId,
    });
    expect(jobRepository.created?.creditCost).toBe(3);
    expect(jobRepository.created?.id).toEqual(expect.any(String));
    expect(jobRepository.created?.capacityLimits).toEqual({ perUser: 2, global: 10 });
    expect(jobRepository.created?.params).toMatchObject({
      page_id: pageId,
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'designing',
      previous_generation_mode: null,
      render_style: 'color',
    });
    expect(pageRepository.updates[0]).toEqual({
      status: 'generating',
      generationMode: 'standard',
      expectedStatus: 'designing',
    });
    expect(queue.lastPayload).toMatchObject({
      jobId: result.jobId,
      pageId,
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      creditCost: 3,
      requiresPlanner: false,
      previousPageStatus: 'designing',
      previousGenerationMode: null,
    });
  });

  it('白黒生成の場合に通常料金を維持してstyleをjobに固定する', async () => {
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      new FakePageRepository(), new FakeEntityRepository(), jobRepository,
      creditService, new FakeQueue(), new ModeSelector(),
    );

    await service.enqueuePageGeneration(userId, pageId, null, 'monochrome');

    expect(jobRepository.created?.params).toMatchObject({ render_style: 'monochrome' });
    expect(creditService.consumed[0]?.cost).toBe(3);
  });

  it('pageをgeneratingへ予約してからcreditを消費する', async () => {
    const eventLog: string[] = [];
    const pageRepository = new FakePageRepository();
    pageRepository.eventLog = eventLog;
    const creditService = new FakeCreditService();
    creditService.eventLog = eventLog;
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      creditService,
      new FakeQueue(),
      new ModeSelector(),
    );

    await service.enqueuePageGeneration(userId, pageId);

    expect(eventLog).toEqual(['page:generating', 'credit:consume']);
  });

  it('4体目以降の参照画像を加算してenqueueする', async () => {
    const pageRepository = new FakePageRepository();
    const entityRepository = new FakeEntityRepository();
    entityRepository.entities = Array.from({ length: 5 }, (_, index) =>
      buildEntity(`entity-${index + 1}`, `Character ${index + 1}`, 'character'),
    );
    entityRepository.references = entityRepository.entities.map((entity, index) =>
      buildReference(entity.id, index + 1),
    );
    pageRepository.context = buildPageContext({
      frameCount: 5,
      panels: entityRepository.entities.map((entity) => buildPanelContext(entity.id)),
    });
    const creditService = new FakeCreditService();
    const queue = new FakeQueue();
    const service = new PageGenerationService(
      pageRepository,
      entityRepository,
      new FakeGenerationJobRepository(),
      creditService,
      queue,
      new ModeSelector(),
    );

    await service.enqueuePageGeneration(userId, pageId);

    expect(creditService.consumed[0]?.cost).toBe(5);
    expect(queue.lastPayload?.creditCost).toBe(5);
    expect(queue.lastPayload?.generationMode).toBe('thinking');
  });

  it('法人Workspaceのページ生成前検査では法人スコープでキャラと参照画像を読む', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ organizationId: 'org-1' });
    const entityRepository = new FakeEntityRepository();
    const organizationService = new FakeOrganizationService();
    const service = new PageGenerationService(
      pageRepository,
      entityRepository,
      new FakeGenerationJobRepository(),
      new FakeCreditService(),
      new FakeQueue(),
      new ModeSelector(),
      undefined,
      undefined,
      true,
      organizationService as unknown as OrganizationServicePort,
    );

    await service.enqueuePageGeneration(userId, pageId, 'org-1');

    expect(entityRepository.lastFindByWorkArgs).toEqual({
      workId: 'work-1',
      userId,
      organizationId: 'org-1',
    });
    expect(entityRepository.lastReferenceArgs).toEqual({
      entityIds: ['entity-1'],
      workId: 'work-1',
      userId,
      organizationId: 'org-1',
    });
    expect(organizationService.consumed[0]).toMatchObject({
      userId,
      organizationId: 'org-1',
      workId: 'work-1',
      eventType: 'generation.started',
    });
  });

  it('generated_image があるページは3crのregenerateになる', async () => {
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

    expect(creditService.consumed[0]?.cost).toBe(3);
    expect(queue.lastPayload).toMatchObject({
      requestKind: 'regenerate',
      creditCost: 3,
      quality: 'medium',
      requiresPlanner: false,
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

  it('active page generation job が残っている場合はクレジット消費前にCONFLICTになる', async () => {
    const jobRepository = new FakeGenerationJobRepository();
    jobRepository.activePageJob = buildJob({ status: 'processing' });
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      new FakePageRepository(),
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Page generation is already queued or processing',
    });
    expect(creditService.consumed).toEqual([]);
  });

  it('user active generation limit に達している場合はクレジット消費前にCONFLICTになる', async () => {
    const jobRepository = new FakeGenerationJobRepository();
    jobRepository.activeForUser = 2;
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      new FakePageRepository(),
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
      undefined,
      { perUser: 2, global: 10 },
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation scope has too many active generation jobs',
    });
    expect(creditService.consumed).toEqual([]);
  });

  it('generation disabled の場合はクレジット消費前にCONFLICTになる', async () => {
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      new FakePageRepository(),
      new FakeEntityRepository(),
      new FakeGenerationJobRepository(),
      creditService,
      new FakeQueue(),
      new ModeSelector(),
      undefined,
      { perUser: 2, global: 10 },
      false,
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation is temporarily disabled',
    });
    expect(creditService.consumed).toEqual([]);
  });

  it('global active generation limit に達している場合はクレジット消費前にCONFLICTになる', async () => {
    const jobRepository = new FakeGenerationJobRepository();
    jobRepository.activeGlobally = 10;
    const creditService = new FakeCreditService();
    const service = new PageGenerationService(
      new FakePageRepository(),
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
      undefined,
      { perUser: 2, global: 10 },
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation queue is temporarily full',
    });
    expect(creditService.consumed).toEqual([]);
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

    expect(jobRepository.failedJobId).toBe(jobRepository.created?.id);
    expect(pageRepository.updates).toEqual([
      { status: 'generating', generationMode: 'standard', expectedStatus: 'designing' },
      { status: 'designing', generationMode: null },
    ]);
    expect(creditService.refunded[0]).toMatchObject({
      amount: 3,
      description: 'Refund for failed page generation enqueue',
      jobId: jobRepository.created?.id,
    });
  });
  it('page state updateに失敗した場合はcreditを消費せずjobだけfailedで補償する', async () => {
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
      code: 'CONFLICT',
      message: 'Page generation state changed before enqueue',
    });

    expect(jobRepository.failedJobId).toBe(jobRepository.created?.id);
    expect(creditService.consumed).toEqual([]);
    expect(creditService.refunded).toEqual([]);
  });

  it('停止要求がcredit consumeに勝った場合はpageを復元して再課金しない', async () => {
    const pageRepository = new FakePageRepository();
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    creditService.consumeError = Object.assign(new Error('cancelled'), {
      code: 'P0001',
      constraint: 'generation_job_credit_consume_active',
    });
    const service = new PageGenerationService(
      pageRepository,
      new FakeEntityRepository(),
      jobRepository,
      creditService,
      new FakeQueue(),
      new ModeSelector(),
    );

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Page generation was stopped before it entered the queue',
    });

    expect(jobRepository.failedJobId).toBe(jobRepository.created?.id);
    expect(pageRepository.updates).toEqual([
      { status: 'generating', generationMode: 'standard', expectedStatus: 'designing' },
      { status: 'designing', generationMode: null },
    ]);
    expect(creditService.consumed).toEqual([]);
    expect(creditService.refunded).toEqual([]);
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

    expect(result.jobId).toBe(jobRepository.created?.id);
    expect(jobRepository.failedJobId).toBeNull();
    expect(creditService.refunded).toEqual([]);
    expect(pageRepository.updates).toEqual([
      { status: 'generating', generationMode: 'standard', expectedStatus: 'designing' },
    ]);
  });

  it('enqueue補償の返金が失敗してもpage job failed化と状態復元は行う', async () => {
    const pageRepository = new FakePageRepository();
    const jobRepository = new FakeGenerationJobRepository();
    const creditService = new FakeCreditService();
    creditService.shouldFailRefund = true;
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

    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toThrow('Failed to enqueue page generation job');

    expect(creditService.refunded[0]).toMatchObject({
      amount: 3,
      jobId: jobRepository.created?.id,
    });
    expect(jobRepository.failedJobId).toBe(jobRepository.created?.id);
    expect(pageRepository.updates).toEqual([
      { status: 'generating', generationMode: 'standard', expectedStatus: 'designing' },
      { status: 'designing', generationMode: null },
    ]);
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

it('新しい派生状態がページに含まれる場合はjob作成とクレジット消費前に停止する', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    panels: [{
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId: 'state-1' }],
    }],
  });
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

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: expect.stringContaining('state'),
  });
  expect(jobRepository.created).toBeNull();
  expect(creditService.consumed).toEqual([]);
});

it.each([
  ['Hy4 primary + GPT named state', 'hy4-preview', 'gpt-image-2'],
  ['GPT primary + Hy4 named state', 'gpt-image-2', 'hy4-preview'],
])('%sはjob作成とクレジット消費前に409で停止する', async (_label, primaryModel, stateModel) => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    panels: [{
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId: 'state-1' }],
    }],
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.references = [{
    entityId: 'entity-1', refId: 'primary-ref',
    s3Key: 'saved/user-1/entities/entity-1/primary-ref.png',
    cdnUrl: 'https://img.lyra.test/primary-ref.png', imageModel: primaryModel,
    providerModelId: primaryModel, provider: primaryModel === 'hy4-preview' ? 'tencent' : 'openai',
  }];
  entityRepository.resolvedReferences = [{
    entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷',
    stateExists: true, ownerUserId: 'user-1', refId: 'state-ref',
    s3Key: 'saved/user-1/entities/entity-1/state-ref.png', cdnUrl: null,
    imageModel: stateModel, providerModelId: stateModel,
    provider: stateModel === 'hy4-preview' ? 'tencent' : 'openai',
  }];
  const jobs = new FakeGenerationJobRepository();
  const credits = new FakeCreditService();
  const service = new PageGenerationService(
    pageRepository, entityRepository, jobs, credits, new FakeQueue(), new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
    code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409,
  });
  expect(jobs.created).toBeNull();
  expect(credits.consumed).toEqual([]);
});

// Compatibility contract: alias assignments share one base image; confirmed variants remain distinct.
it.each([4, 13])('同じbase画像を参照する旧状態が%i件ある場合は従来の3クレジットで受付する', async (assignmentCount) => {
  const states = Array.from({ length: assignmentCount }, (_, index) => index === 0 ? null : `legacy-${index}`);
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    frameCount: states.length,
    panels: states.map((stateId) => ({
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId }],
    })),
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.resolvedReferences = states.map((stateId) => ({
    entityId: 'entity-1', stateId, stateName: stateId, stateDescription: null,
    stateExists: true, ownerUserId: 'user-1', refId: 'base-ref',
    s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null,
  }));
  const jobs = new FakeGenerationJobRepository();
  const credits = new FakeCreditService();
  const queue = new FakeQueue();
  const service = new PageGenerationService(
    pageRepository, entityRepository, jobs, credits, queue, new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).resolves.toMatchObject({ jobId: expect.any(String) });
  expect(jobs.created?.creditCost).toBe(3);
  expect(credits.consumed).toEqual([expect.objectContaining({ cost: 3 })]);
  expect(queue.lastPayload?.creditCost).toBe(3);
});

it('旧状態の別名と確定済みvariantが混在する場合は実際の4参照分を課金する', async () => {
  const states = [null, 'legacy-1', 'legacy-2', 'variant-1', 'variant-2', 'variant-3'];
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true, frameCount: states.length,
    panels: states.map((stateId) => ({
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId }],
    })),
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.resolvedReferences = states.map((stateId) => {
    const isVariant = stateId?.startsWith('variant-') === true;
    const refId = isVariant ? stateId : 'base-ref';
    return {
      entityId: 'entity-1', stateId, stateName: stateId,
      stateDescription: isVariant ? 'confirmed state' : null,
      stateExists: true, ownerUserId: 'user-1', refId,
      s3Key: `saved/user-1/entities/entity-1/${refId}.png`, cdnUrl: null, imageModel: null,
    };
  });
  const jobs = new FakeGenerationJobRepository();
  const credits = new FakeCreditService();
  await new PageGenerationService(
    pageRepository, entityRepository, jobs, credits, new FakeQueue(), new ModeSelector(),
  ).enqueuePageGeneration(userId, pageId);

  expect(jobs.created?.creditCost).toBe(4);
  expect(credits.consumed).toEqual([expect.objectContaining({ cost: 4 })]);
});

it.each([12, 13])('実際に異なるvariant参照が%i件の場合は画像上限と料金を維持する', async (count) => {
  const states = Array.from({ length: count }, (_, index) => `variant-${index}`);
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true, frameCount: count,
    panels: states.map((stateId) => ({
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId }],
    })),
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.resolvedReferences = states.map((stateId) => ({
    entityId: 'entity-1', stateId, stateName: stateId, stateDescription: 'confirmed state',
    stateExists: true, ownerUserId: 'user-1', refId: stateId,
    s3Key: `saved/user-1/entities/entity-1/${stateId}.png`, cdnUrl: null, imageModel: null,
  }));
  const jobs = new FakeGenerationJobRepository();
  const credits = new FakeCreditService();
  const service = new PageGenerationService(
    pageRepository, entityRepository, jobs, credits, new FakeQueue(), new ModeSelector(),
  );
  if (count > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
    await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(jobs.created).toBeNull();
    expect(credits.consumed).toEqual([]);
  } else {
    await service.enqueuePageGeneration(userId, pageId);
    expect(jobs.created?.creditCost).toBe(12);
    expect(credits.consumed).toEqual([expect.objectContaining({ cost: 12 })]);
  }
});

it('確定した派生状態と既定状態が同じ人物にある場合は2参照として受付する', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    frameCount: 2,
    panels: [
      buildPanelContext('entity-1'),
      {
        ...buildPanelContext('entity-1'),
        entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId: 'state-1' }],
      },
    ],
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.resolvedReferences = [
    { entityId: 'entity-1', stateId: null, stateName: null, stateDescription: null,
      stateExists: true, ownerUserId: 'user-1', refId: 'base-ref',
      s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null },
    { entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷',
      stateExists: true, ownerUserId: 'user-1', refId: 'state-ref',
      s3Key: 'saved/user-1/entities/entity-1/states/state-1/state-ref.png', cdnUrl: null, imageModel: 'gpt-image-2' },
  ];
  const jobRepository = new FakeGenerationJobRepository();
  const creditService = new FakeCreditService();
  const service = new PageGenerationService(
    pageRepository, entityRepository, jobRepository, creditService, new FakeQueue(), new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).resolves.toMatchObject({ jobId: expect.any(String) });
  expect(jobRepository.created?.creditCost).toBe(3);
  expect(creditService.consumed).toHaveLength(1);
});

it('従来の注記だけの状態は既存の参照画像と料金で生成を続ける', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    panels: [{
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId: 'legacy-state-1' }],
    }],
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.resolvedReferences = [{
    entityId: 'entity-1', stateId: 'legacy-state-1', stateName: null,
    stateDescription: null, stateExists: true, ownerUserId: 'user-1',
    refId: 'ref-1', s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
    cdnUrl: 'https://img.lyra.test/entity-1.png', imageModel: null,
  }];
  const jobRepository = new FakeGenerationJobRepository();
  const creditService = new FakeCreditService();
  const service = new PageGenerationService(
    pageRepository,
    entityRepository,
    jobRepository,
    creditService,
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).resolves.toMatchObject({ jobId: expect.any(String) });
  expect(jobRepository.created).not.toBeNull();
  expect(creditService.consumed).toHaveLength(1);
});

it('注記だけのobject状態に画像がない場合も従来どおり生成を受け付ける', async () => {
  const pageRepository = new FakePageRepository();
  pageRepository.context = buildPageContext({
    hasVariantState: true,
    panels: [{
      ...buildPanelContext('entity-1'),
      entities: [{ ...buildPanelContext('entity-1').entities[0]!, stateId: 'legacy-state-1' }],
    }],
  });
  const entityRepository = new FakeEntityRepository();
  entityRepository.entities = [buildEntity('entity-1', 'Door', 'object')];
  entityRepository.references = [];
  entityRepository.resolvedReferences = [{
    entityId: 'entity-1', stateId: 'legacy-state-1', stateName: null,
    stateDescription: null, stateExists: true, ownerUserId: null,
    refId: null, s3Key: null, cdnUrl: null, imageModel: null,
  }];
  const jobRepository = new FakeGenerationJobRepository();
  const creditService = new FakeCreditService();
  const service = new PageGenerationService(
    pageRepository, entityRepository, jobRepository, creditService,
    new FakeQueue(), new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).resolves.toMatchObject({ jobId: expect.any(String) });
  expect(jobRepository.created).not.toBeNull();
  expect(creditService.consumed).toHaveLength(1);
});

it('page generation reference image count が上限を超えるとクレジット消費前に VALIDATION_ERROR になる', async () => {
  const entityCount = PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES + 1;
  const pageRepository = new FakePageRepository();
  const entityRepository = new FakeEntityRepository();
  const creditService = new FakeCreditService();

  entityRepository.entities = Array.from({ length: entityCount }, (_, index) =>
    buildEntity(`entity-${index + 1}`, `Character ${index + 1}`, 'character'),
  );
  entityRepository.references = entityRepository.entities.map((entity, index) => ({
    entityId: entity.id,
    refId: `ref-${index + 1}`,
    s3Key: `saved/user-1/entities/${entity.id}/ref-${index + 1}.png`,
    cdnUrl: `https://img.lyra.test/${entity.id}.png`,
  }));
  pageRepository.context = buildPageContext({
    frameCount: entityCount,
    panels: entityRepository.entities.map((entity) => buildPanelContext(entity.id)),
  });

  const service = new PageGenerationService(
    pageRepository,
    entityRepository,
    new FakeGenerationJobRepository(),
    creditService,
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: expect.stringContaining('reference images'),
  });
  expect(creditService.consumed).toEqual([]);
});

it('object reference image count が上限を超える場合もクレジット消費前に VALIDATION_ERROR になる', async () => {
  const entityCount = PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES + 1;
  const pageRepository = new FakePageRepository();
  const entityRepository = new FakeEntityRepository();
  const creditService = new FakeCreditService();

  entityRepository.entities = Array.from({ length: entityCount }, (_, index) =>
    buildEntity(`entity-${index + 1}`, `Object ${index + 1}`, 'object'),
  );
  entityRepository.references = entityRepository.entities.map((entity, index) => ({
    entityId: entity.id,
    refId: `ref-${index + 1}`,
    s3Key: `saved/user-1/entities/${entity.id}/ref-${index + 1}.png`,
    cdnUrl: `https://img.lyra.test/${entity.id}.png`,
  }));
  pageRepository.context = buildPageContext({
    frameCount: entityCount,
    panels: entityRepository.entities.map((entity) => buildPanelContext(entity.id)),
  });

  const service = new PageGenerationService(
    pageRepository,
    entityRepository,
    new FakeGenerationJobRepository(),
    creditService,
    new FakeQueue(),
    new ModeSelector(),
  );

  await expect(service.enqueuePageGeneration(userId, pageId)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: expect.stringContaining('reference images'),
  });
  expect(creditService.consumed).toEqual([]);
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

function buildReference(entityId: string, index: number): EntityPrimaryReferenceImage {
  return {
    entityId,
    refId: `ref-${index}`,
    s3Key: `saved/user-1/entities/${entityId}/ref-${index}.png`,
    cdnUrl: `https://img.lyra.test/${entityId}.png`,
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
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}
