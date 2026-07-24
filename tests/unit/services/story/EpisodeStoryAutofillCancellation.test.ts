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
  PageServicePort,
} from '../../../../src/services/page/PageService.js';
import { EpisodeStoryAutofillWorkerService } from '../../../../src/services/story/EpisodeStoryAutofillWorkerService.js';

class FakeExecutionRepository implements EpisodeStoryAutofillExecutionRepository {
  public job = buildJob();
  public cancellationRequested = false;
  public completed = false;
  public failed = false;
  public cancelled = false;
  public commitStarted = false;

  public async claimQueuedEpisodeStoryAutofillJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async updateEpisodeStoryAutofillProgress(
    _input: UpdateEpisodeStoryAutofillProgressInput,
  ): Promise<boolean> {
    return true;
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
    return true;
  }

  public async failEpisodeStoryAutofill(): Promise<boolean> {
    this.failed = true;
    return true;
  }
}

class ControlledPageService implements PageServicePort {
  public executionControl: EpisodePagePlanExecutionControl | undefined;
  public onAutofill: (() => Promise<void>) | null = null;

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
    _progressReporter?: EpisodePagePlanProgressReporter,
    _organizationId?: string | null,
    executionControl?: EpisodePagePlanExecutionControl,
  ): Promise<EpisodePagePlanApplyResult> {
    this.executionControl = executionControl;
    await this.onAutofill?.();
    return buildApplyResult();
  }
}

describe('EpisodeStoryAutofillWorkerService cancellation', () => {
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
  };
}
