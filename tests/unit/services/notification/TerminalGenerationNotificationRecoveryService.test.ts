import { describe, expect, it, vi } from 'vitest';
import type {
  TerminalGenerationNotificationRecoveryRepository,
} from '../../../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js';
import {
  TerminalGenerationNotificationRecoveryService,
} from '../../../../src/services/notification/TerminalGenerationNotificationRecoveryService.js';

const cutover = '2026-10-07T00:00:00.000Z';
const id = (value: number): string => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

function repository(): TerminalGenerationNotificationRecoveryRepository & {
  scanBatch: ReturnType<typeof vi.fn<TerminalGenerationNotificationRecoveryRepository['scanBatch']>>;
  enqueueCurrentTerminal: ReturnType<typeof vi.fn<TerminalGenerationNotificationRecoveryRepository['enqueueCurrentTerminal']>>;
} {
  return {
    profile: 'production44_pg18_v1',
    scanBatch: vi.fn(),
    enqueueCurrentTerminal: vi.fn(),
  };
}

describe('終端生成通知recovery service', () => {
  it('同一instanceのcursorを進めempty時だけ先頭へ一回wrapし結果を分類する', async () => {
    const repo = repository();
    repo.scanBatch
      .mockResolvedValueOnce([{ jobId: id(1) }, { jobId: id(2) }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ jobId: id(1) }]);
    repo.enqueueCurrentTerminal
      .mockResolvedValueOnce('inserted')
      .mockResolvedValueOnce('existing')
      .mockResolvedValueOnce('deferred');
    const service = new TerminalGenerationNotificationRecoveryService(repo, cutover, 2);
    await expect(service.run()).resolves.toMatchObject({ scanned: 2, inserted: 1, existing: 1, failed: 0, wrapped: false });
    await expect(service.run()).resolves.toMatchObject({ scanned: 1, deferred: 1, wrapped: true });
    expect(repo.scanBatch.mock.calls.map(call => call[0])).toEqual([
      { cutover, afterId: null, limit: 2 },
      { cutover, afterId: id(2), limit: 2 },
      { cutover, afterId: null, limit: 2 },
    ]);
  });

  it('poison行のerrorを隔離してcursorを進め後続を処理する', async () => {
    const repo = repository();
    repo.scanBatch.mockResolvedValue([{ jobId: id(1) }, { jobId: id(2) }]);
    repo.enqueueCurrentTerminal.mockRejectedValueOnce(new Error('private SQL')).mockResolvedValueOnce('inserted');
    const service = new TerminalGenerationNotificationRecoveryService(repo, cutover, 2);
    await expect(service.run()).resolves.toEqual({
      scanned: 2, inserted: 1, existing: 0, deferred: 0, failed: 1,
      wrapped: false, scanFailed: false, stopped: false,
    });
    expect(JSON.stringify(await service.run())).not.toContain('private SQL');
    expect(repo.scanBatch.mock.calls[1]?.[0].afterId).toBe(id(2));
  });

  it('scan失敗は内部情報を出さず次周期へ再試行する', async () => {
    const repo = repository();
    repo.scanBatch.mockRejectedValueOnce(new Error('private catalog')).mockResolvedValueOnce([]);
    const service = new TerminalGenerationNotificationRecoveryService(repo, cutover, 10);
    await expect(service.run()).resolves.toMatchObject({ scanFailed: true, scanned: 0 });
    await expect(service.run()).resolves.toMatchObject({ scanFailed: false, scanned: 0 });
  });

  it('重複runは同じPromiseを返しstopがactive処理を待って以後のadmissionを閉じる', async () => {
    const repo = repository();
    let finish!: (value: Array<{ jobId: string }>) => void;
    repo.scanBatch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const service = new TerminalGenerationNotificationRecoveryService(repo, cutover, 10);
    const first = service.run();
    expect(service.run()).toBe(first);
    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish([]);
    await stopping;
    await expect(service.run()).resolves.toMatchObject({ stopped: true, scanned: 0 });
    expect(repo.scanBatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { profile: 'canonical', cutover, limit: 1 },
    { profile: 'production44_pg18_v1', cutover: '2026-10-07', limit: 1 },
    { profile: 'production44_pg18_v1', cutover, limit: 0 },
    { profile: 'production44_pg18_v1', cutover, limit: 101 },
  ])('不正profile・cutover・limitを構築時に拒否する %#', input => {
    const repo = repository();
    Object.defineProperty(repo, 'profile', { value: input.profile });
    expect(() => new TerminalGenerationNotificationRecoveryService(repo, input.cutover, input.limit)).toThrow();
  });
});
