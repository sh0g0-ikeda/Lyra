import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import type { EntityReferenceImage } from '../domain/types/entityReference.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface GenerationBatchBaseConfirmation {
  itemId: string;
  userId: string;
  organizationId: string | null;
  entityId: string;
  jobId: string;
  sourceS3Key: string;
  refId: string;
  expectedRevision: string;
  imageModel: string;
  providerModelId: string;
  provider: 'openai';
  newlyPrepared: boolean;
  committed: boolean;
  inProgress: boolean;
  claimToken: string;
}
export interface GenerationBatchStateConfirmationClaim {itemId:string;claimToken:string;newlyPrepared:boolean;committed:boolean;inProgress:boolean}
export interface GenerationBatchConfirmationRepositoryPort {
  prepareBase(itemId:string):Promise<GenerationBatchBaseConfirmation>;
  commitBase(input:GenerationBatchBaseConfirmation,stored:{s3Key:string;cdnUrl:string}):Promise<void>;
  prepareState(itemId:string):Promise<GenerationBatchStateConfirmationClaim>;
  commitState(claim:GenerationBatchStateConfirmationClaim):Promise<void>;
}

const STATE_CONFIRMATION_MAX_RECOVERY_CLAIMS=3;

export class PostgresGenerationBatchConfirmationRepository implements GenerationBatchConfirmationRepositoryPort {
  public constructor(private readonly database: DatabaseClient & TransactionRunner) {}

  /** Persist copy intent before touching storage. An existing unresolved intent
   * is never dispatched again because its remote result is unknown. */
  public async prepareBase(itemId:string):Promise<GenerationBatchBaseConfirmation>{
    return this.database.transaction(async(client)=>{
      const batch=await lockBatchForItem(client,itemId);
      const item=await client.query<{
        id:string;status:string;target_id:string;job_id:string|null;approved_input:Record<string,unknown>;
        confirmation:Record<string,unknown>|null;
      } & QueryResultRow>(
        `SELECT i.id,i.status,i.target_id,i.job_id,i.approved_input,i.confirmation FROM generation_batch_items i
         WHERE i.id=$1::uuid AND i.kind='entity_base' FOR UPDATE`,[itemId],
      );
      const row=item.rows[0];if(!row||!row.job_id)throw new NotFoundError('Batch base confirmation is unavailable');
      if(batch.status!=='running')throw new ConflictError('Generation batch is no longer running');
      if(row.confirmation!==null){
        const parsed=parseConfirmation({...row,user_id:batch.userId,organization_id:batch.organizationId},row.confirmation);
        if(row.confirmation.state==='committed')return{...parsed,newlyPrepared:false,committed:true,inProgress:false,claimToken:readString(row.confirmation.claim_token,'claim_token')};
        if(row.confirmation.state==='copy_pending'&&future(row.confirmation.lease_until))return{...parsed,newlyPrepared:false,committed:false,inProgress:true,claimToken:readString(row.confirmation.claim_token,'claim_token')};
        throw new ConflictError('Base reference copy outcome requires review; no new copy was started');
      }
      if(row.status!=='active')throw new ConflictError('Base batch item is not active');
      await requireConfirmationScope(client,batch.userId,batch.organizationId,row.target_id);
      const current=await client.query<{updated_at:Date;primary_ref_id:string|null} & QueryResultRow>(
        'SELECT e.updated_at,r.primary_ref_id FROM entities e JOIN reference_sets r ON r.entity_id=e.id WHERE e.id=$1::uuid FOR UPDATE OF r,e',[row.target_id],
      );
      const entity=current.rows[0];if(!entity)throw new NotFoundError('Entity not found');
      if(entity.primary_ref_id!==null)throw new ConflictError('A primary reference was confirmed while the batch was running');
      const expected=readString(row.approved_input.entity_revision,'entity_revision');
      if(entity.updated_at.toISOString()!==expected)throw new ConflictError('Entity changed after the batch quote');
      const job=await client.query<{status:string;params:Record<string,unknown>;result:Record<string,unknown>} & QueryResultRow>(
        'SELECT status,params,result FROM generation_jobs WHERE id=$1::uuid FOR UPDATE',[row.job_id],
      );
      const completed=job.rows[0];if(!completed||completed.status!=='completed')throw new ConflictError('Entity preview is not completed');
      const candidate=readFirstCandidate(completed.result);
      const confirmation={state:'copy_pending',claim_token:randomUUID(),lease_until:new Date(Date.now()+5*60_000).toISOString(),source_s3_key:candidate.s3Key,ref_id:row.id,expected_revision:expected,
        image_model:readString(completed.params.image_model,'image_model'),provider_model_id:readString(completed.params.provider_model_id,'provider_model_id'),provider:'openai'};
      await client.query("UPDATE generation_batch_items SET status='confirming',confirmation=$2::jsonb,updated_at=NOW() WHERE id=$1::uuid",[row.id,JSON.stringify(confirmation)]);
      return{itemId:row.id,userId:batch.userId,organizationId:batch.organizationId,entityId:row.target_id,jobId:row.job_id,
        sourceS3Key:candidate.s3Key,refId:row.id,expectedRevision:expected,imageModel:confirmation.image_model,
        providerModelId:confirmation.provider_model_id,provider:'openai',newlyPrepared:true,committed:false,inProgress:false,claimToken:confirmation.claim_token};
    });
  }

