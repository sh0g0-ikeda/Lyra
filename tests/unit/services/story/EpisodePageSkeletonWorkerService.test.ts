import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  CommitPreparedEpisodePageSkeletonInput,
  EpisodePageSkeletonExecutionRepository,
} from '../../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import type { PageSkeletonPersistResult } from '../../../../src/domain/types/storyAi.js';
import { EpisodePageSkeletonWorkerService } from '../../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type {
  PageSkeletonGenerationOptions,
  PageSkeletonServicePort,
  PreparedPageSkeleton,
} from '../../../../src/services/story/PageSkeletonService.js';

class FakeEpisodePageSkeletonRepository implements EpisodePageSkeletonExecutionRepository {
  public job: GenerationJob | null = buildJob();
  public failed: unknown = null;
  public failSucceeds = true;
  public commitError: Error | null = null;
  public progressUpdates: unknown[] = [];
  public atomicCommits: unknown[] = [];

  public async claimQueuedEpisodePageSkeletonJob(): Promise<GenerationJob | null> {
    return this.job;
  }

  public async updateEpisodePageSkeletonProgress(input: unknown): Promise<boolean> {
    this.progressUpdates.push(input);
    return true;
  }

  public async failEpisodePageSkeleton(input: unknown): Promise<boolean> {
    this.failed = input;
    return this.failSucceeds;
  }

  public async commitPreparedEpisodePageSkeleton(
    input: CommitPreparedEpisodePageSkeletonInput,
  ): Promise<PageSkeletonPersistResult | null> {
    this.atomicCommits.push(input);
    if (this.commitError !== null) {
      throw this.commitError;
    }
    return { pagesCreated: 2, panelsCreated: 8, replacedExisting: false };
  }
}

class FakePageSkeletonService implements PageSkeletonServicePort {
  public lastOptions: PageSkeletonGenerationOptions | undefined;
  public prepareCalls = 0;
  public prepared: PreparedPageSkeleton = {
    context: {
      episodeId: '33333333-3333-4333-8333-333333333333',
      chapterId: 'chapter-1', workId: 'work-1', workTitle: 'Lyra', workGenre: null,
      worldSetting: null, theme: null, chapterTitle: null, chapterPurpose: null,
      episodeTitle: null, episodePurpose: null, introduction: 'Start', middle: 'Middle',
      climax: 'Climax', endingHook: 'End', estimatedPages: 2, entitiesInvolved: [],
      pageSkeletonGenerated: false, existingPageCount: 0,
      existingPageGraphFingerprint: 'empty-page-graph', entities: [], sceneSummaries: [],
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

  public async generateForEpisode(): Promise<PageSkeletonPersistResult> {
    throw new Error('worker must prepare outside the transaction');
  }

  public async rollbackFreshSkeleton(): Promise<boolean> {
    throw new Error('two-step worker must not manually roll back skeletons');
  }
}

describe('EpisodePageSkeletonWorkerService', () => {
  it('claim直後に取消が確定していれば skeleton 保存を開始せず cancelled として完了する', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const skeletonService = new FakePageSkeletonService();
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      skeletonService,
      { finalizeCancellationIfRequested: async () => true },
    );

    await expect(worker.processJob(repository.job!.id)).resolves.toEqual({
      status: 'processed', jobStatus: 'cancelled',
    });
    expect(skeletonService.prepareCalls).toBe(0);
    expect(repository.atomicCommits).toEqual([]);
  });

  it('骨格をtransaction-bound repositoryで保存し、workerから二重に完了更新しない', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const skeletonService = new FakePageSkeletonService();
    const worker = new EpisodePageSkeletonWorkerService(repository, skeletonService);

    await expect(worker.processJob(repository.job!.id)).resolves.toEqual({
      status: 'processed', jobStatus: 'completed',
    });

    expect(skeletonService.lastOptions).toMatchObject({
      overwriteExisting: true, language: 'ja', allowCompilerFallback: false,
    });
    expect(skeletonService.prepareCalls).toBe(1);
    expect(repository.atomicCommits).toHaveLength(1);
    expect(repository.failed).toBeNull();
  });

  it('骨格の検証後に停止要求が確定した場合はtransactionへ入らない', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const skeletonService = new FakePageSkeletonService();
    let checks = 0;
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      skeletonService,
      { finalizeCancellationIfRequested: async () => ++checks >= 2 },
    );

    await expect(worker.processJob(repository.job!.id)).resolves.toEqual({
      status: 'processed', jobStatus: 'cancelled',
    });
    expect(repository.atomicCommits).toEqual([]);
  });

  it('legacy apply_story_plan trueでも骨格だけをtransactionへ渡す', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    repository.job = buildJob({ params: { ...repository.job!.params, apply_story_plan: true } });
    const skeletonService = new FakePageSkeletonService();
    const worker = new EpisodePageSkeletonWorkerService(repository, skeletonService);

    await expect(worker.processJob(repository.job!.id)).resolves.toEqual({
      status: 'processed', jobStatus: 'completed',
    });

    expect(repository.atomicCommits).toHaveLength(1);
  });

  it('commit結果が曖昧でfailed更新も拒否された場合はqueue再試行のため例外を返す', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    const commitError = new Error('connection closed after commit');
    repository.commitError = commitError;
    repository.failSucceeds = false;
    const worker = new EpisodePageSkeletonWorkerService(
      repository,
      new FakePageSkeletonService(),
    );

    await expect(worker.processJob(repository.job!.id)).rejects.toBe(commitError);
    expect(repository.failed).not.toBeNull();
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: 'user-1', organizationId: null, jobType: 'episode_page_skeleton', status: 'queued',
    generationMode: null, creditCost: 0,
    params: {
      episode_id: '33333333-3333-4333-8333-333333333333', language: 'ja',
      overwrite_existing: true, apply_story_plan: false,
    },
    result: null, sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 0,
    createdAt: new Date('2026-06-26T00:00:00.000Z'), startedAt: null, completedAt: null,
    expiresAt: null, cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}
