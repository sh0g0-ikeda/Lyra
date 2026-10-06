import { describe, expect, it } from 'vitest';
import type { CancelledGenerationSettlementRecoveryRepository, CancelledSettlementCandidate } from '../../../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { CancelledGenerationSettlementRecoveryService } from '../../../../src/services/job/CancelledGenerationSettlementRecoveryService.js';
import { PostgresGenerationJobRepository } from '../../../../src/repositories/GenerationJobRepository.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';

const ids = [1, 2, 3].map(n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
function candidate(index: number, needsSettlement = true): CancelledSettlementCandidate { return { jobId: ids[index]!, needsSettlement }; }
class Repository implements CancelledGenerationSettlementRecoveryRepository {
  readonly profile = 'production44_pg18_v1' as const;
  readonly calls: Array<{afterId: string | null; limit: number}> = [];
  constructor(readonly rows: CancelledSettlementCandidate[]) {}
  settleAndVerify: (jobId: string) => Promise<boolean> = async () => true;
  async scanBatch(input: {afterId: string | null; limit: number}): Promise<CancelledSettlementCandidate[]> {
    this.calls.push(input);
    return this.rows.filter(row => input.afterId === null || row.jobId > input.afterId).slice(0, input.limit);
  }
}

describe('取消済み未返還jobのbounded recovery', () => {
  it('throw/false/返還済みもcursorを進め後続を処理し次sweepで再試行する', async () => {
    const repository = new Repository([candidate(0), candidate(1), candidate(2, false)]);
    const calls: string[] = [];
    repository.settleAndVerify = async id => {
      calls.push(id); if (id === ids[0]) throw new Error('private SQL detail'); return false;
    };
    const service = new CancelledGenerationSettlementRecoveryService(repository, 2);
    expect(await service.run()).toMatchObject({ scanned: 2, failed: 1, deferred: 1, settled: 0 });
    expect(await service.run()).toMatchObject({ scanned: 1, skipped: 1, failed: 0 });
    expect(await service.run()).toMatchObject({ scanned: 2, wrapped: true, failed: 1, deferred: 1 });
    expect(repository.calls).toEqual([{afterId:null,limit:2},{afterId:ids[1],limit:2},{afterId:ids[2],limit:2},{afterId:null,limit:2}]);
    expect(calls).toEqual([ids[0],ids[1],ids[0],ids[1]]);
  });
  it('1runは最大N件だけ処理し空の初回scanでwrapを繰り返さない', async () => {
    const repository = new Repository([]);let settlements = 0;
    repository.settleAndVerify = async()=>{settlements++;return true;};
    const service = new CancelledGenerationSettlementRecoveryService(repository, 1);
    expect(await service.run()).toMatchObject({scanned:0,wrapped:false});
    expect(repository.calls).toHaveLength(1);expect(settlements).toBe(0);
  });
  it('同じrunnerの重複runはscanせず返り別周期で再開できる', async () => {
    const repository = new Repository([candidate(0)]);let release!:()=>void;
    const pending = new Promise<void>(resolve=>{release=resolve;});
    repository.settleAndVerify = async()=>{await pending;return true;};
    const service = new CancelledGenerationSettlementRecoveryService(repository);
    const running=service.run();await Promise.resolve();
    expect(await service.run()).toMatchObject({busy:true,scanned:0});
    release();expect(await running).toMatchObject({settled:1});expect(repository.calls).toHaveLength(1);
  });
  it('scan失敗はcursorを保持し秘密を返さず次周期に再試行する',async()=>{
    const repository = new Repository([candidate(0),candidate(1)]);const original=repository.scanBatch.bind(repository);let fail=false;
    repository.scanBatch=async input=>{if(fail)throw new Error('private connection');return original(input);};
    const service=new CancelledGenerationSettlementRecoveryService(repository,1);
    await service.run();fail=true;
    const result=await service.run();expect(result).toMatchObject({scanFailed:true,scanned:0});expect(JSON.stringify(result)).not.toContain('private');
    fail=false;expect(await service.run()).toMatchObject({settled:1});expect(repository.calls.at(-1)?.afterId).toBe(ids[0]);
  });
  it('memory cursorは再起動で先頭に戻り既存ledger冪等性へ委ねる',async()=>{
    const repository=new Repository([candidate(0),candidate(1)]);
    await new CancelledGenerationSettlementRecoveryService(repository,1).run();
    await new CancelledGenerationSettlementRecoveryService(repository,1).run();
    expect(repository.calls.map(call=>call.afterId)).toEqual([null,null]);
  });
  it.each([0,-1,101,1.5,NaN])('batch limit %sが範囲外ならscan前に拒否する',limit=>{
    const repository=new Repository([]);
    expect(()=>new CancelledGenerationSettlementRecoveryService(repository,limit)).toThrow();
    expect(repository.calls).toHaveLength(0);
  });
  it.each(['canonical','legacy_2debe_v1'] as const)('%s GJRを精算済み判定portとして渡してもSQL前に拒否する',profile=>{
    let queries=0;
    const db:DatabaseClient={query:async()=>{queries++;throw new Error('must not query');}};
    const wrong=new PostgresGenerationJobRepository(db,profile);
    expect(()=>new CancelledGenerationSettlementRecoveryService(wrong as unknown as CancelledGenerationSettlementRecoveryRepository)).toThrow();
    // The removed (repository, arbitraryFinalizer) composition is also rejected
    // at runtime if a stale JavaScript caller bypasses the TypeScript signature.
    expect(()=>new CancelledGenerationSettlementRecoveryService(new Repository([]),wrong as unknown as number)).toThrow();
    expect(queries).toBe(0);
  });
});
