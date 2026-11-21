import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  InsufficientCreditsError,
  ValidationError,
} from '../../../domain/errors/index.js';
import {
  calculateQuotePrice,
  fingerprintQuoteInput,
  GENERATION_QUOTE_PRICING_VERSION,
  GENERATION_QUOTE_TTL_MS,
} from '../../../domain/generation/GenerationQuotePolicy.js';
import { GPT_IMAGE_25_SUNBURST, GPT_IMAGE_25_SUNBURST_SNAPSHOT } from '../../../domain/constants/openAIImageModel.js';
import type {
  GenerationBatchAcceptRequestBody,
  GenerationBatchApprovedItem,
  GenerationBatchBlocker,
  GenerationBatchCapabilitiesResponse,
  GenerationBatchCancelResponse,
  GenerationBatchItemRecord,
  GenerationBatchListResponse,
  GenerationBatchQuoteRequestBody,
  GenerationBatchRecord,
  GenerationBatchResponse,
  GenerationBatchResumeRequestBody,
} from '../../../domain/types/generationBatch.js';
import type { GenerationQuotePlan, GenerationQuoteRequest } from '../../../domain/types/generationQuote.js';
import type { DatabaseClient, TransactionRunner } from '../../../lib/db.js';
import {
  asGenerationQuoteRequest,
  PostgresGenerationBatchRepository,
  type GenerationBatchRepositoryPort,
  type GenerationBatchTarget,
} from '../../../repositories/GenerationBatchRepository.js';
import type { GenerationQuotePlanResolver } from '../../../repositories/GenerationQuotePlanResolver.js';
import type { RepositorySchemaProfile } from '../../../repositories/RepositorySchemaProfile.js';
import { bindTransaction } from '../../../repositories/TransactionBoundDatabase.js';
import { GenerationQuoteService, type GenerationQuoteDispatcherPort } from '../GenerationQuoteService.js';
import type { GenerationCapacityLimits } from '../GenerationCapacityGuard.js';
import type { GenerationBatchConfirmationPort } from './GenerationBatchConfirmationService.js';

export const GENERATION_BATCH_MAX_ITEMS = 100;
export interface GenerationBatchServiceDependencies {
  database:DatabaseClient & TransactionRunner;
  resolver:GenerationQuotePlanResolver;
  confirmation:GenerationBatchConfirmationPort;
  enabled:boolean;
  requiredImageModel:string;
  repository?:GenerationBatchRepositoryPort;
  dispatcher?:GenerationQuoteDispatcherPort;
  capacityLimits?:GenerationCapacityLimits;
  persistenceProfile?:RepositorySchemaProfile;
  childQuoteServiceFactory?:(database:DatabaseClient & TransactionRunner)=>Pick<GenerationQuoteService,'issue'|'accept'>;
  wake?:()=>Promise<void>;
}
export interface GenerationBatchReconcileInput {batchId?:string;limit?:number}

/** A batch owns only sequencing and approval. Every child still enters through
 * the existing immutable quote/admission/credit transaction and existing job
 * type, so replaying orchestration can never introduce a second charge. */
export class GenerationBatchService {
  private readonly repository:GenerationBatchRepositoryPort;
  public constructor(private readonly dependencies:GenerationBatchServiceDependencies){
    this.repository=dependencies.repository??new PostgresGenerationBatchRepository();
  }

  public capabilities():GenerationBatchCapabilitiesResponse{return{
    enabled:this.dependencies.enabled,image_model:this.dependencies.requiredImageModel,selections:['missing_only'],
    render_styles:['color','monochrome'],max_items:GENERATION_BATCH_MAX_ITEMS,quote_ttl_seconds:GENERATION_QUOTE_TTL_MS/1000,
  };}

