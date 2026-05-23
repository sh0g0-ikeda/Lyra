import { describe, expect, it } from 'vitest';
import { InlineEntityGenerationQueueAdapter } from '../../../../src/services/entity/EntityGenerationQueue.js';
import { InlinePageGenerationQueueAdapter } from '../../../../src/services/page/PageGenerationQueue.js';

class FakeProcessor {
  public jobIds: string[] = [];

  public async processJob(jobId: string): Promise<void> {
    this.jobIds.push(jobId);
  }
}

describe('inline generation queue adapters', () => {
  it('page_generate を同一プロセスで非同期実行する', async () => {
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

  it('entity_generate を同一プロセスで非同期実行する', async () => {
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
});

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

