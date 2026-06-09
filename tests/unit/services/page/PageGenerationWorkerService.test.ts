import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { PageGenerationInputImage } from '../../../../src/domain/types/pageGeneration.js';
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
  PageGenerationInputImageBuilderPort,
  PageGenerationPlanInput,
  PageGenerationPlannerPort,
  PageImageRendererPort,
  PageImageStoragePort,
  RenderPageImageInput,
  RenderPageImageResult,
  StorePageImageInput,
} from '../../../../src/services/page/PageGenerationWorkerService.js';
import { PageGenerationWorkerService } from '../../../../src/services/page/PageGenerationWorkerService.js';
import type { BuiltPagePrompt, BuildPagePromptInput, PromptBuilderPort } from '../../../../src/services/page/PromptBuilder.js';
import type { PagePromptCompilerPort } from '../../../../src/services/page/PagePromptCompiler.js';

class FakeExecutionRepository implements PageGenerationExecutionRepository {
  public claimedJob: GenerationJob | null = buildJob();
  public completionInput: CompletePageGenerationInput | null = null;
  public failureInput: FailPageGenerationInput | null = null;
  public shouldFailCompletion = false;
  public failureResult = true;

  public async claimQueuedPageGenerationJob(_jobId: string): Promise<GenerationJob | null> {
    return this.claimedJob;
  }

  public async completePageGeneration(input: CompletePageGenerationInput): Promise<boolean> {
    this.completionInput = input;
    return !this.shouldFailCompletion;
  }

  public async failPageGeneration(input: FailPageGenerationInput): Promise<boolean> {
    this.failureInput = input;
    return this.failureResult;
  }
}

class FakePlanner implements PageGenerationPlannerPort {
  public calls = 0;
  public output = 'planner-output';

  public async buildPlan(_input: PageGenerationPlanInput): Promise<string> {
    this.calls += 1;
    return this.output;
  }
}

class FakePromptBuilder implements PromptBuilderPort {
  public calls: BuildPagePromptInput[] = [];
  public builtPrompt: BuiltPagePrompt = {
    draftPrompt: 'page-prompt-draft',
    compilerBrief: '[TASK]\npage compiler brief',
  };

  public async buildPagePrompt(input: BuildPagePromptInput): Promise<BuiltPagePrompt> {
    this.calls.push(input);
    return this.builtPrompt;
  }
}

class FakePromptCompiler implements PagePromptCompilerPort {
  public calls = 0;
  public shouldFail = false;
  public failWithConfigurationError = false;
  public configurationErrorMessage = 'compiler unavailable';
  public compiledPromptText = 'page-prompt-compiled';

  public async compilePrompt(
    _input: { draftPrompt: string; compilerBrief: string },
  ) {
    this.calls += 1;
    if (this.shouldFail) {
      if (this.failWithConfigurationError) {
        throw new ConfigurationError(this.configurationErrorMessage);
      }

      throw new Error('compiler unavailable');
    }

    return {
      prompt: this.compiledPromptText,
      compilerProvider: 'openai' as const,
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_prompt_v2',
    };
  }
}

class FakeInputImageBuilder implements PageGenerationInputImageBuilderPort {
  public calls = 0;

