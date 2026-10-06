import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEpisodeExportMaintenance } from '../../../src/lib/episodeExportMaintenance.js';
import type { EpisodeExportDispatchBatchResult } from '../../../src/services/export/EpisodeExportDispatchService.js';
import type { EpisodeExportCleanupResult } from '../../../src/services/export/EpisodeExportCleanupService.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('出力処理の停止時に進行中の処理を待つ', () => {
  it('定期実行を越えてもdispatchとcleanupの両方が終わるまで停止しない', async () => {
    let resolveDispatch!: (result: EpisodeExportDispatchBatchResult) => void;
    let resolveCleanup!: (result: EpisodeExportCleanupResult) => void;
    const dispatcher = { dispatchPending: vi.fn(() => new Promise<EpisodeExportDispatchBatchResult>(done => { resolveDispatch = done; })) };
    const cleanup = { cleanupExpired: vi.fn(() => new Promise<EpisodeExportCleanupResult>(done => { resolveCleanup = done; })) };
    const stop = startEpisodeExportMaintenance({ dispatcher, cleanup });
    vi.advanceTimersByTime(60 * 60 * 1000);
    const pending = stop();
    let stopped = false;
    void pending.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(dispatcher.dispatchPending).toHaveBeenCalledWith(50);
    expect(cleanup.cleanupExpired).toHaveBeenCalledWith(100);
    expect(dispatcher.dispatchPending).toHaveBeenCalledTimes(1);
    expect(cleanup.cleanupExpired).toHaveBeenCalledTimes(1);
    resolveDispatch({ attemptedCount: 0, dispatchedCount: 0, failedCount: 0 });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveCleanup({ selectedCount: 0, deletedCount: 0, failedCount: 0 });
    await pending;
    await stop();
    expect(stopped).toBe(true);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(dispatcher.dispatchPending).toHaveBeenCalledTimes(1);
    expect(cleanup.cleanupExpired).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('処理失敗時も停止を完了しproviderの秘密をログに出さない', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatcher = { dispatchPending: vi.fn().mockRejectedValue(new Error('private-queue-token')) };
    const cleanup = { cleanupExpired: vi.fn().mockRejectedValue(new Error('private-storage-key')) };
    const stop = startEpisodeExportMaintenance({ dispatcher, cleanup });
    await stop();
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-queue-token');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-storage-key');
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(dispatcher.dispatchPending).toHaveBeenCalledTimes(1);
    expect(cleanup.cleanupExpired).toHaveBeenCalledTimes(1);
  });

  it('無効なruntimeは待機可能で定期処理を作らない', async () => {
    await startEpisodeExportMaintenance(null)();
    expect(vi.getTimerCount()).toBe(0);
  });
});
