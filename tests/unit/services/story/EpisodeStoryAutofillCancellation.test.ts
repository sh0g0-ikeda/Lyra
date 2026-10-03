import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanApplyResult, PageSummary } from '../../../../src/domain/types/page.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { AppLanguage } from '../../../../src/domain/types/language.js';
import type {
  CompleteEpisodeStoryAutofillInput,
  EpisodeStoryAutofillExecutionRepository,
  UpdateEpisodeStoryAutofillProgressInput,
} from '../../../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import type {
  EpisodePagePlanExecutionControl,
  EpisodePagePlanProgressReporter,
  EpisodeStateAutofillOptions,
  PageServicePort,
} from '../../../../src/services/page/PageService.js';
import { EpisodeStoryAutofillWorkerService } from '../../../../src/services/story/EpisodeStoryAutofillWorkerService.js';
import { EpisodeStatePlanError } from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';

class FakeExecutionRepository implements EpisodeStoryAutofillExecutionRepository {
  public job = buildJob();
  public cancellationRequested = false;
  public completed = false;
  public completeCalls = 0;
  public failed = false;
  public cancelled = false;
  public commitStarted = false;
  public failureInput: {
    jobId: string;
    userId: string;
    errorMessage: string;
    stateBlocker?: { code: string };
  } | null = null;
  public progressOutcomes: Array<boolean | Error> = [];
  public progressCallCount = 0;

  public async claimQueuedEpisodeStoryAutofillJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async updateEpisodeStoryAutofillProgress(
    _input: UpdateEpisodeStoryAutofillProgressInput,
  ): Promise<boolean> {
    this.progressCallCount += 1;
    const outcome = this.progressOutcomes.shift() ?? true;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }

  public async isEpisodeStoryAutofillCancellationRequested(): Promise<boolean> {
    return this.cancellationRequested;
  }

  public async beginEpisodeStoryAutofillCommit(): Promise<boolean> {
    if (this.cancellationRequested) {
      return false;
    }
    this.commitStarted = true;
    return true;
  }

  public async cancelEpisodeStoryAutofill(): Promise<boolean> {
    if (!this.cancellationRequested) {
      return false;
    }
    this.cancelled = true;
    return true;
  }

  public async completeEpisodeStoryAutofill(
    _input: CompleteEpisodeStoryAutofillInput,
  ): Promise<boolean> {
    this.completed = true;
    this.completeCalls += 1;
    return true;
  }

  public async failEpisodeStoryAutofill(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
    stateBlocker?: { code: string };
  }): Promise<boolean> {
    this.failed = true;
    this.failureInput = input;
    return true;
  }
}

class ControlledPageService implements PageServicePort {
  public executionControl: EpisodePagePlanExecutionControl | undefined;
  public stateOptions: EpisodeStateAutofillOptions | undefined;
  public onAutofill: ((progressReporter?: EpisodePagePlanProgressReporter) => Promise<void>) | null = null;
  public result = buildApplyResult();
  public autofillCalls = 0;

  public async updatePageSettings(): Promise<PageSummary> {
    throw new Error('not used');
  }

  public async autofillFromScenes(): Promise<never> {
    throw new Error('not used');
  }

  public async autofillEpisodeFromStory(
    _userId: string,
    _episodeId: string,
    _language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
    _organizationId?: string | null,
    executionControl?: EpisodePagePlanExecutionControl,
    stateOptions?: EpisodeStateAutofillOptions,
  ): Promise<EpisodePagePlanApplyResult> {
    this.autofillCalls += 1;
    this.executionControl = executionControl;
    this.stateOptions = stateOptions;
    await this.onAutofill?.(progressReporter);
    return this.result;
  }
}

