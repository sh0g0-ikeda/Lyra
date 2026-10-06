import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { CancelledSettlementRecoveryResult } from '../../../src/services/job/CancelledGenerationSettlementRecoveryService.js';
import {
  CancelledGenerationSettlementRecoveryRuntime,
  createCancelledGenerationSettlementRecoveryRuntime,
  startCancelledGenerationSettlementRecoveryMaintenance,
} from '../../../src/lib/cancelledGenerationSettlementRecoveryRuntime.js';

const { verifiedFactory } = vi.hoisted(() => ({ verifiedFactory: vi.fn() }));
vi.mock('../../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js', () => ({
  createCancelledGenerationSettlementRecoveryRepository: verifiedFactory,
}));
const result: CancelledSettlementRecoveryResult = {
  scanned: 1, settled: 1, skipped: 0, deferred: 0, failed: 0,
  wrapped: false, scanFailed: false, busy: false,
};
const query = vi.fn(async () => { throw new Error('Unexpected SQL'); });
const database: DatabaseClient & TransactionRunner = { query, transaction: async work => work({ query }) };
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); verifiedFactory.mockReset(); query.mockClear(); });

describe('取消済み精算recoveryの検証済みruntime', () => {
  it('canonicalはfactoryもSQLもtimerも起動しない', async () => {
    const runtime = await createCancelledGenerationSettlementRecoveryRuntime(database, 'canonical');
    expect(runtime).toBeNull();
    await (await startCancelledGenerationSettlementRecoveryMaintenance(runtime))();
    expect(verifiedFactory).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([undefined, 'legacy_2debe_v1', 'unknown'])('未検証profile %sはSQL前に拒否する', async profile => {
    await expect(createCancelledGenerationSettlementRecoveryRuntime(database, profile)).rejects.toThrow();
    expect(verifiedFactory).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('同DBのexact factoryを待ち起動後も同じserviceとcursorを保持する', async () => {
    const id='00000000-0000-0000-0000-000000000001';
    const repository={profile:'production44_pg18_v1' as const,scanBatch:vi.fn().mockResolvedValue([{jobId:id,needsSettlement:true}]),settleAndVerify:vi.fn().mockResolvedValue(true)};
    let finish!:(value:typeof repository)=>void;
    verifiedFactory.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const pending=createCancelledGenerationSettlementRecoveryRuntime(database,'production44_pg18_v1');
    await Promise.resolve(); expect(repository.scanBatch).not.toHaveBeenCalled();
    finish(repository); const runtime=await pending;
    await runtime!.run(); await runtime!.run();
    expect(verifiedFactory).toHaveBeenCalledExactlyOnceWith(database,'production44_pg18_v1');
    expect(repository.scanBatch.mock.calls.map(call=>call[0].afterId)).toEqual([null,id]);
    await runtime!.stop();
  });
  it('exact検証失敗時はruntimeを返さずtimerも作らない', async () => {
    verifiedFactory.mockRejectedValue(new Error('SCHEMA_UNSUPPORTED'));
    await expect(createCancelledGenerationSettlementRecoveryRuntime(database,'production44_pg18_v1')).rejects.toThrow('SCHEMA_UNSUPPORTED');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('起動時1回と周期で同instanceを実行し遅い周期を重複させない', async () => {
    let finish!:(value:CancelledSettlementRecoveryResult)=>void;
    const run=vi.fn().mockResolvedValueOnce(result).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const runtime=new CancelledGenerationSettlementRecoveryRuntime({run});
    const stop=await startCancelledGenerationSettlementRecoveryMaintenance(runtime,5000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000); expect(run).toHaveBeenCalledTimes(2);
    let closed=false; const closing=stop().then(()=>{closed=true;});
    await Promise.resolve(); expect(closed).toBe(false); expect(vi.getTimerCount()).toBe(0);
    finish(result); await closing; await vi.advanceTimersByTimeAsync(15000);
    await runtime.run(); expect(run).toHaveBeenCalledTimes(2);
  });
  it('workerから重複runされても同じPromiseを返しstopがDBcloseより先に完了する', async () => {
    let finish!:(value:CancelledSettlementRecoveryResult)=>void;
    const run=vi.fn(()=>new Promise<CancelledSettlementRecoveryResult>(resolve=>{finish=resolve;}));
    const runtime=new CancelledGenerationSettlementRecoveryRuntime({run});
    const active=runtime.run(); expect(runtime.run()).toBe(active);
    const events:string[]=[];
    const shutdown=async():Promise<void>=>{await runtime.stop();events.push('DBclose');};
    const stopped=shutdown();await Promise.resolve();expect(events).toEqual([]);
    finish(result);await stopped;expect(events).toEqual(['DBclose']);expect(run).toHaveBeenCalledTimes(1);
  });
  it('例外を生ログにせず次周期に再試行できる', async () => {
    const run=vi.fn().mockRejectedValueOnce(new Error('private ledger SQL')).mockResolvedValue(result);
    const runtime=new CancelledGenerationSettlementRecoveryRuntime({run});
    const stop=await startCancelledGenerationSettlementRecoveryMaintenance(runtime,5000);
    await vi.advanceTimersByTimeAsync(5000);await stop();
    expect(run).toHaveBeenCalledTimes(2);expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private');
    expect(vi.mocked(console.info).mock.calls[0]?.[0]).toContain('"settled":1');
  });
  it.each([0,4999,300001,NaN])('不正周期%sは実行前に拒否する',async interval=>{
    const run=vi.fn();const runtime=new CancelledGenerationSettlementRecoveryRuntime({run});
    await expect(startCancelledGenerationSettlementRecoveryMaintenance(runtime,interval)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});