  public async commitBase(input:GenerationBatchBaseConfirmation,stored:{s3Key:string;cdnUrl:string}):Promise<void>{
    await this.database.transaction(async(client)=>{
      const batch=await lockBatchForItem(client,input.itemId);
      const locked=await client.query<{confirmation:Record<string,unknown>|null;status:string} & QueryResultRow>(
        'SELECT confirmation,status FROM generation_batch_items WHERE id=$1::uuid FOR UPDATE',[input.itemId],
      );
      const row=locked.rows[0];if(!row?.confirmation)throw new ConflictError('Base confirmation intent is missing');
      if(row.confirmation.state==='committed')return;
      if(batch.status!=='running'||row.status!=='confirming'||row.confirmation.state!=='copy_pending'||row.confirmation.claim_token!==input.claimToken
        ||row.confirmation.ref_id!==input.refId||row.confirmation.source_s3_key!==input.sourceS3Key)throw new ConflictError('Base confirmation intent changed or was cancelled');
      await requireConfirmationScope(client,batch.userId,batch.organizationId,input.entityId);
      const refs=await client.query<{reference_images:unknown;primary_ref_id:string|null} & QueryResultRow>(
        'SELECT reference_images,primary_ref_id FROM reference_sets WHERE entity_id=$1::uuid FOR UPDATE',[input.entityId],
      );
      const ref=refs.rows[0];if(!ref)throw new NotFoundError('Reference set not found');
      const entity=await client.query<{updated_at:Date} & QueryResultRow>('SELECT updated_at FROM entities WHERE id=$1::uuid FOR UPDATE',[input.entityId]);
      if(entity.rows[0]?.updated_at.toISOString()!==input.expectedRevision)throw new ConflictError('Entity changed while the batch reference was being confirmed');
      if(ref.primary_ref_id!==null&&ref.primary_ref_id!==input.refId)throw new ConflictError('A primary reference was confirmed while the batch was running');
      const images=parseImages(ref.reference_images);
      const image:EntityReferenceImage={refId:input.refId,s3Key:stored.s3Key,cdnUrl:stored.cdnUrl,source:'generated',createdAt:new Date().toISOString(),
        imageModel:input.imageModel,providerModelId:input.providerModelId,provider:input.provider};
      const merged=images.some(existing=>existing.refId===input.refId)?images:[...images,image];
      await client.query("UPDATE reference_sets SET reference_images=$2::jsonb,primary_ref_id=$3::uuid,status='ready',updated_at=NOW() WHERE entity_id=$1::uuid",
        [input.entityId,JSON.stringify(merged.map(toPersistedImage)),input.refId]);
      await client.query("UPDATE entities SET status='ready',updated_at=NOW() WHERE id=$1::uuid",[input.entityId]);
      await client.query("UPDATE generation_batch_items SET status='completed',confirmation=$2::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$1::uuid",
        [input.itemId,JSON.stringify({...row.confirmation,state:'committed',destination_s3_key:stored.s3Key})]);
    });
  }