describe('EpisodeStoryAutofillWorkerService cancellation', () => {
  it.each([
    ['falseを返す', false],
    ['例外を投げる', new Error('database unavailable')],
  ])('開始時の進捗保存が%s場合はprovider処理を開始しない', async (_caseName, progressOutcome) => {
    const repository = new FakeExecutionRepository();
    repository.progressOutcomes = [progressOutcome];
    const pageService = new ControlledPageService();
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'failed' });
    expect(repository.progressCallCount).toBe(1);
    expect(pageService.autofillCalls).toBe(0);
    expect(repository.commitStarted).toBe(false);
    expect(repository.failed).toBe(true);
    expect(repository.failureInput?.errorMessage).toBe(
      'Episode story autofill progress could not be persisted',
    );
    expect(repository.failureInput?.errorMessage).not.toContain('database unavailable');
  });

  it.each([
    ['falseを返す', false],
    ['例外を投げる', new Error('database unavailable')],
  ])('処理中の進捗保存が%s場合は後続provider処理と保存を開始しない', async (_caseName, progressOutcome) => {
    const repository = new FakeExecutionRepository();
    repository.progressOutcomes = [true, progressOutcome];
    const pageService = new ControlledPageService();
    let providerContinuationReached = false;
    pageService.onAutofill = async (progressReporter) => {
      await progressReporter?.({
        stage: 'compiling_chunk',
        message: 'Compiling page details.',
        currentChunk: 1,
        totalChunks: 2,
      });
      providerContinuationReached = true;
      await pageService.executionControl?.beginCommit();
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'failed' });
    expect(repository.progressCallCount).toBe(2);
    expect(pageService.autofillCalls).toBe(1);
    expect(providerContinuationReached).toBe(false);
    expect(repository.commitStarted).toBe(false);
    expect(repository.failed).toBe(true);
    expect(repository.failureInput?.errorMessage).toBe(
      'Episode story autofill progress could not be persisted',
    );
    expect(repository.failureInput?.errorMessage).not.toContain('database unavailable');
  });

  it('通常の話全体反映もPageService内でjobを完了しworkerから重複完了しない', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'completed' });
    expect(repository.completeCalls).toBe(0);
  });

  it('PageServiceが原子的job完了を証明しない場合は成功にしない', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    pageService.result = { ...buildApplyResult(), jobCompletedAtomically: undefined };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'failed' });
    expect(repository.completeCalls).toBe(0);
    expect(repository.failed).toBe(true);
  });

  it('状態反映v1はページ保存transaction内でjobを完了しworkerから重複完了しない', async () => {
    const repository = new FakeExecutionRepository();
    repository.job.params = {
      ...repository.job.params,
      state_autofill_version: 'v1',
      state_assignment_policy: 'overwrite_existing',
    };
    const pageService = new ControlledPageService();
    pageService.result = {
      ...buildApplyResult(),
      statePlanVersion: 'episode_state_plan_v1',
      stateAssignmentPolicy: 'overwrite_existing',
      stateTransitions: [],
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);
    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'completed' });
    expect(repository.completeCalls).toBe(0);
  });
  it('状態割当の競合は安全なcodeを失敗jobへ残す', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    pageService.onAutofill = async () => {
      throw new EpisodeStatePlanError('STATE_ASSIGNMENT_CONFLICT', 'manual assignment conflict');
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);
    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'failed' });
    expect(repository.failureInput?.stateBlocker?.code).toBe('STATE_ASSIGNMENT_CONFLICT');
    expect(repository.commitStarted).toBe(false);
  });
  it('受付時に確定した状態反映versionと上書き方針をworkerへ渡す', async () => {
    const repository = new FakeExecutionRepository();
    repository.job.params = {
      ...repository.job.params,
      state_autofill_version: 'v1',
      state_assignment_policy: 'overwrite_existing',
    };
    const pageService = new ControlledPageService();
    pageService.result = {
      ...buildApplyResult(),
      statePlanVersion: 'episode_state_plan_v1',
      stateAssignmentPolicy: 'overwrite_existing',
      stateTransitions: [],
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);
    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'completed' });
    expect(pageService.stateOptions).toEqual({
      statePlanVersion: 'episode_state_plan_v1',
      stateAssignmentPolicy: 'overwrite_existing',
    });
  });

  it('未知の状態反映versionは旧処理へ読み替えず失敗にする', async () => {
    const repository = new FakeExecutionRepository();
    repository.job.params = { ...repository.job.params, state_autofill_version: 'unknown' };
    const pageService = new ControlledPageService();
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);
    expect(await worker.processJob('job-1')).toMatchObject({ jobStatus: 'failed' });
    expect(pageService.executionControl).toBeUndefined();
    expect(repository.failed).toBe(true);
  });
  it('コンパイル中に停止要求を検知すると failed にせず cancelled にする', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    pageService.onAutofill = async () => {
      repository.cancellationRequested = true;
      await pageService.executionControl?.checkpoint();
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    const result = await worker.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'cancelled' });
    expect(repository.cancelled).toBe(true);
    expect(repository.failed).toBe(false);
    expect(repository.completed).toBe(false);
  });

  it('保存開始直前に停止要求がある場合は保存せず cancelled にする', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    pageService.onAutofill = async () => {
      repository.cancellationRequested = true;
      await pageService.executionControl?.beginCommit();
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    const result = await worker.processJob('job-1');

    expect(result.jobStatus).toBe('cancelled');
    expect(repository.commitStarted).toBe(false);
    expect(repository.cancelled).toBe(true);
    expect(repository.failed).toBe(false);
  });

  it('外部API失敗と停止要求が重なった場合は停止を優先して cancelled にする', async () => {
    const repository = new FakeExecutionRepository();
    const pageService = new ControlledPageService();
    pageService.onAutofill = async () => {
      repository.cancellationRequested = true;
      throw new Error('provider request failed');
    };
    const worker = new EpisodeStoryAutofillWorkerService(repository, pageService, true);

    const result = await worker.processJob('job-1');

    expect(result).toEqual({ status: 'processed', jobStatus: 'cancelled' });
    expect(repository.cancelled).toBe(true);
    expect(repository.failed).toBe(false);
    expect(repository.completed).toBe(false);
  });
});

function buildJob(): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    organizationId: null,
    jobType: 'episode_story_autofill',
    status: 'processing',
    generationMode: null,
    creditCost: 0,
    params: { episode_id: 'episode-1', language: 'ja' },
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    startedAt: new Date('2026-07-14T00:00:01.000Z'),
    completedAt: null,
    expiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
  };
}

function buildApplyResult(): EpisodePagePlanApplyResult {
  return {
    updatedPageCount: 1,
    updatedPanelCount: 4,
    updatedAssignmentCount: 1,
    filledFieldCount: 8,
    compilerUsed: true,
    compilerProvider: 'openai',
    compilerModel: 'test-model',
    compilerPromptVersion: 'test-version',
    compilerError: null,
    jobCompletedAtomically: true,
  };
}
