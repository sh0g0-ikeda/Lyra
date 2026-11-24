import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import type {
  GenerationBatchApprovedItem,
  GenerationBatchBlocker,
  GenerationBatchItemRecord,
  GenerationBatchRecord,
  GenerationBatchStatus,
} from '../domain/types/generationBatch.js';
import type { GenerationQuoteRequest } from '../domain/types/generationQuote.js';
import type { DatabaseClient } from '../lib/db.js';

export interface GenerationBatchTarget {
  kind: 'entity_base' | 'entity_state' | 'page';
  targetId: string;
  entityId: string | null;
  label: string;
  revision: string;
  ready: boolean;
  definition: Record<string, unknown>;
}

export interface GenerationBatchJobSnapshot {
  id: string;
  status: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  cancelRequestedAt?: Date | null;
  commitStartedAt?: Date | null;
}

export interface GenerationBatchRepositoryPort {
  discoverTargets(client: DatabaseClient, input: {
    userId: string; organizationId: string | null; workId: string;
    episodeId: string | null; kind: 'character_references' | 'pages';
  }): Promise<GenerationBatchTarget[]>;
  create(client: DatabaseClient, batch: GenerationBatchRecord, items: GenerationBatchApprovedItem[]): Promise<void>;
  find(client: DatabaseClient, userId: string, organizationId: string | null, batchId: string, lock?: boolean): Promise<{batch: GenerationBatchRecord; items: GenerationBatchItemRecord[]}>;
  list(client: DatabaseClient, userId: string, organizationId: string | null, workId: string, episodeId: string | null): Promise<Array<{batch: GenerationBatchRecord; items: GenerationBatchItemRecord[]}>>;
  accept(client: DatabaseClient, batchId: string, requestKey: string): Promise<void>;
  resume(client: DatabaseClient, batchId: string): Promise<void>;
  requestCancel(client: DatabaseClient, batchId: string): Promise<void>;
  updateBatch(client: DatabaseClient, batchId: string, status: GenerationBatchStatus, blockers?: GenerationBatchBlocker[]): Promise<void>;
  updateItem(client: DatabaseClient, itemId: string, input: {
    status: GenerationBatchItemRecord['status']; childQuoteId?: string | null; jobId?: string | null;
    confirmation?: Record<string, unknown> | null; blocker?: GenerationBatchBlocker | null;
  }): Promise<void>;
  findJob(client: DatabaseClient, jobId: string): Promise<GenerationBatchJobSnapshot | null>;
  findRunnableBatchIds(client: DatabaseClient, limit: number): Promise<string[]>;
  findCancelledBatchIdsWithActiveChildren(client: DatabaseClient, limit: number): Promise<string[]>;
  touchBatch(client: DatabaseClient, batchId: string): Promise<void>;
}

interface BatchRow extends QueryResultRow {
  id: string; user_id: string; organization_id: string | null; work_id: string; episode_id: string | null;
  kind: GenerationBatchRecord['kind']; status: GenerationBatchStatus; selection: 'missing_only';
  render_style: GenerationBatchRecord['renderStyle']; image_model: string; pricing_version: string;
  maximum_credits: number; auto_confirm: boolean; blockers: GenerationBatchBlocker[]; expires_at: Date;
  request_key: string | null; accepted_at: Date | null; created_at: Date; updated_at: Date;
}
interface ItemRow extends QueryResultRow {
  id: string; batch_id: string; position: number; kind: GenerationBatchItemRecord['kind']; label: string;
  target_id: string; entity_id: string | null; depends_on_item_id: string | null;
  status: GenerationBatchItemRecord['status']; approved_request: Record<string, unknown>; approved_input: Record<string, unknown>;
  input_revision: string; operation: GenerationBatchItemRecord['operation']; image_model: string; provider_model_id: string;
  render_style: GenerationBatchItemRecord['renderStyle']; amount_credits: number; pricing_version: string;
  child_quote_id: string | null; job_id: string | null; confirmation: Record<string, unknown> | null;
  blocker: GenerationBatchBlocker | null;
}