  public async prepareState(itemId:string):Promise<GenerationBatchStateConfirmationClaim>{
    return this.database.transaction(async(client)=>{
      const batch=await lockBatchForItem(client,itemId);
      const result=await client.query<{status:string;confirmation:Record<string,unknown>|null;entity_id:string|null} & QueryResultRow>(
        `SELECT status,confirmation,entity_id FROM generation_batch_items WHERE id=$1::uuid AND kind='entity_state' FOR UPDATE`,[itemId],
      );
      const row=result.rows[0];if(!row||row.entity_id===null)throw new NotFoundError('Batch state confirmation is unavailable');
      if(batch.status!=='running')throw new ConflictError('Generation batch is no longer running');
      if(row.confirmation?.state==='committed')return{itemId,claimToken:readString(row.confirmation.claim_token,'claim_token'),newlyPrepared:false,committed:true,inProgress:false};
      if(row.confirmation?.state==='confirming'&&future(row.confirmation.lease_until))return{itemId,claimToken:readString(row.confirmation.claim_token,'claim_token'),newlyPrepared:false,committed:false,inProgress:true};
      if(row.confirmation?.state==='confirming'){
        if(row.status!=='confirming')throw new ConflictError('State reference confirmation outcome requires review');
        await requireConfirmationScope(client,batch.userId,batch.organizationId,row.entity_id);
        const previousToken=readString(row.confirmation.claim_token,'claim_token');
        const recoveryCount=readRecoveryCount(row.confirmation.recovery_count);
        if(recoveryCount>=STATE_CONFIRMATION_MAX_RECOVERY_CLAIMS)throw new ConflictError('State reference confirmation recovery limit was reached');
        const claimToken=randomUUID();const confirmation={...row.confirmation,claim_token:claimToken,
          lease_until:new Date(Date.now()+5*60_000).toISOString(),recovery_count:recoveryCount+1};
        const claimed=await client.query(
          `UPDATE generation_batch_items SET confirmation=$2::jsonb,updated_at=NOW()
           WHERE id=$1::uuid AND status='confirming' AND confirmation->>'state'='confirming'
             AND confirmation->>'claim_token'=$3 RETURNING id`,[itemId,JSON.stringify(confirmation),previousToken]);
        if(claimed.rows.length!==1)throw new ConflictError('State reference confirmation was concurrently reclaimed');
        return{itemId,claimToken,newlyPrepared:true,committed:false,inProgress:false};
      }
      if(row.confirmation!==null)throw new ConflictError('State reference confirmation outcome requires review');
      if(row.status!=='active')throw new ConflictError('State batch item is not active');
      await requireConfirmationScope(client,batch.userId,batch.organizationId,row.entity_id);
      const claimToken=randomUUID();const confirmation={state:'confirming',claim_token:claimToken,lease_until:new Date(Date.now()+5*60_000).toISOString(),recovery_count:0};
      await client.query("UPDATE generation_batch_items SET status='confirming',confirmation=$2::jsonb,updated_at=NOW() WHERE id=$1::uuid",[itemId,JSON.stringify(confirmation)]);
      return{itemId,claimToken,newlyPrepared:true,committed:false,inProgress:false};
    });
  }

  public async commitState(claim:GenerationBatchStateConfirmationClaim):Promise<void>{
    await this.database.transaction(async(client)=>{
      const batch=await lockBatchForItem(client,claim.itemId);
      const result=await client.query<{status:string;confirmation:Record<string,unknown>|null;entity_id:string|null} & QueryResultRow>(
        `SELECT status,confirmation,entity_id FROM generation_batch_items WHERE id=$1::uuid FOR UPDATE`,[claim.itemId],
      );
      const row=result.rows[0];if(!row||row.entity_id===null)throw new NotFoundError('Batch state confirmation is unavailable');
      if(row.confirmation?.state==='committed')return;
      if(batch.status!=='running'||row.status!=='confirming'||row.confirmation?.state!=='confirming'||row.confirmation.claim_token!==claim.claimToken)throw new ConflictError('State confirmation was cancelled or superseded');
      await requireConfirmationScope(client,batch.userId,batch.organizationId,row.entity_id);
      await client.query("UPDATE generation_batch_items SET status='completed',confirmation=$2::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$1::uuid",
        [claim.itemId,JSON.stringify({...row.confirmation,state:'committed'})]);
    });
  }
}