  public async buildInputImages(_input: { userId: string; pageId: string }): Promise<PageGenerationInputImage[]> {
    this.calls += 1;
    return [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:image/png;base64,cmVm' }];
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
  public shouldFailRefund = false;

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
    if (this.shouldFailRefund) {
      throw new Error('refund unavailable');
    }

    return this.getBalance(params.userId);
  }
}

describe('PageGenerationWorkerService', () => {
  it('queued job を processing から completed まで進めて generated_image を保存する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const planner = new FakePlanner();
    const promptBuilder = new FakePromptBuilder();
    const promptCompiler = new FakePromptCompiler();
    const inputImageBuilder = new FakeInputImageBuilder();
    const renderer = new FakeRenderer();
    const storage = new FakeStorage();
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      promptBuilder,
      promptCompiler,
      inputImageBuilder,
      planner,
      renderer,
      storage,
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(planner.calls).toBe(0);
    expect(inputImageBuilder.calls).toBe(1);
    expect(promptBuilder.calls[0]).toMatchObject({
      userId: 'user-1',
      pageId: 'page-1',
    });
    expect(promptCompiler.calls).toBe(1);
    expect(renderer.calls[0]).toMatchObject({
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      prompt: 'page-prompt-compiled',
      quality: 'medium',
      internalPlan: null,
      inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:image/png;base64,cmVm' }],
    });
    expect(storage.calls[0]?.pageId).toBe('page-1');
    expect(executionRepository.completionInput).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      generationMode: 'standard',
      requestKind: 'initial',
      promptMetadata: {
        draftPrompt: 'page-prompt-draft',
        compilerBrief: '[TASK]\npage compiler brief',
        compiledPrompt: 'page-prompt-compiled',
        compiledPromptUsed: true,
        promptCompilerProvider: 'openai',
        compilerModel: 'gpt-5.4-mini',
        compilerPromptVersion: 'page_prompt_v2',
        compilerError: null,
      },
    });
    expect(creditService.refunds).toEqual([]);
  });

  it('thinking job では planner 出力を render に渡す', async () => {
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
    const promptCompiler = new FakePromptCompiler();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      promptCompiler,
      new FakeInputImageBuilder(),
      planner,
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(planner.calls).toBe(1);
    expect(renderer.calls[0]?.internalPlan).toBe('planner-output');
    expect(renderer.calls[0]?.prompt).toBe('page-prompt-compiled');
  });

  it('claim できない job は skip する', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.claimedJob = null;
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
      new FakePlanner(),
      new FakeRenderer(),
      new FakeStorage(),
      new FakeCreditService(),
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'skipped' });
  });

  it('params が壊れている時は復旧情報付きで failed にして refund する', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.claimedJob = buildJob({
      params: {
        page_id: 'page-1',
        request_kind: 'broken',
        generation_mode: 'standard',
        quality: 'medium',
        requires_planner: false,
        previous_page_status: 'editing',
        previous_generation_mode: null,
      } as GenerationJob['params'],
    });
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
      new FakePlanner(),
      new FakeRenderer(),
      new FakeStorage(),
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failureInput).toMatchObject({
      pageId: 'page-1',
      previousStatus: 'editing',
      previousGenerationMode: null,
      errorMessage: 'Page generation job params are invalid',
    });
    expect(creditService.refunds).toHaveLength(1);
  });

  it('render 失敗時は job failed と page state restore にして refund する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const renderer = new FakeRenderer();
    renderer.shouldFail = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
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

  it('creditCost が 0 の failed job は refund を呼ばない', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.claimedJob = buildJob({ creditCost: 0 });
    const renderer = new FakeRenderer();
    renderer.shouldFail = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failureInput?.errorMessage).toBe('renderer unavailable');
    expect(creditService.refunds).toEqual([]);
  });

  it('completion 保存失敗時も failed に戻して refund する', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.shouldFailCompletion = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
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

  it('compiler の設定系失敗時は draft prompt に fallback する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.shouldFail = true;
    promptCompiler.failWithConfigurationError = true;
    const renderer = new FakeRenderer();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      promptCompiler,
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(renderer.calls[0]?.prompt).toBe('page-prompt-draft');
    expect(executionRepository.completionInput?.promptMetadata).toMatchObject({
      compiledPrompt: 'page-prompt-draft',
      compiledPromptUsed: false,
      promptCompilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
      compilerError: 'compiler unavailable',
    });
  });

  it('compiler の予期しない失敗は fallback せず job failed にする', async () => {
    const executionRepository = new FakeExecutionRepository();
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.shouldFail = true;
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      promptCompiler,
      new FakeInputImageBuilder(),
      new FakePlanner(),
      new FakeRenderer(),
      new FakeStorage(),
      new FakeCreditService(),
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(executionRepository.failureInput?.errorMessage).toBe('compiler unavailable');
    expect(executionRepository.completionInput).toBeNull();
  });

  it('compiled prompt が required dialogue を落とした場合は draft prompt に fallback する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const promptBuilder = new FakePromptBuilder();
    promptBuilder.builtPrompt = {
      draftPrompt: 'page-prompt-draft with Emil: "外に出よう。"',
      compilerBrief: [
        '[TASK]',
        'page compiler brief',
        '[PANEL INSTRUCTIONS]',
        '- Dialogue lock: Dialogue lock for panel 4: line 1 must stay assigned to Emil exactly as written: "外に出よう。". Do not omit, paraphrase, merge, split, or reassign these lines.',
      ].join('\n'),
    };
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.compiledPromptText = 'page-prompt-compiled without the authored line';
    const renderer = new FakeRenderer();
    const service = new PageGenerationWorkerService(
      executionRepository,
      promptBuilder,
      promptCompiler,
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(renderer.calls[0]?.prompt).toBe('page-prompt-draft with Emil: "外に出よう。"');
    expect(executionRepository.completionInput?.promptMetadata).toMatchObject({
      compiledPrompt: 'page-prompt-draft with Emil: "外に出よう。"',
      compiledPromptUsed: false,
      promptCompilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
    });
    expect(executionRepository.completionInput?.promptMetadata.compilerError).toContain(
      'compiled prompt dropped required dialogue lines: Emil:外に出よう。',
    );
  });

  it('compiled prompt が required visual lock を落とした場合は draft prompt に fallback する', async () => {
    const executionRepository = new FakeExecutionRepository();
    const promptBuilder = new FakePromptBuilder();
    promptBuilder.builtPrompt = {
      draftPrompt: 'page-prompt-draft with Aki and Rin on the rooftop in a wide front shot',
      compilerBrief: [
        '[TASK]',
        'page compiler brief',
        '[PANEL INSTRUCTIONS]',
        '- Visual lock: Visual lock for panel 1: subjects=Aki|Rin; shot=wide; angle=front; background cue="school rooftop at night".',
      ].join('\n'),
    };
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.compiledPromptText = 'page-prompt-compiled focusing on Aki only in close-up';
    const renderer = new FakeRenderer();
    const service = new PageGenerationWorkerService(
      executionRepository,
      promptBuilder,
      promptCompiler,
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(renderer.calls[0]?.prompt).toBe('page-prompt-draft with Aki and Rin on the rooftop in a wide front shot');
    expect(executionRepository.completionInput?.promptMetadata).toMatchObject({
      compiledPrompt: 'page-prompt-draft with Aki and Rin on the rooftop in a wide front shot',
      compiledPromptUsed: false,
      promptCompilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
    });
    expect(executionRepository.completionInput?.promptMetadata.compilerError).toContain(
      'compiled prompt dropped required visual locks: panel 1',
    );
  });

  it('prompt compiler の設定エラーを保存するときは機密値を伏せる', async () => {
    const executionRepository = new FakeExecutionRepository();
    const promptCompiler = new FakePromptCompiler();
    promptCompiler.shouldFail = true;
    promptCompiler.failWithConfigurationError = true;
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    promptCompiler.configurationErrorMessage = `compiler failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`;
    const renderer = new FakeRenderer();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      promptCompiler,
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      new FakeCreditService(),
    );

    await service.processJob('job-1');

    expect(renderer.calls[0]?.prompt).toBe('page-prompt-draft');
    const compilerError = executionRepository.completionInput?.promptMetadata.compilerError;
    expect(compilerError).toContain('Bearer [redacted]');
    expect(compilerError).not.toContain(fakeApiKey);
    expect(compilerError?.length).toBeLessThanOrEqual(300);
  });

  it('返金が失敗した場合はpage generation jobをfailedへ進めない', async () => {
    const executionRepository = new FakeExecutionRepository();
    const renderer = new FakeRenderer();
    renderer.shouldFail = true;
    const creditService = new FakeCreditService();
    creditService.shouldFailRefund = true;
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      creditService,
    );

    await expect(service.processJob('job-1')).rejects.toThrow('refund unavailable');

    expect(creditService.refunds[0]).toMatchObject({
      userId: 'user-1',
      amount: 10,
      jobId: 'job-1',
    });
    expect(executionRepository.failureInput).toBeNull();
  });

  it('failed 更新が0件なら既にterminal化されたjobとしてSQS再試行を要求しない', async () => {
    const executionRepository = new FakeExecutionRepository();
    executionRepository.failureResult = false;
    const renderer = new FakeRenderer();
    renderer.shouldFail = true;
    const creditService = new FakeCreditService();
    const service = new PageGenerationWorkerService(
      executionRepository,
      new FakePromptBuilder(),
      new FakePromptCompiler(),
      new FakeInputImageBuilder(),
      new FakePlanner(),
      renderer,
      new FakeStorage(),
      creditService,
    );

    const result = await service.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(creditService.refunds).toHaveLength(1);
    expect(executionRepository.failureInput).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'renderer unavailable',
    });
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
