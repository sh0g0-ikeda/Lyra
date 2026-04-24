import { describe, expect, it } from 'vitest';
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

  public async processJob(jobId: string): Promise<ProcessPageGenerationJobResult> {
    this.calls.push(jobId);
    if (this.shouldThrow) {
      throw new Error('worker unavailable');
    }

    return this.nextResult;
  }
}

describe('worker queue handler', () => {
  it('page_generate メッセージならworker serviceを呼ぶ', async () => {
    const workerService = new FakePageGenerationWorkerService();
    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      { pageGenerationWorkerService: workerService } satisfies WorkerDependencies,
    );

    expect(workerService.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
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

  it('unsupported job_type はskipする', async () => {
    const workerService = new FakePageGenerationWorkerService();
    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'entity_generate',
      }),
      { pageGenerationWorkerService: workerService } satisfies WorkerDependencies,
    );

    expect(workerService.calls).toEqual([]);
    expect(result).toMatchObject({
      processedCount: 0,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(result.results[0]?.reason).toContain('Unsupported job_type');
  });

  it('不正なbodyはfailedとして続行する', async () => {
    const workerService = new FakePageGenerationWorkerService();
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

    const result = await handleGenerationQueue(event, {
      pageGenerationWorkerService: workerService,
    } satisfies WorkerDependencies);

    expect(workerService.calls).toEqual(['11111111-1111-4111-8111-111111111111']);
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
  });

  it('worker service 例外はfailedとして記録する', async () => {
    const workerService = new FakePageGenerationWorkerService();
    workerService.shouldThrow = true;

    const result = await handleGenerationQueue(
      buildEvent({
        job_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'page_generate',
      }),
      { pageGenerationWorkerService: workerService } satisfies WorkerDependencies,
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
  });
});

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
