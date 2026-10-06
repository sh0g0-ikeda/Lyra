import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type {
  TerminalGenerationNotificationRecoveryRepository,
} from '../../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js';

const mocks = vi.hoisted(() => ({
  createRepository: vi.fn(),
}));

vi.mock('../../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js', () => ({
  createTerminalGenerationNotificationRecoveryRepository: mocks.createRepository,
}));

import {
  createTerminalGenerationNotificationRecoveryRuntime,
  startTerminalGenerationNotificationRecoveryMaintenance,
} from '../../../src/lib/terminalGenerationNotificationRecoveryRuntime.js';

const CUTOVER = '2026-10-07T00:00:00.000Z';
const JOB = '00000000-0000-0000-0000-000000000001';
const database = {} as DatabaseClient & TransactionRunner;

function repository(
  profile: TerminalGenerationNotificationRecoveryRepository['profile'] = 'production44_pg18_v1',
): TerminalGenerationNotificationRecoveryRepository & {
  scanBatch: ReturnType<typeof vi.fn<TerminalGenerationNotificationRecoveryRepository['scanBatch']>>;
  enqueueCurrentTerminal: ReturnType<typeof vi.fn<TerminalGenerationNotificationRecoveryRepository['enqueueCurrentTerminal']>>;
} {
  return {
    profile,
    scanBatch: vi.fn().mockResolvedValue([]),
    enqueueCurrentTerminal: vi.fn().mockResolvedValue('inserted'),
  };
}

describe('終端生成通知recovery runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.createRepository.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('無効時とcanonicalではfactory SQLもtimerも開始しない', async () => {
    await expect(createTerminalGenerationNotificationRecoveryRuntime(database, 'production44_pg18_v1', {
      enabled: false,
      intervalMs: 0,
    })).resolves.toBeNull();
    await expect(createTerminalGenerationNotificationRecoveryRuntime(database, 'canonical', {
      enabled: true,
      intervalMs: 0,
    })).resolves.toBeNull();
    await (await startTerminalGenerationNotificationRecoveryMaintenance(null))();
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { cutover: undefined, intervalMs: 5_000 },
    { cutover: '2026-10-07', intervalMs: 5_000 },
    { cutover: CUTOVER, intervalMs: 4_999 },
    { cutover: CUTOVER, intervalMs: 86_400_001 },
    { cutover: CUTOVER, intervalMs: Number.MAX_SAFE_INTEGER + 1 },
  ])('actual44の不正cutover・intervalをfactory前に拒否する %#', async options => {
    await expect(createTerminalGenerationNotificationRecoveryRuntime(database, 'production44_pg18_v1', {
      enabled: true,
      ...options,
    })).rejects.toThrow('Invalid terminal notification recovery runtime configuration');
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('未検証legacy profileはfactory前に拒否する', async () => {
    await expect(createTerminalGenerationNotificationRecoveryRuntime(database, 'legacy_2debe_v1', {
      enabled: true,
      cutover: CUTOVER,
      intervalMs: 5_000,
    })).rejects.toThrow('Unsupported terminal notification recovery profile');
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('exact profileと同じDBでfactoryを一度だけ検証し同一serviceのcursorを使う', async () => {
    const repo = repository();
    repo.scanBatch.mockResolvedValueOnce([{ jobId: JOB }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.createRepository.mockResolvedValue(repo);
    const runtime = await createTerminalGenerationNotificationRecoveryRuntime(database, 'production44_pg18_v1', {
      enabled: true,
      cutover: CUTOVER,
      intervalMs: 5_000,
    });
    expect(runtime).not.toBeNull();
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRepository).toHaveBeenCalledWith(database, 'production44_pg18_v1');
    await runtime!.run();
    await runtime!.run();
    expect(repo.scanBatch.mock.calls.map(call => call[0].afterId)).toEqual([null, JOB, null]);
  });

  it('expanded actual44もexact profileをfactoryへ渡して検証する', async () => {
    const repo = repository('production44_expanded_pg18_v1');
    mocks.createRepository.mockResolvedValue(repo);
    const runtime = await createTerminalGenerationNotificationRecoveryRuntime(
      database,
      'production44_expanded_pg18_v1',
      { enabled: true, cutover: CUTOVER, intervalMs: 5_000 },
    );
    expect(runtime).not.toBeNull();
    expect(mocks.createRepository).toHaveBeenCalledExactlyOnceWith(
      database,
      'production44_expanded_pg18_v1',
    );
    await runtime!.run();
    expect(repo.scanBatch).toHaveBeenCalledExactlyOnceWith({ cutover: CUTOVER, afterId: null, limit: 100 });
  });

  it('重複tickは進行中batchと重ならずstopは新規admissionを閉じて完了を待つ', async () => {
    const repo = repository();
    let finish!: (rows: Array<{ jobId: string }>) => void;
    repo.scanBatch
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mocks.createRepository.mockResolvedValue(repo);
    const runtime = await createTerminalGenerationNotificationRecoveryRuntime(database, 'production44_pg18_v1', {
      enabled: true,
      cutover: CUTOVER,
      intervalMs: 5_000,
    });
    const stop = await startTerminalGenerationNotificationRecoveryMaintenance(runtime);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(repo.scanBatch).toHaveBeenCalledTimes(2);
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await runtime!.run();
    expect(repo.scanBatch).toHaveBeenCalledTimes(2);
    finish([]);
    await stopping;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(repo.scanBatch).toHaveBeenCalledTimes(2);
  });

  it('ログは固定eventと集計値だけでraw errorを含めない', async () => {
    const repo = repository();
    repo.scanBatch.mockRejectedValue(new Error('private-db-url credential'));
    mocks.createRepository.mockResolvedValue(repo);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = await createTerminalGenerationNotificationRecoveryRuntime(database, 'production44_pg18_v1', {
      enabled: true,
      cutover: CUTOVER,
      intervalMs: 5_000,
    });
    await runtime!.run();
    const logs = JSON.stringify([info.mock.calls, error.mock.calls]);
    expect(logs).toContain('terminal_generation_notification_recovery');
    expect(logs).toContain('scanFailed');
    expect(logs).not.toContain('private-db-url');
    expect(logs).not.toContain('credential');
  });
});
