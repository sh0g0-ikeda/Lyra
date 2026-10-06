import { describe, expect, it, vi } from 'vitest';
import { resolveWorkerDependencies } from '../../../worker/dependencies.js';
import { handleGenerationQueue, type WorkerDependencies } from '../../../worker/index.js';
import { handleEpisodeExportQueue } from '../../../worker/episodeExport.js';
const id = '11111111-1111-4111-8111-111111111111';
const messages = [{ job_id: id, job_type: 'episode_export' }, { version: 1, export_job_id: id }];
const unused = { processJob: vi.fn().mockResolvedValue({ status: 'processed', jobStatus: 'completed' }) };
const base: WorkerDependencies = { pageGenerationWorkerService: unused, entityGenerationWorkerService: unused, episodeStoryAutofillWorkerService: unused, episodePageSkeletonWorkerService: unused };
describe('shared export queue compatibility', () => {
  it('preserves export and quoted-import services through worker override resolution', () => {
    const exportService = { processJob: vi.fn().mockResolvedValue({ status: 'processed', jobStatus: 'completed' }) };
    const quotedImportWorkerService = { processJob: vi.fn().mockResolvedValue({ status: 'processed', jobStatus: 'completed' }) };
    const resolved = resolveWorkerDependencies({ pageGenerationWorkerService: unused, episodeExportWorkerService: exportService, quotedImportWorkerService });
    expect(resolved.episodeExportWorkerService).toBe(exportService); expect(resolved.quotedImportWorkerService).toBe(quotedImportWorkerService);
  });
  it.each(messages)('runs supported export envelopes %j through the candidate worker', async (message) => {
    const processJob = vi.fn().mockResolvedValue({ status: 'processed', jobStatus: 'completed' });
    const result = await handleGenerationQueue({ Records: [{ messageId: 'm', body: JSON.stringify(message) }] }, { ...base, episodeExportWorkerService: { processJob } });
    expect(processJob).toHaveBeenCalledWith(id); expect(result.processedCount).toBe(1); expect(result.batchItemFailures).toEqual([]);
  });
  it.each(messages)('retries a valid export message with unavailable runtime %j', async (message) => {
    const result = await handleGenerationQueue({ Records: [{ messageId: 'm', body: JSON.stringify(message) }] }, base);
    expect(result.retryCount).toBe(1); expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm' }]);
  });
  it('reports terminal failed exports as failed in both worker entry points, and redacts thrown details', async () => {
    const processJob = vi.fn().mockResolvedValue({ status: 'processed', jobStatus: 'failed' });
    const event = { Records: [{ messageId: 'm', body: JSON.stringify(messages[1]) }] };
    const combined = await handleGenerationQueue(event, { ...base, episodeExportWorkerService: { processJob } });
    const dedicated = await handleEpisodeExportQueue(event, { episodeExportWorkerService: { processJob } });
    expect(combined.failedCount).toBe(1); expect(dedicated.failedCount).toBe(1); expect(combined.batchItemFailures).toEqual([]); expect(dedicated.batchItemFailures).toEqual([]);
    processJob.mockRejectedValue(new Error('s3://private-bucket/private-key access_token=secret'));
    const failed = await handleGenerationQueue(event, { ...base, episodeExportWorkerService: { processJob } });
    expect(failed.batchItemFailures).toEqual([{ itemIdentifier: 'm' }]); expect(JSON.stringify(failed)).not.toContain('private-key'); expect(JSON.stringify(failed)).not.toContain('secret');
  });
  it('rejects mixed export/generation envelopes without invoking a worker', async () => {
    const processJob = vi.fn();
    const result = await handleGenerationQueue({ Records: [{ messageId: 'm', body: JSON.stringify({ ...messages[1], job_id: id, job_type: 'page_generate' }) }] }, { ...base, episodeExportWorkerService: { processJob } });
    expect(result.failedCount).toBe(1); expect(result.batchItemFailures).toEqual([]); expect(processJob).not.toHaveBeenCalled();
  });
});
