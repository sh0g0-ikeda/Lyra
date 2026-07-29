import { describe, expect, it } from 'vitest';
import type { ProcessEntityGenerationJobResult } from '../../../src/services/entity/EntityGenerationWorkerService.js';
import type { ProcessPageGenerationJobResult } from '../../../src/services/page/PageGenerationWorkerService.js';
import type { ProcessEpisodePageSkeletonJobResult } from '../../../src/services/story/EpisodePageSkeletonWorkerService.js';
import type { ProcessEpisodeStoryAutofillJobResult } from '../../../src/services/story/EpisodeStoryAutofillWorkerService.js';
import { handleGenerationQueue, type WorkerDependencies } from '../../../worker/index.js';

class FakePageGenerationWorkerService {
  public calls: string[] = [];

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.calls.push(jobId);
    return { status: 'processed', jobStatus: 'completed' };
  }
}

class FakeEntityGenerationWorkerService {
  public calls: string[] = [];

  public async processJob(jobId: string): Promise<ProcessEntityGenerationJobResult> {
    this.calls.push(jobId);
    return { status: 'processed', jobStatus: 'completed' };
  }
}

class FakeEpisodeStoryAutofillWorkerService {
  public calls: string[] = [];

  public async processJob(jobId: string): Promise<ProcessEpisodeStoryAutofillJobResult> {
    this.calls.push(jobId);
    return { status: 'processed', jobStatus: 'completed' };
  }
}

class FakeEpisodePageSkeletonWorkerService {
  public calls: string[] = [];

  public async processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult> {
    this.calls.push(jobId);
    return { status: 'processed', jobStatus: 'completed' };
  }
}

describe('episode story autofill worker dispatch', () => {
  it('episode_story_autofill の場合に story autofill worker service を呼ぶ', async () => {
    const pageGenerationWorkerService = new FakePageGenerationWorkerService();
    const entityGenerationWorkerService = new FakeEntityGenerationWorkerService();
    const episodeStoryAutofillWorkerService = new FakeEpisodeStoryAutofillWorkerService();
    const episodePageSkeletonWorkerService = new FakeEpisodePageSkeletonWorkerService();
    const dependencies: WorkerDependencies = {
      pageGenerationWorkerService,
      entityGenerationWorkerService,
      episodeStoryAutofillWorkerService,
      episodePageSkeletonWorkerService,
      episodeExportWorkerService: {
        async processJob() {
          return { status: 'skipped' as const };
        },
      },
    };

    const result = await handleGenerationQueue(
      {
        Records: [
          {
            messageId: 'message-1',
            body: JSON.stringify({
              job_id: '11111111-1111-4111-8111-111111111111',
              job_type: 'episode_story_autofill',
            }),
          },
        ],
      },
      dependencies,
    );

    expect(pageGenerationWorkerService.calls).toEqual([]);
    expect(entityGenerationWorkerService.calls).toEqual([]);
    expect(episodeStoryAutofillWorkerService.calls).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(result).toMatchObject({
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it('episode_page_skeleton の場合に page skeleton worker service を呼ぶ', async () => {
    const pageGenerationWorkerService = new FakePageGenerationWorkerService();
    const entityGenerationWorkerService = new FakeEntityGenerationWorkerService();
    const episodeStoryAutofillWorkerService = new FakeEpisodeStoryAutofillWorkerService();
    const episodePageSkeletonWorkerService = new FakeEpisodePageSkeletonWorkerService();
    const dependencies: WorkerDependencies = {
      pageGenerationWorkerService,
      entityGenerationWorkerService,
      episodeStoryAutofillWorkerService,
      episodePageSkeletonWorkerService,
      episodeExportWorkerService: {
        async processJob() {
          return { status: 'skipped' as const };
        },
      },
    };

    const result = await handleGenerationQueue(
      {
        Records: [
          {
            messageId: 'message-1',
            body: JSON.stringify({
              job_id: '22222222-2222-4222-8222-222222222222',
              job_type: 'episode_page_skeleton',
            }),
          },
        ],
      },
      dependencies,
    );

    expect(pageGenerationWorkerService.calls).toEqual([]);
    expect(entityGenerationWorkerService.calls).toEqual([]);
    expect(episodeStoryAutofillWorkerService.calls).toEqual([]);
    expect(episodePageSkeletonWorkerService.calls).toEqual([
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(result).toMatchObject({
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });
});
