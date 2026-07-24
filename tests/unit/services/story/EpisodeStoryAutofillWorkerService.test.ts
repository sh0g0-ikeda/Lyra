import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EpisodeStoryAutofillExecutionRepository } from '../../../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { EpisodeStoryAutofillWorkerService } from '../../../../src/services/story/EpisodeStoryAutofillWorkerService.js';
import type { PageServicePort } from '../../../../src/services/page/PageService.js';

class FakeRepository implements EpisodeStoryAutofillExecutionRepository {
  public completed = false;
  public failed = false;
  public async claimQueuedEpisodeStoryAutofillJob(): Promise<GenerationJob | null> {
    return {
      id: '55555555-5555-4555-8555-555555555555', userId: 'user-1', jobType: 'episode_story_autofill',
      status: 'processing', generationMode: null, creditCost: 0,
      params: { episode_id: '33333333-3333-4333-8333-333333333333', language: 'ja' }, result: null,
      sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 0,
      createdAt: new Date('2026-07-25T00:00:00.000Z'), startedAt: new Date(), completedAt: null, expiresAt: null,
    };
  }
  public async updateEpisodeStoryAutofillProgress(): Promise<boolean> { return true; }
  public async completeEpisodeStoryAutofill(): Promise<boolean> { this.completed = true; return true; }
  public async failEpisodeStoryAutofill(): Promise<boolean> { this.failed = true; return true; }
}

class FakePageService implements PageServicePort {
  public calls = 0;
  public async updatePageSettings(): Promise<never> { throw new Error('not used'); }
  public async autofillFromScenes(): Promise<never> { throw new Error('not used'); }
  public async autofillEpisodeFromStory(): Promise<never> { this.calls += 1; throw new Error('not used'); }
}

describe('EpisodeStoryAutofillWorkerService processing cancellation', () => {
  it('claim直後に取消が確定していれば story autofill 保存を開始せず canceled として完了する', async () => {
    const repository = new FakeRepository();
    const pageService = new FakePageService();
    const worker = new EpisodeStoryAutofillWorkerService(
      repository,
      pageService,
      { finalizeCancellationIfRequested: async () => true },
    );

    await expect(worker.processJob('55555555-5555-4555-8555-555555555555')).resolves.toEqual({
      status: 'processed',
      jobStatus: 'canceled',
    });
    expect(pageService.calls).toBe(0);
    expect(repository.completed).toBe(false);
    expect(repository.failed).toBe(false);
  });
});
