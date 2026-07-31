import { describe, expect, it } from 'vitest';
import {
  handleEpisodeExportQueue,
  type EpisodeExportWorkerDependencies,
} from '../../../worker/episodeExport.js';

const jobId = '44444444-4444-4444-8444-444444444444';

describe('handleEpisodeExportQueue', () => {
  it('version付き専用payloadをexport workerだけへ渡す', async () => {
    const worker = new FakeWorker();
    const result = await handleEpisodeExportQueue({
      Records: [{
        messageId: 'message-1',
        body: JSON.stringify({ version: 1, export_job_id: jobId }),
      }],
    }, dependencies(worker));

    expect(worker.calls).toEqual([jobId]);
    expect(result).toMatchObject({
      processedCount: 1,
      retryCount: 0,
      failedCount: 0,
      batchItemFailures: [],
    });
  });

  it('不正JSON・未知version・余分fieldを恒久失敗としてackする', async () => {
    const worker = new FakeWorker();
    const result = await handleEpisodeExportQueue({
      Records: [
        { messageId: 'bad-1', body: '{' },
        { messageId: 'bad-2', body: JSON.stringify({ version: 2, export_job_id: jobId }) },
        {
          messageId: 'bad-3',
          body: JSON.stringify({ version: 1, export_job_id: jobId, job_type: 'page_generate' }),
        },
      ],
    }, dependencies(worker));

    expect(worker.calls).toEqual([]);
    expect(result.failedCount).toBe(3);
    expect(result.batchItemFailures).toEqual([]);
  });

  it('retry結果と例外だけをpartial batch failureへ入れる', async () => {
    const retryWorker = new FakeWorker();
    retryWorker.result = { status: 'retry', reason: 'temporary' };
    const retryResult = await handleEpisodeExportQueue({
      Records: [{
        messageId: 'message-retry',
        body: JSON.stringify({ version: 1, export_job_id: jobId }),
      }],
    }, dependencies(retryWorker));
    expect(retryResult.batchItemFailures).toEqual([
      { itemIdentifier: 'message-retry' },
    ]);

    const throwingWorker = new FakeWorker();
    throwingWorker.error = new Error('secret provider detail');
    const thrownResult = await handleEpisodeExportQueue({
      Records: [{
        messageId: 'message-throw',
        body: JSON.stringify({ version: 1, export_job_id: jobId }),
      }],
    }, dependencies(throwingWorker));
    expect(thrownResult.batchItemFailures).toEqual([
      { itemIdentifier: 'message-throw' },
    ]);
    expect(thrownResult.results[0]?.reason).not.toContain('secret');
  });

  it('完了済みなどのskippedはackする', async () => {
    const worker = new FakeWorker();
    worker.result = { status: 'skipped', reason: 'already completed' };
    const result = await handleEpisodeExportQueue({
      Records: [{
        messageId: 'message-1',
        body: JSON.stringify({ version: 1, export_job_id: jobId }),
      }],
    }, dependencies(worker));

    expect(result.skippedCount).toBe(1);
    expect(result.batchItemFailures).toEqual([]);
  });
});

class FakeWorker {
  public calls: string[] = [];
  public result: {
    status: 'processed' | 'skipped' | 'retry';
    jobStatus?: 'completed' | 'failed';
    reason?: string;
  } = { status: 'processed', jobStatus: 'completed' };
  public error: Error | null = null;

  public async processJob(id: string) {
    this.calls.push(id);
    if (this.error !== null) {
      throw this.error;
    }
    return this.result;
  }
}

function dependencies(worker: FakeWorker): EpisodeExportWorkerDependencies {
  return {
    episodeExportWorkerService: worker,
  };
}
