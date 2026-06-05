import { describe, expect, it } from 'vitest';
import { InlineEntityGenerationQueueAdapter } from '../../../../src/services/entity/EntityGenerationQueue.js';
import {
  DetachedProcessPageGenerationQueueAdapter,
  InlinePageGenerationQueueAdapter,
} from '../../../../src/services/page/PageGenerationQueue.js';

class FakeProcessor {
  public jobIds: string[] = [];

  public async processJob(jobId: string): Promise<void> {
    this.jobIds.push(jobId);
  }
}

class FakeWorkerLauncher {
  public jobIds: string[] = [];

  public launch(jobId: string): void {
    this.jobIds.push(jobId);
  }
}

describe('local generation queue adapters', () => {
  it('page_generate を in-process worker へ渡す', async () => {
    const processor = new FakeProcessor();
    const queue = new InlinePageGenerationQueueAdapter(processor);

    const result = await queue.enqueue({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      creditCost: 10,
      requiresPlanner: false,
      previousPageStatus: 'designing',
      previousGenerationMode: null,
    });

    await flushTimers();

    expect(result.messageId?.startsWith('inline-')).toBe(true);
    expect(processor.jobIds).toEqual(['job-1']);
  });

  it('entity_generate を in-process worker へ渡す', async () => {
    const processor = new FakeProcessor();
    const queue = new InlineEntityGenerationQueueAdapter(processor);

    const result = await queue.enqueue({
      jobId: 'job-2',
      userId: 'user-1',
      entityId: 'entity-1',
    });

    await flushTimers();

    expect(result.messageId?.startsWith('inline-')).toBe(true);
    expect(processor.jobIds).toEqual(['job-2']);
  });

  it('local page_generate を detached worker process へ委譲する', async () => {
    const launcher = new FakeWorkerLauncher();
    const queue = new DetachedProcessPageGenerationQueueAdapter(launcher);

    const result = await queue.enqueue({
      jobId: 'job-3',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      quality: 'medium',
      creditCost: 1,
      requiresPlanner: false,
      previousPageStatus: 'designing',
      previousGenerationMode: null,
    });

    expect(result.messageId?.startsWith('local-worker-')).toBe(true);
    expect(launcher.jobIds).toEqual(['job-3']);
  });
});

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
