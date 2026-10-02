import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEpisodeExportQueueConfig } from '../../../src/lib/episodeExportRuntime.js';
import { startEpisodeExportMaintenance } from '../../../src/lib/episodeExportMaintenance.js';
const generation = 'https://sqs.ap-northeast-1.amazonaws.com/123/generation';
const dedicated = 'https://sqs.ap-northeast-1.amazonaws.com/123/exports';
const stops: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('episode export runtime and maintenance', () => {
  it('stays off by default and selects the existing queue only when dedicated is absent or identical', () => {
    expect(resolveEpisodeExportQueueConfig({ EPISODE_EXPORT_ENABLED: false })).toBeNull();
    expect(resolveEpisodeExportQueueConfig({ EPISODE_EXPORT_ENABLED: true, SQS_QUEUE_URL_GENERATION: generation })).toEqual({ queueUrl: generation, shared: true });
    expect(resolveEpisodeExportQueueConfig({ EPISODE_EXPORT_ENABLED: true, SQS_QUEUE_URL_GENERATION: generation, SQS_QUEUE_URL_EXPORT: dedicated })).toEqual({ queueUrl: dedicated, shared: false });
    expect(resolveEpisodeExportQueueConfig({ EPISODE_EXPORT_ENABLED: true, SQS_QUEUE_URL_GENERATION: generation, SQS_QUEUE_URL_EXPORT: generation })).toEqual({ queueUrl: generation, shared: true });
    expect(() => resolveEpisodeExportQueueConfig({ EPISODE_EXPORT_ENABLED: true })).toThrow();
  });
  it('bounds each batch, prevents overlapping maintenance and stops timers cleanly', async () => {
     const dispatchPending = vi.fn().mockReturnValue(new Promise(() => undefined)); const cleanupExpired = vi.fn().mockReturnValue(new Promise(() => undefined));
    const stop = startEpisodeExportMaintenance({ dispatcher: { dispatchPending }, cleanup: { cleanupExpired } }); stops.push(stop);
    expect(dispatchPending).toHaveBeenCalledWith(50); expect(cleanupExpired).toHaveBeenCalledWith(100);
    await advance(7_200_000); expect(dispatchPending).toHaveBeenCalledOnce(); expect(cleanupExpired).toHaveBeenCalledOnce();
    stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains failed receipts and tries the next bounded batch without logging provider secrets', async () => {
     const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatchPending = vi.fn().mockRejectedValueOnce(new Error('s3://private-key secret')).mockResolvedValue({ attemptedCount: 0, dispatchedCount: 0, failedCount: 0 });
    const cleanupExpired = vi.fn().mockResolvedValue({ selectedCount: 0, deletedCount: 0, failedCount: 0 });
    const stop = startEpisodeExportMaintenance({ dispatcher: { dispatchPending }, cleanup: { cleanupExpired } }); stops.push(stop);
    await advance(30_000); expect(dispatchPending).toHaveBeenCalledTimes(2); expect(JSON.stringify(log.mock.calls)).not.toContain('private-key'); stop();
  });
});

async function advance(milliseconds: number): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  vi.advanceTimersByTime(milliseconds);
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