export class PostgresGenerationBatchRepository implements GenerationBatchRepositoryPort {
  public async discoverTargets(client: DatabaseClient, input: {
    userId: string; organizationId: string | null; workId: string; episodeId: string | null;
    kind: 'character_references' | 'pages';
  }): Promise<GenerationBatchTarget[]> {
    await requireWorkScope(client, input);
    if (input.kind === 'pages') return this.discoverPages(client, input);
    return this.discoverCharacters(client, input);
  }

  public async create(client: DatabaseClient, batch: GenerationBatchRecord, items: GenerationBatchApprovedItem[]): Promise<void> {
    await client.query(
      `INSERT INTO generation_batches (id,user_id,organization_id,work_id,episode_id,kind,status,selection,render_style,image_model,pricing_version,maximum_credits,auto_confirm,approved_plan,blockers,expires_at,request_key,accepted_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'quoted','missing_only',$7,$8,$9,$10,FALSE,$11::jsonb,$12::jsonb,$13,NULL,NULL,$14,$14)`,
      [batch.id,batch.userId,batch.organizationId,batch.workId,batch.episodeId,batch.kind,batch.renderStyle,batch.imageModel,
        batch.pricingVersion,batch.maximumCredits,JSON.stringify({item_ids:items.map(item=>item.id),item_count:items.length}),JSON.stringify(batch.blockers),batch.expiresAt,batch.createdAt],
    );
    for (const item of items) {
      await client.query(
        `INSERT INTO generation_batch_items (id,batch_id,position,kind,label,target_id,entity_id,depends_on_item_id,status,approved_request,approved_input,input_revision,operation,image_model,provider_model_id,render_style,amount_credits,pricing_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)`,
        [item.id,batch.id,item.position,item.kind,item.label,item.targetId,item.entityId,item.dependsOnItemId,
          JSON.stringify(item.approvedRequest),JSON.stringify(item.approvedInput),item.inputRevision,item.operation,item.imageModel,
          item.providerModelId,item.renderStyle,item.amountCredits,item.pricingVersion],
      );
    }
  }

  public async find(client: DatabaseClient, userId: string, organizationId: string | null, batchId: string, lock = false): Promise<{batch: GenerationBatchRecord; items: GenerationBatchItemRecord[]}> {
    const found = await client.query<BatchRow>(
      `SELECT * FROM generation_batches WHERE id=$1::uuid AND user_id=$2::uuid AND organization_id IS NOT DISTINCT FROM $3::uuid ${lock ? 'FOR UPDATE' : ''}`,
      [batchId,userId,organizationId],
    );
    if (!found.rows[0]) throw new NotFoundError('Generation batch not found');
    const items = await client.query<ItemRow>('SELECT * FROM generation_batch_items WHERE batch_id=$1::uuid ORDER BY position',[batchId]);
    return {batch: mapBatch(found.rows[0]), items: items.rows.map(mapItem)};
  }

  public async list(client: DatabaseClient, userId: string, organizationId: string | null, workId: string, episodeId: string | null): Promise<Array<{batch: GenerationBatchRecord; items: GenerationBatchItemRecord[]}>> {
    const rows = await client.query<BatchRow>(
      `SELECT * FROM generation_batches WHERE user_id=$1::uuid AND organization_id IS NOT DISTINCT FROM $2::uuid
       AND work_id=$3::uuid AND ($4::uuid IS NULL OR episode_id=$4::uuid) ORDER BY created_at DESC LIMIT 50`,
      [userId,organizationId,workId,episodeId],
    );
    return Promise.all(rows.rows.map(async (row) => {
      const items=await client.query<ItemRow>('SELECT * FROM generation_batch_items WHERE batch_id=$1::uuid ORDER BY position',[row.id]);
      return {batch:mapBatch(row),items:items.rows.map(mapItem)};
    }));
  }

  public async accept(client: DatabaseClient, batchId: string, requestKey: string): Promise<void> {
    const result=await client.query(
      `UPDATE generation_batches SET status='running',auto_confirm=TRUE,request_key=$2::uuid,accepted_at=NOW(),updated_at=NOW()
       WHERE id=$1::uuid AND status='quoted' AND expires_at>NOW() RETURNING id`,[batchId,requestKey],
    );
    if(result.rows.length!==1) throw new ConflictError('Generation batch quote expired or was already accepted');
  }

