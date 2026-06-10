import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InlineEntityGenerationQueueAdapter,
  UnconfiguredEntityGenerationQueue,
} from '../../../../src/services/entity/EntityGenerationQueue.js';
import {
  DetachedProcessPageGenerationQueueAdapter,
  InlinePageGenerationQueueAdapter,
  UnconfiguredPageGenerationQueue,
} from '../../../../src/services/page/PageGenerationQueue.js';

class FakeProcessor {
  public jobIds: string[] = [];
  public errorToThrow: unknown = null;

  public async processJob(jobId: string): Promise<void> {
    if (this.errorToThrow !== null) {
      throw this.errorToThrow;
    }
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('page_generate inline worker の失敗ログは機密値を伏せる', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const processor = new FakeProcessor();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    processor.errorToThrow = new Error(`renderer failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const queue = new InlinePageGenerationQueueAdapter(processor);

    await queue.enqueue({
      jobId: 'job-page-secret',
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

    const payload = errorSpy.mock.calls[0]?.[1] as { error?: string } | undefined;
    const message = payload?.error;
    if (message === undefined) {
      throw new Error('inline worker error was not logged');
    }
    expect(message).toContain('Bearer [redacted]');
    expect(message).not.toContain(fakeApiKey);
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it('entity_generate inline worker の失敗ログは機密値を伏せる', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const processor = new FakeProcessor();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    processor.errorToThrow = new Error(`renderer failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const queue = new InlineEntityGenerationQueueAdapter(processor);

    await queue.enqueue({
      jobId: 'job-entity-secret',
      userId: 'user-1',
      entityId: 'entity-1',
    });

    await flushTimers();

    const payload = errorSpy.mock.calls[0]?.[1] as { error?: string } | undefined;
    const message = payload?.error;
    if (message === undefined) {
      throw new Error('inline worker error was not logged');
    }
    expect(message).toContain('Bearer [redacted]');
    expect(message).not.toContain(fakeApiKey);
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it('local page_generate を detached worker process へ起動する', async () => {
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

  it('page queue 未設定時は成功扱いにせず設定エラーにする', async () => {
    const queue = new UnconfiguredPageGenerationQueue();

    await expect(
      queue.enqueue({
        jobId: 'job-4',
        userId: 'user-1',
        pageId: 'page-1',
        requestKind: 'initial',
        generationMode: 'standard',
        quality: 'medium',
        creditCost: 1,
        requiresPlanner: false,
        previousPageStatus: 'designing',
        previousGenerationMode: null,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Page generation queue is not configured'),
    });
  });

  it('entity queue 未設定時は成功扱いにせず設定エラーにする', async () => {
    const queue = new UnconfiguredEntityGenerationQueue();

    await expect(
      queue.enqueue({
        jobId: 'job-5',
        userId: 'user-1',
        entityId: 'entity-1',
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Entity generation queue is not configured'),
    });
  });
});

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
