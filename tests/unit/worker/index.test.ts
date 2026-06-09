import { describe, expect, it } from 'vitest';
import type { ProcessEntityGenerationJobResult } from '../../../src/services/entity/EntityGenerationWorkerService.js';
import type { ProcessPageGenerationJobResult } from '../../../src/services/page/PageGenerationWorkerService.js';
import {
  handleGenerationQueue,
  type WorkerDependencies,
  type WorkerQueueEvent,
} from '../../../worker/index.js';

class FakePageGenerationWorkerService {
  public calls: string[] = [];
  public nextResult: ProcessPageGenerationJobResult = {
    status: 'processed',
    jobStatus: 'completed',
  };
  public shouldThrow = false;
  public errorMessage = 'worker unavailable';

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.calls.push(jobId);
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }

    return this.nextResult;
  }
}

class FakeEntityGenerationWorkerService {
  public calls: string[] = [];
  public nextResult: ProcessEntityGenerationJobResult = {
    status: 'processed',
    jobStatus: 'completed',
  };

  public async processJob(jobId: string): Promise<ProcessEntityGenerationJobResult> {
    this.calls.push(jobId);
    return this.nextResult;
  }
}

describe('worker queue handler', () => {
  it('page_generate の場合に page worker service を呼ぶ', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(pageWorkerService.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(entityWorkerService.calls).toEqual([]);
    expect(result).toMatchObject({
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(result.results[0]).toMatchObject({
      status: 'completed',
      jobId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('entity_generate の場合に entity worker service を呼ぶ', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'entity_generate',
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(pageWorkerService.calls).toEqual([]);
    expect(entityWorkerService.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(result).toMatchObject({
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it('unsupported job_type は恒久失敗として再試行しない', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'unknown_generate',
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(pageWorkerService.calls).toEqual([]);
    expect(entityWorkerService.calls).toEqual([]);
    expect(result).toMatchObject({
      processedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
    expect(result.batchItemFailures).toEqual([]);
    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toContain('Unsupported job_type');
  });

  it('不正な body は failed として後続を継続する', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();
    const event: WorkerQueueEvent = {
      Records: [
        { messageId: 'message-1', body: 'not-json' },
        {
          messageId: 'message-2',
          body: JSON.stringify({
            job_id: '11111111-1111-4111-8111-111111111111',
            job_type: 'page_generate',
          }),
        },
      ],
    };

    const result = await handleGenerationQueue(
      event,
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(pageWorkerService.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(result).toMatchObject({
      processedCount: 1,
      skippedCount: 0,
      failedCount: 1,
    });
    expect(result.results[0]).toMatchObject({
      messageId: 'message-1',
      status: 'failed',
      reason: 'Invalid queue message',
    });
    expect(result.batchItemFailures).toEqual([]);
  });

  it('worker service 失敗は failed として記録する', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();
    pageWorkerService.shouldThrow = true;

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(result).toMatchObject({
      processedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: 'worker unavailable',
    });
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
  });

  it('worker service 失敗理由は機密値を伏せる', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();
    pageWorkerService.shouldThrow = true;
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    pageWorkerService.errorMessage = `worker failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`;

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    const reason = result.results[0]?.reason;
    if (reason === undefined) {
      throw new Error('worker failure reason was not returned');
    }
    expect(result.results[0]?.status).toBe('failed');
    expect(reason).toContain('Bearer [redacted]');
    expect(reason.includes(fakeApiKey)).toBe(false);
    expect(reason.length).toBeLessThanOrEqual(300);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
  });

  it('invalid body と unsupported job_type は batch failure に含めない', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();
    const event: WorkerQueueEvent = {
      Records: [
        { messageId: 'message-1', body: 'not-json' },
        {
          messageId: 'message-2',
          body: JSON.stringify({
            job_id: '11111111-1111-4111-8111-111111111111',
            job_type: 'unsupported_generate',
          }),
        },
      ],
    };

    const result = await handleGenerationQueue(
      event,
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(result.failedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.batchItemFailures).toEqual([]);
  });

  it('過大な job_type は結果 reason に反映せず invalid queue message として扱う', async () => {
    const pageWorkerService = new FakePageGenerationWorkerService();
    const entityWorkerService = new FakeEntityGenerationWorkerService();

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'x'.repeat(10_000),
      }),
      buildDependencies(pageWorkerService, entityWorkerService),
    );

    expect(pageWorkerService.calls).toEqual([]);
    expect(entityWorkerService.calls).toEqual([]);
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: 'Invalid queue message',
    });
    expect(result.results[0]?.reason?.length).toBeLessThanOrEqual(64);
    expect(result.batchItemFailures).toEqual([]);
  });
});

function buildDependencies(
  pageGenerationWorkerService: FakePageGenerationWorkerService,
  entityGenerationWorkerService: FakeEntityGenerationWorkerService,
): WorkerDependencies {
  return {
    pageGenerationWorkerService,
    entityGenerationWorkerService,
  };
}

function buildEvent(body: Record<string, unknown>): WorkerQueueEvent {
  return {
    Records: [
      {
        messageId: 'message-1',
        body: JSON.stringify(body),
      },
    ],
  };
}