  public async issue(userId:string,body:GenerationBatchQuoteRequestBody,organizationId:string|null=null):Promise<GenerationBatchResponse>{
    this.ensureEnabled();this.ensureModel();validateScope(body);
    return this.dependencies.database.transaction(async(client)=>{
      const targets=await this.repository.discoverTargets(client,{userId,organizationId,workId:body.work_id,
        episodeId:body.episode_id??null,kind:body.kind});
      if(targets.length>GENERATION_BATCH_MAX_ITEMS)throw new ValidationError(`Generation batch has more than ${GENERATION_BATCH_MAX_ITEMS} missing targets`);
      const blockers:GenerationBatchBlocker[]=[];
      const items:GenerationBatchApprovedItem[]=[];
      const baseIds=new Map<string,string>();
      for(const target of targets.filter(candidate=>candidate.kind==='entity_base'))baseIds.set(target.targetId,randomUUID());
      for(const target of targets){
        if(!target.ready){if(target.kind==='entity_base')baseIds.delete(target.targetId);blockers.push(blocker('TARGET_NOT_READY',null,target.targetId,'Target is not ready for generation',false));continue;}
        const id=target.kind==='entity_base'?baseIds.get(target.targetId)!:randomUUID();
        const dependency=target.kind==='entity_state'&&target.entityId!==null?baseIds.get(target.entityId)??null:null;
        try{items.push(await this.approveTarget(client,userId,organizationId,body,target,id,dependency));}
        catch(error){if(target.kind==='entity_base')baseIds.delete(target.targetId);blockers.push(blocker('TARGET_NOT_READY',null,target.targetId,safeReason(error,'Target is not ready for generation'),false));}
      }
      items.forEach((item,index)=>{item.position=index;});
      const now=new Date();const batch:GenerationBatchRecord={id:randomUUID(),userId,organizationId,workId:body.work_id,episodeId:body.episode_id??null,
        kind:body.kind,status:'quoted',selection:'missing_only',renderStyle:body.render_style,imageModel:this.dependencies.requiredImageModel,
        pricingVersion:GENERATION_QUOTE_PRICING_VERSION,maximumCredits:items.reduce((sum,item)=>sum+item.amountCredits,0),autoConfirm:false,
        expiresAt:new Date(now.getTime()+GENERATION_QUOTE_TTL_MS),acceptedAt:null,requestKey:null,blockers,createdAt:now,updatedAt:now};
      await this.repository.create(client,batch,items);
      return formatBatch(batch,items.map(item=>toPending(item,batch.id)),blockers);
    });
  }

  public async accept(userId:string,batchId:string,body:GenerationBatchAcceptRequestBody,organizationId:string|null=null):Promise<GenerationBatchResponse>{
    this.ensureEnabled();
    await this.dependencies.database.transaction(async(client)=>{
      const current=await this.repository.find(client,userId,organizationId,batchId,true);
      if(current.batch.status!=='quoted'){
        if(current.batch.requestKey!==body.request_key)throw new ConflictError('Batch quote was accepted with another request key');
      return current;
      }
      if(current.batch.expiresAt.getTime()<=Date.now())throw new ConflictError('Generation batch quote expired; request a new quote');
      await this.repository.accept(client,batchId,body.request_key);
      return this.repository.find(client,userId,organizationId,batchId);
    });
    await this.reconcile({batchId,limit:1});
    const accepted=await this.get(userId,batchId,organizationId);await this.wakeIfRunning(accepted);return accepted;
  }

  public async resume(userId:string,batchId:string,body:GenerationBatchResumeRequestBody,organizationId:string|null=null):Promise<GenerationBatchResponse>{
    this.ensureEnabled();
    await this.dependencies.database.transaction(async(client)=>{
      const current=await this.repository.find(client,userId,organizationId,batchId,true);
      if(current.batch.requestKey!==body.request_key)throw new ConflictError('Batch request key does not match');
      await this.repository.resume(client,batchId);
    });
    await this.reconcile({batchId,limit:1});const resumed=await this.get(userId,batchId,organizationId);await this.wakeIfRunning(resumed);return resumed;
  }