function parseConfirmation(row:{id:string;target_id:string;job_id:string|null;approved_input:Record<string,unknown>;user_id:string;organization_id:string|null},value:Record<string,unknown>):Omit<GenerationBatchBaseConfirmation,'newlyPrepared'|'committed'|'inProgress'|'claimToken'>{
  if(!row.job_id)throw new ConflictError('Base confirmation job is missing');
  return{itemId:row.id,userId:row.user_id,organizationId:row.organization_id,entityId:row.target_id,jobId:row.job_id,
    sourceS3Key:readString(value.source_s3_key,'source_s3_key'),refId:readString(value.ref_id,'ref_id'),
    expectedRevision:readString(row.approved_input.entity_revision,'entity_revision'),imageModel:readString(value.image_model,'image_model'),
    providerModelId:readString(value.provider_model_id,'provider_model_id'),provider:'openai'};
}
function readFirstCandidate(result:Record<string,unknown>):{s3Key:string}{const candidates=result.candidates;if(!Array.isArray(candidates)||candidates.length===0)throw new ConflictError('Entity preview candidate is missing');
  const first=candidates[0];if(typeof first!=='object'||first===null)throw new ConflictError('Entity preview candidate is invalid');return{s3Key:readString((first as Record<string,unknown>).s3_key,'candidate s3_key')};}
function readString(value:unknown,name:string):string{if(typeof value!=='string'||value.length===0)throw new ConflictError(`${name} is unavailable`);return value;}
function readRecoveryCount(value:unknown):number{if(value===undefined)return 0;if(!Number.isSafeInteger(value)||Number(value)<0)throw new ConflictError('State confirmation recovery count is invalid');return Number(value);}
function future(value:unknown):boolean{return typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now();}
async function lockBatchForItem(client:DatabaseClient,itemId:string):Promise<{status:string;userId:string;organizationId:string|null}>{
  const result=await client.query<{status:string;user_id:string;organization_id:string|null} & QueryResultRow>(
    `SELECT b.status,b.user_id,b.organization_id FROM generation_batches b JOIN generation_batch_items i ON i.batch_id=b.id
     WHERE i.id=$1::uuid FOR UPDATE OF b`,[itemId],
  );const row=result.rows[0];if(!row)throw new NotFoundError('Generation batch not found');return{status:row.status,userId:row.user_id,organizationId:row.organization_id};
}
async function requireConfirmationScope(client:DatabaseClient,userId:string,organizationId:string|null,entityId:string):Promise<void>{
  const result=await client.query(
    `SELECT e.id FROM entities e JOIN works w ON w.id=e.work_id JOIN users actor ON actor.id=$2::uuid WHERE e.id=$1::uuid
     AND actor.account_deletion_started_at IS NULL AND actor.account_deleted_at IS NULL
     AND (($3::uuid IS NULL AND w.organization_id IS NULL AND e.user_id=$2::uuid)
       OR ($3::uuid IS NOT NULL AND w.organization_id=$3::uuid AND EXISTS(SELECT 1 FROM organization_members m JOIN organizations o ON o.id=m.organization_id
         WHERE m.organization_id=$3::uuid AND m.user_id=$2::uuid AND m.status='active' AND m.role IN ('owner','admin','editor') AND o.status IN ('active','trialing'))))
     AND NOT EXISTS(SELECT 1 FROM work_deletion_requests wr WHERE wr.work_id=w.id) FOR SHARE OF e,w`,[entityId,userId,organizationId],
  );if(result.rows.length!==1)throw new ConflictError('Generation scope is no longer authorized');
}
function parseImages(value:unknown):EntityReferenceImage[]{return Array.isArray(value)?value.filter((entry):entry is EntityReferenceImage=>typeof entry==='object'&&entry!==null&&typeof (entry as {ref_id?:unknown}).ref_id==='string').map(entry=>{
  const record=entry as unknown as Record<string,unknown>;return{refId:readString(record.ref_id,'ref_id'),s3Key:readString(record.s3_key,'s3_key'),cdnUrl:readString(record.cdn_url,'cdn_url'),
    source:record.source==='upload'?'upload':'generated',createdAt:readString(record.created_at,'created_at'),imageModel:typeof record.image_model==='string'?record.image_model:null,
    providerModelId:typeof record.provider_model_id==='string'?record.provider_model_id:null,provider:record.provider==='openai'||record.provider==='hy4'?record.provider:null};}):[];}
function toPersistedImage(image:EntityReferenceImage):Record<string,unknown>{return{ref_id:image.refId,s3_key:image.s3Key,cdn_url:image.cdnUrl,source:image.source,created_at:image.createdAt,
  ...(image.imageModel===undefined?{}:{image_model:image.imageModel}),...(image.providerModelId===undefined?{}:{provider_model_id:image.providerModelId}),
  ...(image.provider===undefined?{}:{provider:image.provider})};}
