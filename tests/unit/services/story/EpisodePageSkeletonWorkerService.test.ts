import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EpisodePageSkeletonExecutionRepository } from '../../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import type { EpisodePagePlanApplyResult } from '../../../../src/domain/types/page.js';
import type { PageSkeletonPersistResult } from '../../../../src/domain/types/storyAi.js';
import { EpisodePageSkeletonWorkerService } from '../../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type {
  PageSkeletonGenerationOptions,
  PageSkeletonPreparation,
  PageSkeletonServicePort,
} from '../../../../src/services/story/PageSkeletonService.js';
import type { PageServicePort } from '../../../../src/services/page/PageService.js';
import type {
  GenerationJobCancellationControlRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';

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

  public async claimQueuedEpisodePageSkeletonJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async updateEpisodePageSkeletonProgress(input: unknown): Promise<boolean> {
    this.progressUpdates.push(input);
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
  public rollbackCalls: Array<{ userId: string; episodeId: string; expectedPageCount: number }> = [];
  public persistCalls: PageSkeletonPreparation[] = [];
  public onPrepare: () => void = () => undefined;
  public persistResult: PageSkeletonPersistResult = {
    pagesCreated: 2,
    panelsCreated: 8,
    replacedExisting: false,
  };

  public async generateForEpisode(
    userId: string,
    episodeId: string,
    options?: PageSkeletonGenerationOptions,
  ): Promise<PageSkeletonPersistResult> {
    const preparation = await this.prepareForEpisode(userId, episodeId, options);
    return this.persistPreparedForEpisode(preparation);
  }

  public async prepareForEpisode(
    userId: string,
    episodeId: string,
    options?: PageSkeletonGenerationOptions,
  ): Promise<PageSkeletonPreparation> {
    this.lastOptions = options;
    this.onPrepare();
    return {
      userId,
      episodeId,
      organizationId: null,
      overwriteExisting: options?.overwriteExisting === true,
      pages: [],
    };
  }

  public async persistPreparedForEpisode(
    preparation: PageSkeletonPreparation,
  ): Promise<PageSkeletonPersistResult> {
    this.persistCalls.push(preparation);
    return {
      ...this.persistResult,
      replacedExisting: this.persistResult.replacedExisting || preparation.overwriteExisting,
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

class FakeCancellationControl implements GenerationJobCancellationControlRepository {
  public cancellationRequested = false;
  public finalizeCalls = 0;
  public beginCommitCalls = 0;

  public async requestCancellation(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async finalizeCancellation(): Promise<boolean> {
    this.finalizeCalls += 1;
    return this.cancellationRequested;
  }

  public async beginCommit(): Promise<boolean> {
    this.beginCommitCalls += 1;
    return !this.cancellationRequested;
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
    expect(repository.completed).not.toBeNull();
    expect(repository.failed).toBeNull();
  });

  it('rolls back a newly created skeleton when story plan application cannot use the compiler', async () => {
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
    pageService.autofillResult = {
      ...pageService.autofillResult,
      compilerUsed: false,
      compilerProvider: 'fallback',
      compilerError: 'compiler unavailable',
    };
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      pageService,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(repository.completed).toBeNull();
    expect(repository.failed).not.toBeNull();
    expect(pageSkeletonService.rollbackCalls).toEqual([
      {
        userId: 'user-1',
        episodeId: '33333333-3333-4333-8333-333333333333',
        expectedPageCount: 2,
      },
    ]);
  });

  it('does not rollback overwritten pages when story plan application fails', async () => {
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
    pageService.autofillResult = {
      ...pageService.autofillResult,
      compilerUsed: false,
      compilerProvider: 'fallback',
      compilerError: 'compiler unavailable',
    };
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      pageService,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'failed' });
    expect(pageSkeletonService.rollbackCalls).toEqual([]);
  });

  it('AI準備中の停止要求はpage skeletonを保存せずcancelledへ確定する', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const pageSkeletonService = new FakePageSkeletonService();
    const cancellationControl = new FakeCancellationControl();
    pageSkeletonService.onPrepare = () => {
      cancellationControl.cancellationRequested = true;
    };
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      new FakePageService(),
      cancellationControl,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'cancelled' });
    expect(pageSkeletonService.persistCalls).toEqual([]);
    expect(repository.completed).toBeNull();
    expect(repository.failed).toBeNull();
  });

  it('停止要求なしではcommit gateを確定してからpage skeletonを保存する', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const pageSkeletonService = new FakePageSkeletonService();
    const cancellationControl = new FakeCancellationControl();
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      pageSkeletonService,
      new FakePageService(),
      cancellationControl,
    );

    const result = await worker.processJob('55555555-5555-4555-8555-555555555555');

    expect(result).toEqual({ status: 'processed', jobStatus: 'completed' });
    expect(cancellationControl.beginCommitCalls).toBe(1);
    expect(pageSkeletonService.persistCalls).toHaveLength(1);
    expect(repository.completed).not.toBeNull();
  });
});