  public async get(userId:string,batchId:string,organizationId:string|null=null):Promise<GenerationBatchResponse>{
    this.ensureEnabled();
    const found=await this.repository.find(this.dependencies.database,userId,organizationId,batchId);return formatBatch(found.batch,found.items,found.batch.blockers);
  }
  public async list(userId:string,workId:string,episodeId:string|null,organizationId:string|null=null):Promise<GenerationBatchListResponse>{
    this.ensureEnabled();
    const found=await this.repository.list(this.dependencies.database,userId,organizationId,workId,episodeId);
    return{batches:found.map(entry=>formatBatch(entry.batch,entry.items,entry.batch.blockers))};
  }
  public async cancel(userId:string,batchId:string,organizationId:string|null=null):Promise<GenerationBatchCancelResponse>{
    this.ensureEnabled();const active=await this.dependencies.database.transaction(async(client)=>{
      const found=await this.repository.find(client,userId,organizationId,batchId,true);const jobIds=found.items.filter(item=>item.status==='active'&&item.jobId!==null).map(item=>item.jobId!);
      await this.repository.requestCancel(client,batchId);return jobIds;
    });
    const batch=await this.get(userId,batchId,organizationId);return{batch,active_job_ids:active};
  }

  /** Worker polling and terminal settlement may call this method. It admits at
   * most one new paid child per batch and performs at most `limit` bounded
   * state transitions. Paused batches are never resumed by reads or polling. */
  public async reconcile(input:GenerationBatchReconcileInput={}):Promise<number>{
    if(!this.dependencies.enabled)return 0;
    const limit=Math.max(1,Math.min(25,input.limit??10));
    const ids=input.batchId===undefined?await this.repository.findRunnableBatchIds(this.dependencies.database,limit):[input.batchId];
    let transitions=0;
    for(const id of ids){if(transitions>=limit)break;transitions+=await this.reconcileBatch(id,limit-transitions);}
    return transitions;
  }

  private async reconcileBatch(batchId:string,limit:number):Promise<number>{
    let transitions=0;
    while(transitions<limit){
      const found=await this.findBatchOperational(batchId);if(found===null||found.batch.status!=='running')break;
      const item=nextItem(found.items);if(item===null){await this.repository.updateBatch(this.dependencies.database,batchId,'completed',[]);transitions+=1;break;}
      const dependency=item.dependsOnItemId===null?null:found.items.find(candidate=>candidate.id===item.dependsOnItemId)??null;
      if(dependency!==null&&dependency.status!=='completed'){
        if(isTerminalFailure(dependency.status)){await this.failItem(found.batch,item,'DEPENDENCY_NOT_READY','Required base reference was not completed',false);transitions+=1;continue;}
        break;
      }
      if(item.status==='pending'){
        let currentTarget:GenerationBatchTarget|undefined;
        try{
          const currentTargets=await this.repository.discoverTargets(this.dependencies.database,{userId:found.batch.userId,organizationId:found.batch.organizationId,
            workId:found.batch.workId,episodeId:found.batch.episodeId,kind:found.batch.kind});
          currentTarget=currentTargets.find(candidate=>candidate.kind===item.kind&&candidate.targetId===item.targetId);
        }catch(error){await this.failItem(found.batch,item,'SCOPE_LOST',safeReason(error,'Work access is no longer available'),false);transitions+=1;continue;}
        if(currentTarget===undefined){await this.repository.updateItem(this.dependencies.database,item.id,{status:'skipped'});transitions+=1;continue;}
        if(!currentTarget.ready||currentTarget.revision!==approvedRevision(item)){
          await this.failItem(found.batch,item,'INPUT_CHANGED','Generation target changed after batch approval',false);transitions+=1;continue;
        }
        const admitted=await this.admitChild(found.batch,item);transitions+=1;if(admitted)break;continue;
      }
      if(item.jobId===null){await this.failItem(found.batch,item,'CHILD_FAILED','Batch item lost its generation receipt',false);transitions+=1;continue;}
      const job=await this.repository.findJob(this.dependencies.database,item.jobId);
      if(job===null){await this.failItem(found.batch,item,'CHILD_FAILED','Generation job is unavailable',false);transitions+=1;continue;}
      if(job.status==='queued'||job.status==='processing')break;
      if(job.status!=='completed'){
        await this.failItem(found.batch,item,'CHILD_FAILED',`Generation job ended as ${job.status}`,false);transitions+=1;continue;
      }
      if(item.kind==='page'){await this.repository.updateItem(this.dependencies.database,item.id,{status:'completed'});transitions+=1;continue;}
      try{const outcome=await this.dependencies.confirmation.confirm(found.batch,item,job);if(outcome==='in_progress')break;
        await this.repository.updateItem(this.dependencies.database,item.id,{status:'completed'});}
      catch(error){await this.failItem(found.batch,item,'CONFIRMATION_CONFLICT',safeReason(error,'Generated reference requires review'),false);}
      transitions+=1;
    }
    return transitions;
  }