  public async resume(client: DatabaseClient, batchId: string): Promise<void> {
    const result=await client.query("UPDATE generation_batches SET status='running',blockers='[]'::jsonb,updated_at=NOW() WHERE id=$1::uuid AND status='paused' RETURNING id",[batchId]);
    if(result.rows.length!==1) throw new ConflictError('Only a paused generation batch can be resumed');
  }

  public async requestCancel(client: DatabaseClient, batchId: string): Promise<void> {
    const batch=await client.query<{status:string} & QueryResultRow>('SELECT status FROM generation_batches WHERE id=$1::uuid FOR UPDATE',[batchId]);
    if(!batch.rows[0]||!['quoted','running','paused','needs_review','cancelled'].includes(batch.rows[0].status))throw new ConflictError('Generation batch cannot be cancelled');
    const items=await client.query<{status:string} & QueryResultRow>('SELECT status FROM generation_batch_items WHERE batch_id=$1::uuid ORDER BY position FOR UPDATE',[batchId]);
    if(items.rows.some(item=>item.status==='confirming'))throw new ConflictError('Generation batch cannot be cancelled while reference confirmation is committing');
    await client.query("UPDATE generation_batches SET status='cancelled',cancel_requested_at=COALESCE(cancel_requested_at,NOW()),updated_at=NOW() WHERE id=$1::uuid",[batchId]);
    await client.query("UPDATE generation_batch_items SET status='cancelled',completed_at=NOW(),updated_at=NOW() WHERE batch_id=$1::uuid AND status='pending'",[batchId]);
  }

  public async updateBatch(client: DatabaseClient, batchId: string, status: GenerationBatchStatus, blockers: GenerationBatchBlocker[] = []): Promise<void> {
    await client.query("UPDATE generation_batches SET status=$2,blockers=$3::jsonb,updated_at=NOW() WHERE id=$1::uuid AND status NOT IN ('cancelled','completed')",[batchId,status,JSON.stringify(blockers)]);
  }

  public async updateItem(client: DatabaseClient, itemId: string, input: {
    status: GenerationBatchItemRecord['status']; childQuoteId?: string | null; jobId?: string | null;
    confirmation?: Record<string, unknown> | null; blocker?: GenerationBatchBlocker | null;
  }): Promise<void> {
    await client.query(
      `UPDATE generation_batch_items SET status=$2,child_quote_id=COALESCE($3::uuid,child_quote_id),job_id=COALESCE($4::uuid,job_id),
       confirmation=CASE WHEN $5::jsonb IS NULL THEN confirmation ELSE $5::jsonb END,blocker=$6::jsonb,
       started_at=CASE WHEN $2='active' THEN COALESCE(started_at,NOW()) ELSE started_at END,
       completed_at=CASE WHEN $2 IN ('completed','skipped','failed','cancelled','needs_review') THEN NOW() ELSE completed_at END,updated_at=NOW()
       WHERE id=$1::uuid`,
      [itemId,input.status,input.childQuoteId ?? null,input.jobId ?? null,input.confirmation===undefined ? null:JSON.stringify(input.confirmation),
        input.blocker===undefined ? null:JSON.stringify(input.blocker)],
    );
    await client.query('UPDATE generation_batches SET updated_at=NOW() WHERE id=(SELECT batch_id FROM generation_batch_items WHERE id=$1::uuid)',[itemId]);
  }

  public async findJob(client: DatabaseClient, jobId: string): Promise<GenerationBatchJobSnapshot | null> {
    const result=await client.query<{id:string;status:string;params:Record<string,unknown>;result:Record<string,unknown>;cancel_requested_at:Date|null;commit_started_at:Date|null} & QueryResultRow>(
      'SELECT id,status,params,result,cancel_requested_at,commit_started_at FROM generation_jobs WHERE id=$1::uuid',[jobId],
    );
    const row=result.rows[0];return row===undefined?null:{id:row.id,status:row.status,params:row.params,result:row.result,
      cancelRequestedAt:row.cancel_requested_at,commitStartedAt:row.commit_started_at};
  }

