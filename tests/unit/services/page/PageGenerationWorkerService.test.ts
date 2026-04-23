import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  CompletePageGenerationInput,
  FailPageGenerationInput,
  PageGenerationExecutionRepository,
} from '../../../../src/repositories/PageGenerationExecutionRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';
import type {
  PageGenerationPlannerPort,
  PageGenerationPlanInput,
  PageImageRendererPort,
  PageImageStoragePort,
  RenderPageImageInput,
  RenderPageImageResult,
  StorePageImageInput,
} from '../../../../src/services/page/PageGenerationWorkerService.js';
import { PageGenerationWorkerService } from '../../../../src/services/page/PageGenerationWorkerService.js';

class FakeExecutionRepository implements PageGenerationExecutionRepository {
  public claimedJob: GenerationJob | null = buildJob();
  public completionInput: CompletePageGenerationInput | null = null;
  public failureInput: FailPageGenerationInput | null = null;
  public shouldFailCompletion = false;

  public async claimQueuedPageGenerationJob(_jobId: string): Promise<GenerationJob | null> {
    return this.claimedJob;
  }

  public async completePageGeneration(input: CompletePageGenerationInput): Promise<boolean> {
    this.completionInput = input;
    return !this.shouldFailCompletion;
  }

  public async failPageGeneration(input: FailPageGenerationInput): Promise<boolean> {
    this.failureInput = input;
    return true;
  }
}

class FakePlanner implements PageGenerationPlannerPort {
  public calls = 0;

  public async buildPlan(_input: PageGenerationPlanInput): Promise<string> {
    this.calls += 1;
    return 'planner-output';
  }
}

class FakeRenderer implements PageImageRendererPort {
  public calls: RenderPageImageInput[] = [];
  public shouldFail = false;

  public async render(input: RenderPageImageInput): Promise<RenderPageImageResult> {
    this.calls.push(input);
    if (this.shouldFail) {
      throw new Error('renderer unavailable');
    }

    return {
      imageData: Buffer.from('image-bytes'),
      mimeType: 'image/png',
      openaiRequestId: 'openai-1',
      costUsd: 0.07,
    };
  }
}

class FakeStorage implements PageImageStoragePort {
  public calls: StorePageImageInput[] = [];

  public async store(input: StorePageImageInput) {
    this.calls.push(input);
    return {
      s3Key: `session/${input.userId}/pages/${input.pageId}/result.png`,
      cdnUrl: `https://cdn.lyra.test/${input.pageId}.png`,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public refunds: RefundCreditsParams[] = [];

  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    this.refunds.push(params);
    return this.getBalance(params.userId);
  }
}

describe('PageGenerationWorkerService', () => {
  it('queued jobをprocessingからcompletedまで進めてgenerated_imageを保存する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const planner = new FakePlanner();
    const renderer = new FakeRenderer();
    const storage = new FakeStorage();
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      planner,
      renderer,
      storage,
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(planner.calls).toBe(0);
    expect(renderer.calls[0]).toMatchObject({
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      internalPlan: null,
    });
    expect(storage.calls[0]?.pageId).toBe('page-1');
    expect(executionRepository.completionInput).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      generationMode: 'standard',
      requestKind: 'initial',
    });
    expect(creditService.refunds).toEqual([]);
  });

  it('thinking jobではplanner出力をrenderに渡す', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.claimedJob = buildJob({
      generationMode: 'thinking',
      params: {
        ...buildJob().params,
        generation_mode: 'thinking',
        requires_planner: true,
      },
    });
    const planner = new FakePlanner();
    const renderer = new FakeRenderer();
    const service = new PageGenerationWorkerService(
      executionRepository,
      planner,
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(planner.calls).toBe(1);
    expect(renderer.calls[0]?.internalPlan).toBe('planner-output');
  });

  it('claimできないjobはskipする', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.claimedJob = null;
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePlanner(),
      new FakeRenderer(),
      new FakeStorage(),
      new FakeCreditService(),
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'skipped' });
  });

  it('render失敗時はjob failedとpage state restoreにしてrefundする', async () => {
    const executionRepository = new FakeExecutionRepository();
    const renderer = new FakeRenderer();
    renderer.shouldFail = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failureInput).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'renderer unavailable',
      pageId: 'page-1',
      previousStatus: 'designing',
      previousGenerationMode: null,
    });
    expect(creditService.refunds[0]).toMatchObject({
      userId: 'user-1',
      amount: 10,
      description: 'Refund for failed page generation job',
      jobId: 'job-1',
    });
  });

  it('completion保存失敗時もfailedに落としてrefundする', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.shouldFailCompletion = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePlanner(),
      new FakeRenderer(),
      new FakeStorage(),
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failureInput?.errorMessage).toBe('Failed to persist generated page image');
    expect(creditService.refunds).toHaveLength(1);
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'page_generate',
    status: 'processing',
    generationMode: 'standard',
    creditCost: 10,
    params: {
      page_id: 'page-1',
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
    startedAt: new Date('2026-04-24T00:01:00.000Z'),
    completedAt: null,
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}