  private async admitChild(batch:GenerationBatchRecord,item:GenerationBatchItemRecord):Promise<boolean>{
    let dispatchQuoteId:string|null=null;
    try{
      await this.dependencies.database.transaction(async(client)=>{
        const locked=await this.repository.find(client,batch.userId,batch.organizationId,batch.id,true);
        const current=locked.items.find(candidate=>candidate.id===item.id);
        if(locked.batch.status!=='running'||current?.status!=='pending')return;
        const bound=bindTransaction(client);const quotes=this.dependencies.childQuoteServiceFactory?.(bound)??new GenerationQuoteService({database:bound,resolver:this.dependencies.resolver,enabled:true,
          requiredImageModel:this.dependencies.requiredImageModel,capacityLimits:this.dependencies.capacityLimits,persistenceProfile:this.dependencies.persistenceProfile});
        const request=asGenerationQuoteRequest(current.approvedRequest);
        const issued=await quotes.issue(batch.userId,request,batch.organizationId);
        assertApprovedChild(current,issued.quote.plan);
        const receipt=await quotes.accept(batch.userId,issued.quote.id,issued.quoteToken,current.id,batch.organizationId);
        if(receipt.quote.acceptedJobId===null)throw new ConflictError('Batch child admission did not produce a job');
        await this.repository.updateItem(client,current.id,{status:'active',childQuoteId:issued.quote.id,jobId:receipt.quote.acceptedJobId});
        dispatchQuoteId=issued.quote.id;
      });
    }catch(error){
      try{
        const observed=await this.repository.find(this.dependencies.database,batch.userId,batch.organizationId,batch.id);
        const current=observed.items.find(candidate=>candidate.id===item.id);
        if(current?.status==='active'&&current.jobId!==null){
          if(current.childQuoteId!==null){try{await this.dependencies.dispatcher?.dispatchQuote(current.childQuoteId);}catch{/* Durable dispatch remains pending. */}}
          return true;
        }
      }catch{/* Preserve the original admission error when its receipt cannot be observed. */}
      if(isInsufficient(error)){await this.pause(batch,item,'INSUFFICIENT_CREDITS','Credit balance is insufficient');return false;}
      if(isCapacity(error)){await this.pause(batch,item,'CAPACITY_WAIT','Generation capacity is temporarily unavailable');return false;}
      await this.failItem(batch,item,classifyReview(error),safeReason(error,'Generation inputs changed; request a new batch quote'),false);return false;
    }
    if(dispatchQuoteId!==null){try{await this.dependencies.dispatcher?.dispatchQuote(dispatchQuoteId);}catch{/* Quote dispatch intent is durable. */}}
    return dispatchQuoteId!==null;
  }

