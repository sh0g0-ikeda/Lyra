import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { AppLanguage } from '../../../../src/domain/types/language.js';
import type { CreateGenerationJobInput } from '../../../../src/repositories/GenerationJobRepository.js';
import { EpisodePageSkeletonService } from '../../../../src/services/story/EpisodePageSkeletonService.js';
import type {
  EnqueueEpisodePageSkeletonResult,
  EpisodePageSkeletonQueuePayload,
  EpisodePageSkeletonQueuePort,
} from '../../../../src/services/story/EpisodePageSkeletonQueue.js';
import { EpisodeStoryAutofillService } from '../../../../src/services/story/EpisodeStoryAutofillService.js';
import type {
  EnqueueEpisodeStoryAutofillResult,
  EpisodeStoryAutofillQueuePayload,
  EpisodeStoryAutofillQueuePort,
} from '../../../../src/services/story/EpisodeStoryAutofillQueue.js';

const now = new Date('2026-06-08T00:00:00.000Z');

class FakeEpisodeStoryAutofillRepository {
  public activeJob: GenerationJob | null = null;
  public createdJobs: CreateGenerationJobInput[] = [];
  public failedJobs: Array<{ jobId: string; errorMessage: string }> = [];
  public attachedMessages: Array<{ jobId: string; messageId: string }> = [];

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    this.createdJobs.push(input);
    return buildJob({
      id: input.id ?? 'created-story-job',
      userId: input.userId,
      jobType: input.jobType,
      status: 'queued',
      params: input.params,
      creditCost: input.creditCost,
    });
  }

  public async attachQueueMessageId(jobId: string, messageId: string): Promise<boolean> {
    this.attachedMessages.push({ jobId, messageId });
    return true;
  }

  public async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    this.failedJobs.push({ jobId, errorMessage });
    if (this.activeJob?.id === jobId) {
      this.activeJob = { ...this.activeJob, status: 'failed', errorMessage, completedAt: now };
    }
    return true;
  }

  public async findActiveEpisodeStoryAutofillJob(): Promise<GenerationJob | null> {
    return this.activeJob;
  }
}

class FakeEpisodePageSkeletonRepository {
  public activeJob: GenerationJob | null = null;
  public createdJobs: CreateGenerationJobInput[] = [];
  public failedJobs: Array<{ jobId: string; errorMessage: string }> = [];
  public attachedMessages: Array<{ jobId: string; messageId: string }> = [];

  public async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
    this.createdJobs.push(input);
    return buildJob({
      id: input.id ?? 'created-skeleton-job',
      userId: input.userId,
      jobType: input.jobType,
      status: 'queued',
      params: input.params,
      creditCost: input.creditCost,
    });
  }

  public async attachQueueMessageId(jobId: string, messageId: string): Promise<boolean> {
    this.attachedMessages.push({ jobId, messageId });
    return true;
  }

  public async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    this.failedJobs.push({ jobId, errorMessage });
    if (this.activeJob?.id === jobId) {
      this.activeJob = { ...this.activeJob, status: 'failed', errorMessage, completedAt: now };
    }
    return true;
  }

  public async findActiveEpisodePageSkeletonJob(): Promise<GenerationJob | null> {
    return this.activeJob;
  }
}

class FakeStoryQueue implements EpisodeStoryAutofillQueuePort {
  public payloads: EpisodeStoryAutofillQueuePayload[] = [];

  public async enqueue(
    payload: EpisodeStoryAutofillQueuePayload,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    this.payloads.push(payload);
    return { messageId: 'story-message-1' };
  }
}

class FakeSkeletonQueue implements EpisodePageSkeletonQueuePort {
  public payloads: EpisodePageSkeletonQueuePayload[] = [];

  public async enqueue(
    payload: EpisodePageSkeletonQueuePayload,
  ): Promise<EnqueueEpisodePageSkeletonResult> {
    this.payloads.push(payload);
    return { messageId: 'skeleton-message-1' };
  }
}

