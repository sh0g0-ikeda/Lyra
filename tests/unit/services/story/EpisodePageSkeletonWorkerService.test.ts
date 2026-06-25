import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EpisodePageSkeletonExecutionRepository } from '../../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import type { EpisodePagePlanApplyResult } from '../../../../src/domain/types/page.js';
import type { PageSkeletonPersistResult } from '../../../../src/domain/types/storyAi.js';
import { EpisodePageSkeletonWorkerService } from '../../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type {
  PageSkeletonGenerationOptions,
  PageSkeletonServicePort,
} from '../../../../src/services/story/PageSkeletonService.js';
import type { PageServicePort } from '../../../../src/services/page/PageService.js';

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

  public async generateForEpisode(
    _userId: string,
    _episodeId: string,
    options?: PageSkeletonGenerationOptions,
  ): Promise<PageSkeletonPersistResult> {
    this.lastOptions = options;
    return {
      pagesCreated: 2,
      panelsCreated: 8,
      replacedExisting: options?.overwriteExisting === true,
    };
  }
}

class FakePageService implements PageServicePort {
  public async updatePageSettings(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillFromScenes(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillEpisodeFromStory(): Promise<EpisodePagePlanApplyResult> {
    throw new Error('not implemented');
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
});