  private async approveTarget(client:DatabaseClient,userId:string,organizationId:string|null,body:GenerationBatchQuoteRequestBody,target:GenerationBatchTarget,id:string,dependency:string|null):Promise<GenerationBatchApprovedItem>{
    const request:GenerationQuoteRequest={operation:target.kind==='page'?'page_generate':target.kind==='entity_state'?'entity_state_preview':'entity_preview',
      targetId:target.targetId,...(target.entityId===null?{}:{entityId:target.entityId}),imageModel:this.dependencies.requiredImageModel,
      ...(target.kind==='page'?{renderStyle:body.render_style}:{})};
    let plan:Pick<GenerationQuotePlan,'inputRevision'|'imageModel'|'providerModelId'|'renderStyle'|'amountCredits'|'pricingVersion'>;
    if(target.kind==='entity_state'&&dependency!==null){
      plan={inputRevision:fingerprintQuoteInput({definition:target.definition,dependency}),imageModel:GPT_IMAGE_25_SUNBURST,
        providerModelId:GPT_IMAGE_25_SUNBURST_SNAPSHOT,renderStyle:'color',amountCredits:calculateQuotePrice('entity_state_preview',1),pricingVersion:GENERATION_QUOTE_PRICING_VERSION};
    }else{
      const prepared=await this.dependencies.resolver.prepare(client,userId,organizationId,request);
      plan=await this.dependencies.resolver.resolve(client,userId,organizationId,request,prepared);
    }
    if(plan.imageModel!==this.dependencies.requiredImageModel||plan.providerModelId!==GPT_IMAGE_25_SUNBURST_SNAPSHOT)throw new ConflictError('Batch generation requires the pinned GPT Image 2.5 snapshot');
    return{id,position:0,kind:target.kind,label:target.label,targetId:target.targetId,entityId:target.entityId,dependsOnItemId:dependency,
      inputRevision:plan.inputRevision,operation:request.operation as GenerationBatchApprovedItem['operation'],imageModel:plan.imageModel,
      providerModelId:plan.providerModelId,renderStyle:target.kind==='page'?body.render_style:null,amountCredits:plan.amountCredits,
      pricingVersion:plan.pricingVersion,approvedRequest:request as unknown as Record<string,unknown>,approvedInput:{...target.definition,plan_input_revision:plan.inputRevision}};
  }

  private async findBatchOperational(batchId:string):Promise<{batch:GenerationBatchRecord;items:GenerationBatchItemRecord[]}|null>{
    const scope=await this.dependencies.database.query<{user_id:string;organization_id:string|null} & import('pg').QueryResultRow>('SELECT user_id,organization_id FROM generation_batches WHERE id=$1::uuid',[batchId]);
    const row=scope.rows[0];if(!row)return null;return this.repository.find(this.dependencies.database,row.user_id,row.organization_id,batchId);
  }
  private async pause(batch:GenerationBatchRecord,item:GenerationBatchItemRecord,code:'INSUFFICIENT_CREDITS'|'CAPACITY_WAIT',message:string):Promise<void>{
    const issue=blocker(code,item.id,item.targetId,message,true);await this.repository.updateBatch(this.dependencies.database,batch.id,'paused',[issue]);
  }
  private async failItem(batch:GenerationBatchRecord,item:GenerationBatchItemRecord,code:GenerationBatchBlocker['code'],message:string,retryable:boolean):Promise<void>{
    const issue=blocker(code,item.id,item.targetId,message,retryable);await this.repository.updateItem(this.dependencies.database,item.id,{status:'needs_review',blocker:issue});
    await this.repository.updateBatch(this.dependencies.database,batch.id,'needs_review',[issue]);
  }
  private ensureEnabled():void{if(!this.dependencies.enabled)throw new ConflictError('Generation batches are temporarily disabled');}
  private ensureModel():void{if(this.dependencies.requiredImageModel!==GPT_IMAGE_25_SUNBURST)throw new ConflictError('Generation batches require GPT Image 2.5');}
  private async wakeIfRunning(batch:GenerationBatchResponse):Promise<void>{if(batch.status!=='running'||this.dependencies.wake===undefined)return;
    try{await this.dependencies.wake();}catch{console.warn('generation_batch_worker_wake_failed',{batchId:batch.batch_id});}}
}

