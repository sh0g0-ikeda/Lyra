import { randomUUID } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';

export type WorkDeletionStatus = 'pending' | 'processing' | 'pending_external_action' | 'completed';
export interface WorkDeletionRecord {
  id: string; workId: string; ownerUserId: string; organizationId: string | null;
  status: WorkDeletionStatus; processingToken: string | null; blockerCode: string | null;
}
export interface WorkDeletionAsset { key: string; kind: 'object' | 'fenced_state'; deleted: boolean }
export interface WorkDeletionPrefix {prefix:string;cursor:{key:string;version:string}|null}
export interface WorkDeletionPrefixPage {keys:string[];next:{key:string;version:string}|null}
export interface WorkDeletionRepository {
  nextPrefix?(request:WorkDeletionRecord):Promise<WorkDeletionPrefix|null>;
  checkpointPrefix?(request:WorkDeletionRecord,prefix:WorkDeletionPrefix,page:WorkDeletionPrefixPage):Promise<void>;
  request(userId: string, workId: string, organizationId: string | null): Promise<WorkDeletionRecord>;
  find(userId: string, requestId: string, organizationId: string | null): Promise<WorkDeletionRecord>;
  list?(userId: string, organizationId: string | null): Promise<WorkDeletionRecord[]>;
  claimNext(token: string): Promise<WorkDeletionRecord | null>;
  listAssets(request: WorkDeletionRecord): Promise<WorkDeletionAsset[]>;
  assertClaim(request: WorkDeletionRecord): Promise<void>;
  markAssetDeleted(request: WorkDeletionRecord, key: string): Promise<void>;
  complete(request: WorkDeletionRecord): Promise<void>;
  release(request: WorkDeletionRecord, blockerCode: string | null): Promise<void>;
}
export interface WorkAssetErasurePort {
  erase(key:string):Promise<void>;
  scanPrefix?(prefix:WorkDeletionPrefix):Promise<WorkDeletionPrefixPage>;
}
export interface WorkStateReferenceErasurePort {
  fenceWorkReferences(request: WorkDeletionRecord): Promise<boolean>;
}
export interface WorkDeletionResult {
  deletion_id: string; work_id: string; status: WorkDeletionStatus; blocker_code: string | null;
}
export interface WorkDeletionServicePort {
  requestDeletion(userId: string, workId: string, organizationId?: string | null): Promise<WorkDeletionResult>;
  getDeletion(userId: string, requestId: string, organizationId?: string | null): Promise<WorkDeletionResult>;
  listDeletions(userId: string, organizationId?: string | null): Promise<{deletions:WorkDeletionResult[]}>;
}
const MAX_EXTERNAL_STEPS = 25;
const ATTEMPT_BUDGET_MS = 15_000;

/** Spec §5/6: freeze and inventory are durable before external deletion. No
 * graph cascade precedes exact storage checkpoints and final claim validation.
 * Missing/uncertain storage evidence remains retryable, never successful. */
export class WorkDeletionService implements WorkDeletionServicePort {
  public constructor(
    private readonly repository: WorkDeletionRepository,
    private readonly storage: WorkAssetErasurePort,
    private readonly stateReferences?: WorkStateReferenceErasurePort,
  ) {}
  public async requestDeletion(userId: string, workId: string, organizationId: string | null = null): Promise<WorkDeletionResult> {
    return response(await this.repository.request(userId, workId, organizationId));
  }
  public async getDeletion(userId: string, id: string, organizationId: string | null = null): Promise<WorkDeletionResult> {
    return response(await this.repository.find(userId, id, organizationId));
  }
  public async listDeletions(userId:string,organizationId:string|null=null):Promise<{deletions:WorkDeletionResult[]}>{
    if(this.repository.list===undefined) throw new ConfigurationError('Work deletion listing unavailable');
    return {deletions:(await this.repository.list(userId,organizationId)).map(response)};
  }
  public async recoverPendingRequests(limit: number): Promise<{ attemptedCount: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ConfigurationError('Invalid work deletion batch size');
    let attemptedCount = 0;
    for (let index = 0; index < limit; index++) {
      const request = await this.repository.claimNext(randomUUID());
      if (request === null) break;
      attemptedCount++;
      await this.resume(request);
    }
    return { attemptedCount };
  }
  private async resume(request: WorkDeletionRecord): Promise<void> {
    const started = Date.now();
    let steps = 0;
    let failureCode = 'ASSET_ERASURE_FAILED';
    try {
      await this.repository.assertClaim(request);
      if(this.repository.nextPrefix!==undefined){
        failureCode='ASSET_INVENTORY_FAILED';
        for(let prefix=await this.repository.nextPrefix(request);prefix!==null;prefix=await this.repository.nextPrefix(request)){
          if(this.storage.scanPrefix===undefined||this.repository.checkpointPrefix===undefined)throw new Error('Inventory unavailable');
          if(steps>=MAX_EXTERNAL_STEPS||Date.now()-started>=ATTEMPT_BUDGET_MS){await this.repository.release(request,null);return;}
          await this.repository.assertClaim(request);
          const page=await this.storage.scanPrefix(prefix);
          await this.repository.checkpointPrefix(request,prefix,page);steps++;
        }
      }
      const assets = await this.repository.listAssets(request);
      if (assets.some(asset => asset.kind === 'fenced_state' && !asset.deleted)) {
        failureCode = 'STATE_REFERENCE_FENCING_UNAVAILABLE';
        if (this.stateReferences === undefined) throw new Error(failureCode);
        if (!await this.stateReferences.fenceWorkReferences(request)) {
          await this.repository.release(request, null);
          return;
        }
        for (const asset of assets.filter(asset => asset.kind === 'fenced_state' && !asset.deleted)) {
          await this.repository.markAssetDeleted(request, asset.key);
          asset.deleted = true;
        }
      }
      failureCode = 'ASSET_ERASURE_FAILED';
      for (const asset of assets) {
        if (asset.deleted) continue;
        if (steps >= MAX_EXTERNAL_STEPS || Date.now() - started >= ATTEMPT_BUDGET_MS) {
          await this.repository.release(request, null);
          return;
        }
        await this.repository.assertClaim(request);
        await this.storage.erase(asset.key);
        steps++;
        await this.repository.markAssetDeleted(request, asset.key);
      }
      failureCode = 'FINAL_REVALIDATION_BLOCKED';
      await this.repository.complete(request);
    } catch {
      // A replacement lease owns subsequent work; even failure checkpoints are fenced.
      try { await this.repository.release(request, failureCode); } catch { /* stale claim remains owned by its successor */ }
    }
  }
}
function response(request: WorkDeletionRecord): WorkDeletionResult {
  return { deletion_id: request.id, work_id: request.workId, status: request.status, blocker_code: request.blockerCode };
}
