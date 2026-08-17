import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EpisodePageSkeletonExecutionRepository } from '../../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import type { EpisodePagePlanApplyResult } from '../../../../src/domain/types/page.js';
import type { PageSkeletonPersistResult } from '../../../../src/domain/types/storyAi.js';
import { EpisodePageSkeletonWorkerService } from '../../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type {
  PageSkeletonGenerationOptions,
  PreparedPageSkeleton,
  PageSkeletonServicePort,
} from '../../../../src/services/story/PageSkeletonService.js';
import type {
  PageServicePort,
  PreparedEpisodeSkeletonPlan,
} from '../../../../src/services/page/PageService.js';

class FakeEpisodePageSkeletonRepository implements EpisodePageSkeletonExecutionRepository {
  public job: GenerationJob | null = {
    id: '55555555-5555-4555-8555-555555555555',
    userId: 'user-1',
    jobType: 'episode_page_skeleton',
    status: 'queued',
    generationMode: null,
    creditCost: 0,
    params: {
      episode_id: '33333333-3333-4333-8333-333333333333',
      language: 'ja',
      overwrite_existing: true,
      apply_story_plan: false,
    },
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
  };
  public completed: unknown = null;
  public failed: unknown = null;
  public progressUpdates: unknown[] = [];
  public beginCommitCalls = 0;

  public async claimQueuedEpisodePageSkeletonJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async updateEpisodePageSkeletonProgress(input: unknown): Promise<boolean> {
    this.progressUpdates.push(input);
    return true;
  }

  public async beginEpisodePageSkeletonCommit(): Promise<boolean> {
    this.beginCommitCalls += 1;
    return true;
  }

  public async completeEpisodePageSkeleton(input: unknown): Promise<boolean> {
    this.completed = input;
    return true;
  }

  public async failEpisodePageSkeleton(input: unknown): Promise<boolean> {
    this.failed = input;
    return true;
  }
}

class FakePageSkeletonService implements PageSkeletonServicePort {
  public lastOptions: PageSkeletonGenerationOptions | undefined;
  public prepareCalls = 0;
  public persistCalls = 0;
  public rollbackCalls: Array<{ userId: string; episodeId: string; expectedPageCount: number }> = [];
  public persistResult: PageSkeletonPersistResult = {
    pagesCreated: 2,
    panelsCreated: 8,
    replacedExisting: false,
  };

  public prepared: PreparedPageSkeleton = {
    context: {
      episodeId: '33333333-3333-4333-8333-333333333333',
      chapterId: 'chapter-1',
      workId: 'work-1',
      workTitle: 'Lyra',
      workGenre: null,
      worldSetting: null,
      theme: null,
      chapterTitle: null,
      chapterPurpose: null,
      episodeTitle: null,
      episodePurpose: null,
      introduction: 'Start',
      middle: 'Middle',
      climax: 'Climax',
      endingHook: 'End',
      estimatedPages: 2,
      entitiesInvolved: [],
      pageSkeletonGenerated: false,
      existingPageCount: 0,
      entities: [],
      sceneSummaries: [],
    },
    pages: [],
    sourceFingerprint: 'source-fingerprint',
  };

  public async prepareForEpisode(
    _userId: string,
    _episodeId: string,
    options?: PageSkeletonGenerationOptions,
  ): Promise<PreparedPageSkeleton> {
    this.prepareCalls += 1;
    this.lastOptions = options;
    return this.prepared;
  }

  public async persistPrepared(): Promise<PageSkeletonPersistResult> {
    this.persistCalls += 1;
    return this.persistResult;
  }

  public async generateForEpisode(
    _userId: string,
    _episodeId: string,
    options?: PageSkeletonGenerationOptions,
  ): Promise<PageSkeletonPersistResult> {
    this.lastOptions = options;
    return {
      ...this.persistResult,
      replacedExisting: this.persistResult.replacedExisting || options?.overwriteExisting === true,
    };
  }

  public async rollbackFreshSkeleton(
    userId: string,
    episodeId: string,
    expectedPageCount: number,
  ): Promise<boolean> {
    this.rollbackCalls.push({ userId, episodeId, expectedPageCount });
    return true;
  }
}

class FakePageService implements PageServicePort {
  public autofillResult: EpisodePagePlanApplyResult = {
    updatedPageCount: 1,
    updatedPanelCount: 4,
    updatedAssignmentCount: 2,
    filledFieldCount: 8,
    compilerUsed: true,
    compilerProvider: 'openai',
    compilerModel: 'gpt-4o',
    compilerPromptVersion: 'test',
    compilerError: null,
  };
  public prepareCombinedCalls = 0;
  public commitCombinedCalls = 0;
  public prepareError: Error | null = null;