function validateScope(body:GenerationBatchQuoteRequestBody):void{if((body.kind==='pages')!==(body.episode_id!==undefined))throw new ValidationError('Page batches require episode_id and character batches must omit it');}
function assertApprovedChild(item:GenerationBatchItemRecord,plan:GenerationQuotePlan):void{
  const dependencyState=item.kind==='entity_state'&&item.dependsOnItemId!==null;
  if((!dependencyState&&plan.inputRevision!==item.inputRevision)||plan.amountCredits!==item.amountCredits||plan.pricingVersion!==item.pricingVersion||plan.imageModel!==item.imageModel||plan.providerModelId!==item.providerModelId||
    (item.kind==='page'&&plan.renderStyle!==item.renderStyle))throw new ConflictError('Generation inputs or price changed; request a new batch quote');
  if(dependencyState){const state=plan.snapshot.kind==='entity'?plan.snapshot.state:null;
    if(state===null||state.stateRevision!==item.approvedInput.state_revision||state.baseReference.refId!==item.dependsOnItemId)
      throw new ConflictError('State definition or batch-produced base changed; request a new batch quote');}
}
function nextItem(items:GenerationBatchItemRecord[]):GenerationBatchItemRecord|null{return items.find(item=>item.status==='active'||item.status==='confirming')??items.find(item=>item.status==='pending')??null;}
function isTerminalFailure(status:GenerationBatchItemRecord['status']):boolean{return status==='failed'||status==='cancelled'||status==='needs_review'||status==='skipped';}
function blocker(code:GenerationBatchBlocker['code'],itemId:string|null,targetId:string|null,message:string,retryable:boolean):GenerationBatchBlocker{return{code,item_id:itemId,target_id:targetId,message,retryable};}
function safeReason(error:unknown,fallback:string):string{return error instanceof Error&&error.message.length<=240?error.message:fallback;}
function isInsufficient(error:unknown):boolean{return error instanceof InsufficientCreditsError||(typeof error==='object'&&error!==null&&'code'in error&&error.code==='INSUFFICIENT_CREDITS');}
function isCapacity(error:unknown):boolean{return error instanceof Error&&(error.message.includes('too many active generation jobs')||error.message.includes('Generation queue is temporarily full')||error.message.includes('Generation scope has too many active')) ;}
function classifyReview(error:unknown):GenerationBatchBlocker['code']{return error instanceof Error&&error.message.includes('price')?'PRICE_CHANGED':error instanceof Error&&error.message.includes('model')?'MODEL_CHANGED':'INPUT_CHANGED';}
function approvedRevision(item:GenerationBatchItemRecord):string{const key=item.kind==='entity_base'?'entity_revision':item.kind==='entity_state'?'state_revision':'page_revision';const value=item.approvedInput[key];
  if(typeof value!=='string')throw new ConflictError('Approved generation revision is unavailable');return value;}
function toPending(item:GenerationBatchApprovedItem,batchId:string):GenerationBatchItemRecord{return{...item,batchId,status:'pending',childQuoteId:null,jobId:null,confirmation:null,blocker:null};}
function formatBatch(batch:GenerationBatchRecord,items:GenerationBatchItemRecord[],blockers:GenerationBatchBlocker[]):GenerationBatchResponse{
  const count=(...statuses:GenerationBatchItemRecord['status'][]):number=>items.filter(item=>statuses.includes(item.status)).length;
  return{batch_id:batch.id,work_id:batch.workId,kind:batch.kind,episode_id:batch.episodeId,status:batch.status,selection:batch.selection,
    render_style:batch.renderStyle,image_model:batch.imageModel,pricing_version:batch.pricingVersion,maximum_credits:batch.maximumCredits,
    auto_confirm:batch.autoConfirm,expires_at:batch.expiresAt.toISOString(),accepted_at:batch.acceptedAt?.toISOString()??null,
    created_at:batch.createdAt.toISOString(),updated_at:batch.updatedAt.toISOString(),progress:{total:items.length,completed:count('completed'),skipped:count('skipped'),failed:count('failed','needs_review'),active:count('active','confirming'),pending:count('pending')},
    items:items.map(item=>({item_id:item.id,kind:item.kind,label:item.label,status:item.status,target_id:item.targetId,entity_id:item.entityId,
      depends_on_item_id:item.dependsOnItemId,job_id:item.jobId,input_revision:item.inputRevision,operation:item.operation,image_model:item.imageModel,
      provider_model_id:item.providerModelId,render_style:item.renderStyle,amount_credits:item.amountCredits,pricing_version:item.pricingVersion})),
    blockers:[...blockers,...items.flatMap(item=>item.blocker===null?[]:[item.blocker])],active_job_ids:items.filter(item=>item.status==='active'&&item.jobId!==null).map(item=>item.jobId!)};
}