  public async findRunnableBatchIds(client:DatabaseClient,limit:number):Promise<string[]>{
    const result=await client.query<{id:string} & QueryResultRow>(
      `SELECT b.id FROM generation_batches b WHERE b.status='running'
       ORDER BY CASE WHEN
         EXISTS(SELECT 1 FROM generation_batch_items i JOIN generation_jobs j ON j.id=i.job_id
           WHERE i.batch_id=b.id AND i.status='active' AND j.status NOT IN ('queued','processing'))
         OR EXISTS(SELECT 1 FROM generation_batch_items i WHERE i.batch_id=b.id AND i.status='confirming'
           AND COALESCE((i.confirmation->>'lease_until')::timestamptz,'epoch'::timestamptz)<=NOW())
         OR (NOT EXISTS(SELECT 1 FROM generation_batch_items i WHERE i.batch_id=b.id AND i.status IN ('active','confirming'))
           AND EXISTS(SELECT 1 FROM generation_batch_items i WHERE i.batch_id=b.id AND i.status='pending'))
       THEN 0 ELSE 1 END, b.updated_at,b.id LIMIT $1`,[Math.max(1,Math.min(25,limit))],
    );
    return result.rows.map(row=>row.id);
  }

  public async findCancelledBatchIdsWithActiveChildren(client:DatabaseClient,limit:number):Promise<string[]>{
    const result=await client.query<{id:string} & QueryResultRow>(
      `SELECT b.id FROM generation_batches b
       JOIN generation_batch_items i ON i.batch_id=b.id
       LEFT JOIN generation_jobs j ON j.id=i.job_id
       WHERE b.status='cancelled' AND i.status='active' AND i.job_id IS NOT NULL
       GROUP BY b.id,b.updated_at
       ORDER BY MIN(CASE WHEN j.id IS NULL OR j.status IN ('queued','completed','failed','cancelled')
         OR (j.status='processing' AND j.cancel_requested_at IS NULL AND j.commit_started_at IS NULL)
         THEN 0 ELSE 1 END),b.updated_at,b.id LIMIT $1`,[Math.max(1,Math.min(25,limit))],
    );
    return result.rows.map(row=>row.id);
  }

  public async touchBatch(client:DatabaseClient,batchId:string):Promise<void>{
    await client.query("UPDATE generation_batches SET updated_at=NOW() WHERE id=$1::uuid AND status='cancelled'",[batchId]);
  }

  private async discoverCharacters(client: DatabaseClient, input: {userId:string;organizationId:string|null;workId:string}): Promise<GenerationBatchTarget[]> {
    const bases=await client.query<{id:string;name:string;updated_at:Date;status:string;primary_ref_id:string|null} & QueryResultRow>(
      `SELECT e.id,e.name,e.updated_at,e.status,r.primary_ref_id FROM entities e LEFT JOIN reference_sets r ON r.entity_id=e.id
       WHERE e.work_id=$1::uuid ORDER BY e.created_at,e.id`,[input.workId],
    );
    const states=await client.query<{id:string;entity_id:string;entity_name:string;name:string|null;description:string|null;revision:Date;reference_image:unknown} & QueryResultRow>(
      `SELECT s.id,s.entity_id,e.name AS entity_name,s.name,s.description,COALESCE(s.updated_at,s.created_at) AS revision,s.reference_image
       FROM entity_states s JOIN entities e ON e.id=s.entity_id WHERE e.work_id=$1::uuid ORDER BY e.created_at,s.created_at,s.id`,[input.workId],
    );
    const missingStates=states.rows.filter(row=>row.reference_image===null);const targets:GenerationBatchTarget[]=[];
    for(const row of bases.rows){
      if(row.primary_ref_id===null)targets.push({kind:'entity_base',targetId:row.id,entityId:row.id,label:row.name,
        revision:row.updated_at.toISOString(),ready:row.status==='draft'||row.status==='ready',definition:{entity_revision:row.updated_at.toISOString()}});
      targets.push(...missingStates.filter(state=>state.entity_id===row.id).map(state=>({kind:'entity_state' as const,targetId:state.id,entityId:state.entity_id,
        label:`${state.entity_name} / ${state.name ?? '名称未設定の状態'}`,revision:state.revision.toISOString(),
        ready:typeof state.name==='string'&&state.name.trim()!==''&&typeof state.description==='string'&&state.description.trim()!=='',
        definition:{state_revision:state.revision.toISOString(),name:state.name,description:state.description}})));
    }
    return targets;
  }