describe('Episode long job enqueue services', () => {
  it('story autofill enqueue recovers stale active job before creating a new job', async () => {
    const repository = new FakeEpisodeStoryAutofillRepository();
    repository.activeJob = buildJob({
      id: 'stale-story-job',
      jobType: 'episode_story_autofill',
      status: 'processing',
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:00:00.000Z' },
    });
    const queue = new FakeStoryQueue();
    const service = new EpisodeStoryAutofillService(
      repository,
      queue,
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const result = await service.enqueueEpisodeStoryAutofill(
      'user-1',
      'episode-1',
      'ja' satisfies AppLanguage,
    );

    expect(result.jobId).toBe(repository.createdJobs[0]?.id);
    expect(repository.failedJobs).toEqual([
      {
        jobId: 'stale-story-job',
        errorMessage:
          'Long-running story/page planning job stopped before completion; recovered stale queued or processing job',
      },
    ]);
    expect(repository.createdJobs).toHaveLength(1);
    expect(repository.createdJobs[0]?.jobType).toBe('episode_story_autofill');
    expect(queue.payloads).toHaveLength(1);
    expect(repository.attachedMessages).toEqual([
      { jobId: result.jobId, messageId: 'story-message-1' },
    ]);
  });

  it('story autofill enqueue keeps fresh active job protected', async () => {
    const repository = new FakeEpisodeStoryAutofillRepository();
    repository.activeJob = buildJob({
      id: 'fresh-story-job',
      jobType: 'episode_story_autofill',
      status: 'processing',
      params: { episode_id: 'episode-1' },
      result: { progress_updated_at: '2026-06-07T23:40:00.000Z' },
    });
    const service = new EpisodeStoryAutofillService(
      repository,
      new FakeStoryQueue(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    await expect(
      service.enqueueEpisodeStoryAutofill('user-1', 'episode-1', 'ja'),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Episode story autofill is already queued or processing',
    });
    expect(repository.failedJobs).toEqual([]);
    expect(repository.createdJobs).toEqual([]);
  });

  it('page skeleton enqueue recovers stale active job before creating a new job', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    repository.activeJob = buildJob({
      id: 'stale-skeleton-job',
      jobType: 'episode_page_skeleton',
      status: 'processing',
      params: { episode_id: 'episode-1' },
      startedAt: new Date('2026-06-07T23:00:00.000Z'),
    });
    const queue = new FakeSkeletonQueue();
    const service = new EpisodePageSkeletonService(
      repository,
      queue,
      45 * 60 * 1000,
      () => now.getTime(),
    );

    const result = await service.enqueueEpisodePageSkeleton('user-1', 'episode-1', {
      overwriteExisting: true,
      applyStoryPlan: true,
      language: 'ja',
    });

    expect(result.jobId).toBe(repository.createdJobs[0]?.id);
    expect(repository.failedJobs).toEqual([
      {
        jobId: 'stale-skeleton-job',
        errorMessage:
          'Long-running story/page planning job stopped before completion; recovered stale queued or processing job',
      },
    ]);
    expect(repository.createdJobs).toHaveLength(1);
    expect(repository.createdJobs[0]?.jobType).toBe('episode_page_skeleton');
    expect(queue.payloads).toEqual([{ jobId: result.jobId }]);
    expect(repository.attachedMessages).toEqual([
      { jobId: result.jobId, messageId: 'skeleton-message-1' },
    ]);
  });

  it('page skeleton enqueue keeps fresh active job protected', async () => {
    const repository = new FakeEpisodePageSkeletonRepository();
    repository.activeJob = buildJob({
      id: 'fresh-skeleton-job',
      jobType: 'episode_page_skeleton',
      status: 'queued',
      params: { episode_id: 'episode-1' },
      createdAt: new Date('2026-06-07T23:40:00.000Z'),
    });
    const service = new EpisodePageSkeletonService(
      repository,
      new FakeSkeletonQueue(),
      45 * 60 * 1000,
      () => now.getTime(),
    );

    await expect(
      service.enqueueEpisodePageSkeleton('user-1', 'episode-1', {
        overwriteExisting: true,
        applyStoryPlan: true,
        language: 'ja',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Episode page skeleton generation is already queued or processing',
    });
    expect(repository.failedJobs).toEqual([]);
    expect(repository.createdJobs).toEqual([]);
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    jobType: 'episode_story_autofill',
    status: 'queued',
    generationMode: null,
    creditCost: 0,
    params: {},
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