  public async prepareEpisodePlanForSkeleton(): Promise<PreparedEpisodeSkeletonPlan> {
    this.prepareCombinedCalls += 1;
    if (this.prepareError !== null) {
      throw this.prepareError;
    }
    return { compilerUsed: true } as unknown as PreparedEpisodeSkeletonPlan;
  }

  public async commitPreparedEpisodeSkeletonPlan(): Promise<{
    skeletonResult: PageSkeletonPersistResult;
    storyPlanResult: EpisodePagePlanApplyResult;
  }> {
    this.commitCombinedCalls += 1;
    return {
      skeletonResult: { pagesCreated: 2, panelsCreated: 8, replacedExisting: true },
      storyPlanResult: this.autofillResult,
    };
  }

  public async updatePageSettings(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillFromScenes(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillEpisodeFromStory(): Promise<EpisodePagePlanApplyResult> {
    return this.autofillResult;
  }
}

describe('EpisodePageSkeletonWorkerService', () => {
  it('claim直後に取消が確定していれば skeleton 保存を開始せず canceled として完了する', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const pageSkeletonService = new FakePageSkeletonService();
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      new FakePageService(),
      { finalizeCancellationIfRequested: async () => true },
    );

    await expect(worker.processJob('55555555-5555-4555-8555-555555555555')).resolves.toEqual({
      status: 'processed',
      jobStatus: 'cancelled',
    });
    expect(pageSkeletonService.lastOptions).toBeUndefined();
    expect(repository.completed).toBeNull();
    expect(repository.failed).toBeNull();
  });

  it('disables compiler fallback before saving queued page skeletons', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const pageSkeletonService = new FakePageSkeletonService();
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      new FakePageService(),
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(pageSkeletonService.lastOptions).toMatchObject({
      overwriteExisting: true,
      language: 'ja',
      allowCompilerFallback: false,
    });
    expect(pageSkeletonService.prepareCalls).toBe(1);
    expect(pageSkeletonService.persistCalls).toBe(1);
    expect(repository.beginCommitCalls).toBe(1);
    expect(repository.completed).not.toBeNull();
    expect(repository.failed).toBeNull();
  });

  it('骨格の検証後に停止要求が確定した場合は保存フェーズへ入らない', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const pageSkeletonService = new FakePageSkeletonService();
    let cancellationChecks = 0;
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      new FakePageService(),
      {
        finalizeCancellationIfRequested: async () => {
          cancellationChecks += 1;
          return cancellationChecks >= 2;
        },
      },
    );

    await expect(worker.processJob('55555555-5555-4555-8555-555555555555')).resolves.toEqual({
      status: 'processed',
      jobStatus: 'cancelled',
    });
    expect(pageSkeletonService.prepareCalls).toBe(1);
    expect(pageSkeletonService.persistCalls).toBe(0);
    expect(repository.beginCommitCalls).toBe(0);
    expect(repository.completed).toBeNull();
    expect(repository.failed).toBeNull();
  });

  it('結合プランのコンパイル失敗時は新規骨格を一度も保存しない', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    repository.job = {
      ...repository.job!,
      params: {
        episode_id: '33333333-3333-4333-8333-333333333333',
        language: 'ja',
        overwrite_existing: false,
        apply_story_plan: true,
      },
    };
    const pageSkeletonService = new FakePageSkeletonService();
    const pageService = new FakePageService();
    pageService.prepareError = new Error('compiler unavailable');
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      pageService,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(repository.completed).toBeNull();
    expect(repository.failed).not.toBeNull();
    expect(pageSkeletonService.persistCalls).toBe(0);
    expect(pageService.commitCombinedCalls).toBe(0);
    expect(repository.beginCommitCalls).toBe(0);
  });

  it('結合プラン成功時は旧骨格の逐次保存を使わずatomic commitだけを呼ぶ', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    repository.job = {
      ...repository.job!,
      params: {
        episode_id: '33333333-3333-4333-8333-333333333333',
        language: 'ja',
        overwrite_existing: true,
        apply_story_plan: true,
      },
    };
    const pageSkeletonService = new FakePageSkeletonService();
    const pageService = new FakePageService();
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      pageService,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(pageSkeletonService.persistCalls).toBe(0);
    expect(pageService.prepareCombinedCalls).toBe(1);
    expect(pageService.commitCombinedCalls).toBe(1);
    expect(repository.completed).not.toBeNull();
    expect(pageSkeletonService.rollbackCalls).toEqual([]);
  });
});