  private async discoverPages(client: DatabaseClient, input: {workId:string;episodeId:string|null}): Promise<GenerationBatchTarget[]> {
    const rows=await client.query<{id:string;page_number:number;updated_at:Date;generated_image:unknown;status:string} & QueryResultRow>(
      `SELECT p.id,p.page_number,p.updated_at,p.generated_image,p.status FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id
       WHERE c.work_id=$1::uuid AND p.episode_id=$2::uuid ORDER BY p.page_number,p.id`,[input.workId,input.episodeId],
    );
    return rows.rows.filter(row=>row.generated_image===null).map(row=>({kind:'page',targetId:row.id,entityId:null,label:`ページ${row.page_number}`,
      revision:row.updated_at.toISOString(),ready:row.status!=='generating',definition:{page_revision:row.updated_at.toISOString(),page_number:row.page_number}}));
  }
}

async function requireWorkScope(client:DatabaseClient,input:{userId:string;organizationId:string|null;workId:string;episodeId:string|null;kind:string}):Promise<void>{
  const result=await client.query(
    `SELECT w.id FROM works w JOIN users actor ON actor.id=$2::uuid WHERE w.id=$1::uuid
     AND actor.account_deletion_started_at IS NULL AND actor.account_deleted_at IS NULL
     AND (($3::uuid IS NULL AND w.user_id=$2::uuid AND w.organization_id IS NULL)
     OR ($3::uuid IS NOT NULL AND w.organization_id=$3::uuid AND EXISTS (SELECT 1 FROM organization_members m JOIN organizations o ON o.id=m.organization_id
       WHERE m.organization_id=w.organization_id AND m.user_id=$2::uuid AND m.status='active' AND m.role IN ('owner','admin','editor') AND o.status IN ('active','trialing'))))
     AND NOT EXISTS (SELECT 1 FROM work_deletion_requests wr WHERE wr.work_id=w.id)
     AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM episodes e JOIN chapters c ON c.id=e.chapter_id WHERE e.id=$4::uuid AND c.work_id=w.id))`,
    [input.workId,input.userId,input.organizationId,input.episodeId],
  );
  if(result.rows.length===0) throw new NotFoundError('Work or episode not found');
  if((input.kind==='pages') !== (input.episodeId!==null)) throw new ConflictError('Generation batch scope is invalid');
}
function mapBatch(row:BatchRow):GenerationBatchRecord{return{id:row.id,userId:row.user_id,organizationId:row.organization_id,workId:row.work_id,episodeId:row.episode_id,
  kind:row.kind,status:row.status,selection:row.selection,renderStyle:row.render_style,imageModel:row.image_model,pricingVersion:row.pricing_version,
  maximumCredits:row.maximum_credits,autoConfirm:row.auto_confirm,expiresAt:row.expires_at,acceptedAt:row.accepted_at,requestKey:row.request_key,
  blockers:row.blockers,createdAt:row.created_at,updatedAt:row.updated_at};}
function mapItem(row:ItemRow):GenerationBatchItemRecord{return{id:row.id,batchId:row.batch_id,position:row.position,kind:row.kind,label:row.label,targetId:row.target_id,
  entityId:row.entity_id,dependsOnItemId:row.depends_on_item_id,status:row.status,approvedRequest:row.approved_request,approvedInput:row.approved_input,
  inputRevision:row.input_revision,operation:row.operation,imageModel:row.image_model,providerModelId:row.provider_model_id,renderStyle:row.render_style,
  amountCredits:row.amount_credits,pricingVersion:row.pricing_version,childQuoteId:row.child_quote_id,jobId:row.job_id,confirmation:row.confirmation,blocker:row.blocker};}

export function asGenerationQuoteRequest(value:Record<string,unknown>):GenerationQuoteRequest{return value as unknown as GenerationQuoteRequest;}
