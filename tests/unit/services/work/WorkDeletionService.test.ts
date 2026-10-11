import { describe, expect, it } from 'vitest';
import { WorkDeletionService, type WorkDeletionRepository, type WorkDeletionRecord, type WorkDeletionAsset } from '../../../../src/services/work/WorkDeletionService.js';

const request: WorkDeletionRecord = { id: 'request', workId: 'work', ownerUserId: 'owner', organizationId: null, status: 'processing', processingToken: 'lease', blockerCode: null };
class MemoryRepository implements WorkDeletionRepository {
  public events: string[] = [];
  public assets: WorkDeletionAsset[] = [{ key: 'saved/owner/pages/page/image.png', kind: 'object', deleted: false }];
  public claimed = false;
  public stale = false;
  public async request(): Promise<WorkDeletionRecord> { return request; }
  public async find(): Promise<WorkDeletionRecord> { return request; }
  public async claimNext(): Promise<WorkDeletionRecord | null> { if (this.claimed) return null; this.claimed = true; return request; }
  public async listAssets(): Promise<WorkDeletionAsset[]> { this.events.push('inventory'); return this.assets; }
  public async assertClaim(): Promise<void> { this.events.push('claim'); if (this.stale) throw new Error('stale'); }
  public async markAssetDeleted(_request: WorkDeletionRecord, key: string): Promise<void> { this.events.push('checkpoint'); this.assets.find(a => a.key === key)!.deleted = true; }
  public async complete(): Promise<void> { this.events.push('cascade'); }
  public async release(_request: WorkDeletionRecord, code: string | null): Promise<void> { this.events.push(code ?? 'continue'); }
}
describe('作品永久削除のdurable順序', () => {
  it('画像消去とcheckpointが完了してから作品cascadeを実行する', async () => {
    const repository = new MemoryRepository();
    const service = new WorkDeletionService(repository, { erase: async () => { repository.events.push('erase'); } });
    await service.recoverPendingRequests(1);
    expect(repository.events.indexOf('erase')).toBeLessThan(repository.events.indexOf('checkpoint'));
    expect(repository.events.indexOf('checkpoint')).toBeLessThan(repository.events.indexOf('cascade'));
  });
  it('画像削除が失敗した場合に作品を残して再試行情報を保存する', async () => {
    const repository = new MemoryRepository();
    const service = new WorkDeletionService(repository, { erase: async () => { throw new Error('secret provider error'); } });
    await service.recoverPendingRequests(1);
    expect(repository.events).not.toContain('cascade');
    expect(repository.events).toContain('ASSET_ERASURE_FAILED');
    expect(repository.assets[0]!.deleted).toBe(false);
  });
  it('前回checkpoint済み画像は再消去せず未完了だけ処理する', async () => {
    const repository = new MemoryRepository(); repository.assets[0]!.deleted = true;
    let calls = 0;
    await new WorkDeletionService(repository, { erase: async () => { calls++; } }).recoverPendingRequests(1);
    expect(calls).toBe(0); expect(repository.events).toContain('cascade');
  });
  it('stale claimの場合に画像も作品も消さない', async () => {
    const repository = new MemoryRepository(); repository.stale = true;
    let calls = 0;
    await new WorkDeletionService(repository, { erase: async () => { calls++; } }).recoverPendingRequests(1);
    expect(calls).toBe(0); expect(repository.events).not.toContain('cascade');
  });
  it('v2参照のfencing adapterがない場合に未完了で保持する', async () => {
    const repository = new MemoryRepository(); repository.assets = [{key:'state-reference-v2/token/image.png',kind:'fenced_state',deleted:false}];
    let calls=0;
    await new WorkDeletionService(repository,{erase:async()=>{calls++;}}).recoverPendingRequests(1);
    expect(calls).toBe(0); expect(repository.events).not.toContain('cascade');
    expect(repository.events).toContain('STATE_REFERENCE_FENCING_UNAVAILABLE');
  });
});
