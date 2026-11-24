import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../../src/domain/errors/index.js';
import { GPT_IMAGE_25_SUNBURST, GPT_IMAGE_25_SUNBURST_SNAPSHOT } from '../../../../src/domain/constants/openAIImageModel.js';
import type { GenerationBatchApprovedItem, GenerationBatchBlocker, GenerationBatchItemRecord, GenerationBatchRecord, GenerationBatchStatus } from '../../../../src/domain/types/generationBatch.js';
import type { GenerationQuote, GenerationQuotePlan, GenerationQuoteReceipt, GenerationQuoteRequest } from '../../../../src/domain/types/generationQuote.js';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import type { GenerationBatchJobSnapshot, GenerationBatchRepositoryPort, GenerationBatchTarget } from '../../../../src/repositories/GenerationBatchRepository.js';
import type { GenerationQuotePlanResolver } from '../../../../src/repositories/GenerationQuotePlanResolver.js';
import { GenerationBatchService } from '../../../../src/services/generation/batch/GenerationBatchService.js';
import type { GenerationBatchConfirmationPort } from '../../../../src/services/generation/batch/GenerationBatchConfirmationService.js';
import type { GenerationQuoteDispatcherPort } from '../../../../src/services/generation/GenerationQuoteService.js';

const userId='11111111-1111-4111-8111-111111111111';
const workId='22222222-2222-4222-8222-222222222222';
const entityId='33333333-3333-4333-8333-333333333333';
const stateId='44444444-4444-4444-8444-444444444444';

describe('GenerationBatchService',()=>{
  it('未確定baseとstateを同じ承認額へ固定しbase先行依存を返す',async()=>{
    const repository=new FakeBatchRepository([
      target('entity_base',entityId,entityId,'ミオ','entity-rev'),
      target('entity_state',stateId,entityId,'ミオ / 負傷','state-rev'),
    ]);
    const service=buildService(repository);

    const result=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});

    expect(result.maximum_credits).toBe(2);
    expect(result.items.map(item=>item.kind)).toEqual(['entity_base','entity_state']);
    expect(result.items[1]?.depends_on_item_id).toBe(result.items[0]?.item_id);
    expect(result.items.every(item=>item.image_model===GPT_IMAGE_25_SUNBURST&&item.provider_model_id===GPT_IMAGE_25_SUNBURST_SNAPSHOT)).toBe(true);
    expect(result.items.map(item=>item.label)).toEqual(['ミオ','ミオ / 負傷']);
  });

  it('accept再送は同じchild receiptを返し二重job・二重課金を作らない',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);
    const service=buildService(repository,child);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const body={request_key:'55555555-5555-4555-8555-555555555555',auto_confirm:true as const};

    const first=await service.accept(userId,quote.batch_id,body);
    const replay=await service.accept(userId,quote.batch_id,body);

    expect(first.status).toBe('running');
    expect(replay.items[0]?.job_id).toBe(first.items[0]?.job_id);
    expect(child.issueCount).toBe(1);
    expect(child.acceptCount).toBe(1);
  });

  it('capacity不足は自動再開せず明示resumeで同じ未着手itemだけを再試行する',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);child.capacityFailure=true;
    const service=buildService(repository,child);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const requestKey='66666666-6666-4666-8666-666666666666';

    const paused=await service.accept(userId,quote.batch_id,{request_key:requestKey,auto_confirm:true});
    await service.get(userId,quote.batch_id);
    await service.reconcile({batchId:quote.batch_id,limit:10});
    expect(paused.status).toBe('paused');
    expect(child.issueCount).toBe(1);

    child.capacityFailure=false;
    const resumed=await service.resume(userId,quote.batch_id,{request_key:requestKey});
    expect(resumed.status).toBe('running');
    expect(resumed.items[0]?.status).toBe('active');
    expect(child.issueCount).toBe(2);
  });

  it('値上げされたchild quoteは課金前にneeds_reviewとなり自動新job化しない',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);child.priceDelta=1;
    const service=buildService(repository,child);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});

    const result=await service.accept(userId,quote.batch_id,{request_key:'77777777-7777-4777-8777-777777777777',auto_confirm:true});

    expect(result.status).toBe('needs_review');
    expect(result.blockers[0]?.code).toBe('PRICE_CHANGED');
    expect(child.acceptCount).toBe(0);
    await service.reconcile({batchId:quote.batch_id,limit:10});
    expect(child.issueCount).toBe(1);
  });

  it('既存画像を除いたpage対象だけを白黒生成quoteへ固定する',async()=>{
    const pageId='88888888-8888-4888-8888-888888888888';
    const repository=new FakeBatchRepository([target('page',pageId,null,'ページ2','page-rev')]);
    const service=buildService(repository);
    const result=await service.issue(userId,{work_id:workId,episode_id:'99999999-9999-4999-8999-999999999999',kind:'pages',selection:'missing_only',render_style:'monochrome'});
    expect(result.items).toEqual([expect.objectContaining({target_id:pageId,render_style:'monochrome',operation:'page_generate'})]);
  });

  it('別workerのconfirmation lease中はneeds_reviewへ落とさず待機する',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);const confirmation:GenerationBatchConfirmationPort={confirm:async()=>'in_progress'};
    const service=buildService(repository,child,confirmation);const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const active=await service.accept(userId,quote.batch_id,{request_key:'12121212-1212-4212-8212-121212121212',auto_confirm:true});
    repository.jobs.get(active.items[0]!.job_id!)!.status='completed';
    await service.reconcile({batchId:quote.batch_id,limit:2});
    const current=await service.get(userId,quote.batch_id);
    expect(current.status).toBe('running');expect(current.items[0]?.status).toBe('active');expect(current.blockers).toEqual([]);
  });

  it('workerが次のqueued子を同じquoteとjobで再配信しても再受付と再課金をしない',async()=>{
    const secondEntityId='56565656-5656-4656-8656-565656565656';
    const repository=new FakeBatchRepository([
      target('entity_base',entityId,entityId,'ミオ','entity-rev'),
      target('entity_base',secondEntityId,secondEntityId,'レオ','entity-rev-2'),
    ]);
    const child=new FakeChildQuotes(repository);const dispatched:string[]=[];
    const dispatcher:GenerationQuoteDispatcherPort={dispatchQuote:async(quoteId)=>{dispatched.push(quoteId);}};
    const service=buildService(repository,child,new NoopConfirmation(),dispatcher);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});

    const accepted=await service.accept(userId,quote.batch_id,{request_key:'34343434-3434-4434-8434-343434343434',auto_confirm:true});
    repository.jobs.get(accepted.items[0]!.job_id!)!.status='completed';
    await service.reconcile({batchId:quote.batch_id,limit:2});
    const second=(await service.get(userId,quote.batch_id)).items[1]!;
    await service.reconcile({batchId:quote.batch_id,limit:1});

    expect(dispatched).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    ]);
    expect(second.status).toBe('active');expect(second.job_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-000000000002');
    expect(child.issueCount).toBe(2);expect(child.acceptCount).toBe(2);
  });

  it('親だけcancelledだった再送でも取消済み子を回収し完了済み画像を変更しない',async()=>{
    const secondEntityId='78787878-7878-4787-8787-787878787878';
    const repository=new FakeBatchRepository([
      target('entity_base',entityId,entityId,'ミオ','entity-rev'),
      target('entity_base',secondEntityId,secondEntityId,'レオ','entity-rev-2'),
    ]);
    const child=new FakeChildQuotes(repository);const service=buildService(repository,child);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const accepted=await service.accept(userId,quote.batch_id,{request_key:'89898989-8989-4898-8989-898989898989',auto_confirm:true});
    repository.jobs.get(accepted.items[0]!.job_id!)!.status='completed';
    await service.reconcile({batchId:quote.batch_id,limit:2});
    const beforeCancel=await service.get(userId,quote.batch_id);const secondJobId=beforeCancel.items[1]!.job_id!;
    repository.jobs.get(secondJobId)!.status='cancelled';

    const cancelled=await service.cancel(userId,quote.batch_id);

    expect(cancelled.active_job_ids).toEqual([]);
    expect(cancelled.batch.items.map(item=>item.status)).toEqual(['completed','cancelled']);
    expect(child.issueCount).toBe(2);expect(child.acceptCount).toBe(2);
  });

  it('親cancelled直後にAPIが落ちてもworker周期で取消済み子を回収する',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);const service=buildService(repository,child);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const accepted=await service.accept(userId,quote.batch_id,{request_key:'90909090-9090-4090-8090-909090909090',auto_confirm:true});
    const jobId=accepted.items[0]!.job_id!;
    const parentOnly=await service.cancel(userId,quote.batch_id);
    expect(parentOnly.active_job_ids).toEqual([jobId]);
    repository.jobs.get(jobId)!.status='cancelled';

    await service.reconcile({limit:2});

    expect((await service.get(userId,quote.batch_id)).items[0]?.status).toBe('cancelled');
  });

  it('親cancelled直後に子停止前で落ちてもworkerが既存jobを一度だけ停止して回収する',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);const cancelled:string[]=[];
    const jobCancellation={cancelJob:async(_user:string,jobId:string):Promise<{status:string}>=>{
      cancelled.push(jobId);repository.jobs.get(jobId)!.status='cancelled';return{status:'cancelled'};
    }};
    const service=buildService(repository,child,new NoopConfirmation(),undefined,jobCancellation);
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const accepted=await service.accept(userId,quote.batch_id,{request_key:'91919191-9191-4191-8191-919191919191',auto_confirm:true});
    const jobId=accepted.items[0]!.job_id!;
    expect((await service.cancel(userId,quote.batch_id)).active_job_ids).toEqual([jobId]);

    await service.reconcile({limit:2});
    await service.reconcile({limit:2});

    expect(cancelled).toEqual([jobId]);
    expect((await service.get(userId,quote.batch_id)).items[0]?.status).toBe('cancelled');
  });

  it('取消済み親に残ったactive子が既存回収でfailedなら再停止せずterminalへ収束する',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);const cancelJob=vi.fn(async()=>({status:'cancelled'}));
    const service=buildService(repository,child,new NoopConfirmation(),undefined,{cancelJob});
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const accepted=await service.accept(userId,quote.batch_id,{request_key:'92929292-9292-4292-8292-929292929292',auto_confirm:true});
    const jobId=accepted.items[0]!.job_id!;
    await service.cancel(userId,quote.batch_id);repository.jobs.get(jobId)!.status='failed';

    await service.reconcile({limit:2});

    expect(cancelJob).not.toHaveBeenCalled();
    expect((await service.get(userId,quote.batch_id)).items[0]?.status).toBe('failed');
  });

  it('processing子は取消要求を一度だけ保存しcommit fenceの完了を次周期まで待つ',async()=>{
    const repository=new FakeBatchRepository([target('entity_base',entityId,entityId,'ミオ','entity-rev')]);
    const child=new FakeChildQuotes(repository);const cancelJob=vi.fn(async(_user:string,jobId:string)=>{
      const job=repository.jobs.get(jobId)!;job.cancelRequestedAt=new Date();return{status:'processing'};
    });
    const service=buildService(repository,child,new NoopConfirmation(),undefined,{cancelJob});
    const quote=await service.issue(userId,{work_id:workId,kind:'character_references',selection:'missing_only',render_style:'color'});
    const accepted=await service.accept(userId,quote.batch_id,{request_key:'93939393-9393-4393-8393-939393939393',auto_confirm:true});
    const jobId=accepted.items[0]!.job_id!;repository.jobs.get(jobId)!.status='processing';await service.cancel(userId,quote.batch_id);

    await service.reconcile({limit:2});await service.reconcile({limit:2});

    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect((await service.get(userId,quote.batch_id)).items[0]?.status).toBe('active');
  });
});

function buildService(repository:FakeBatchRepository,child=new FakeChildQuotes(repository),confirmation:GenerationBatchConfirmationPort=new NoopConfirmation(),dispatcher?:GenerationQuoteDispatcherPort,
  jobCancellation?:{cancelJob(userId:string,jobId:string,organizationId?:string|null):Promise<{status:string}>}):GenerationBatchService{
  return new GenerationBatchService({database:new FakeDatabase(repository),repository,resolver:new FakeResolver(),confirmation,enabled:true,
    requiredImageModel:GPT_IMAGE_25_SUNBURST,childQuoteServiceFactory:()=>child,...(dispatcher===undefined?{}:{dispatcher}),
    ...(jobCancellation===undefined?{}:{jobCancellation})});
}
function target(kind:GenerationBatchTarget['kind'],targetId:string,entity:string|null,label:string,revision:string):GenerationBatchTarget{return{kind,targetId,entityId:entity,label,revision,ready:true,
  definition:kind==='entity_state'?{state_revision:revision,name:'負傷',description:'頬に傷'}:{[kind==='page'?'page_revision':'entity_revision']:revision}};}

class FakeDatabase implements DatabaseClient,TransactionRunner{
  public constructor(private readonly repository:FakeBatchRepository){}
  public async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>{return work(this);}
  public async query<T extends import('pg').QueryResultRow>(text:string):Promise<import('pg').QueryResult<T>>{
    if(text.includes('SELECT user_id,organization_id FROM generation_batches')){
      const batch=this.repository.onlyBatch();return{rows:batch?[{user_id:batch.userId,organization_id:batch.organizationId} as unknown as T]:[],rowCount:batch?1:0,command:'SELECT',oid:0,fields:[]};
    }
    return{rows:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
  }
}
class FakeResolver implements GenerationQuotePlanResolver{
  public async prepare():Promise<null>{return null;}
  public async resolve(_client:DatabaseClient,_user:string,_org:string|null,request:GenerationQuoteRequest):Promise<GenerationQuotePlan>{
    const targetId=request.targetId!;const page=request.operation==='page_generate';return{operation:request.operation,targetId,workId,referenceCount:page?1:0,inputRevision:`rev-${targetId}`,
      imageModel:GPT_IMAGE_25_SUNBURST,providerModelId:GPT_IMAGE_25_SUNBURST_SNAPSHOT,quality:'medium',renderStyle:page?request.renderStyle??'color':'color',
      amountCredits:page?3:1,pricingVersion:'lyra-existing-credits-v1',generationMode:page?'standard':null,jobParams:{},
      snapshot:page?{kind:'page',prompt:{workId,draftPrompt:'',compilerBrief:'',inputSnapshot:{pageId:targetId,requestKind:'initial',generationMode:'standard',panelCount:1,panels:[],inputImages:[],references:[]}},layoutConfig:{}}
        :{kind:'entity',entity:{entityId:targetId,workId,userId,entityType:'character',name:'ミオ',freeDescription:null,structuredFields:{},promptSupplement:null,status:'draft',referenceSet:{entityId:targetId,images:[],primaryRefId:null,status:'empty',updatedAt:new Date()}},state:null,sourceS3Key:null}};
  }
  public async persistAdmission():Promise<void>{}
}
class NoopConfirmation implements GenerationBatchConfirmationPort{public async confirm():Promise<'confirmed'>{return'confirmed';}}

class FakeChildQuotes{
  public issueCount=0;public acceptCount=0;public capacityFailure=false;public priceDelta=0;
  public constructor(private readonly repository:FakeBatchRepository){}
  public async issue(userIdValue:string,request:GenerationQuoteRequest,organizationId:string|null):Promise<{quote:GenerationQuote;quoteToken:string}>{
    this.issueCount+=1;if(this.capacityFailure)throw new ConflictError('Generation queue is temporarily full');
    const item=this.repository.itemByTarget(request.targetId!);const plan=planFromItem(item,this.priceDelta);
    return{quote:{id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(this.issueCount).padStart(12,'0')}`,userId:userIdValue,organizationId,request,plan,expiresAt:new Date(Date.now()+60_000),acceptedJobId:null,requestKey:null,acceptedAt:null},quoteToken:'token'};
  }
  public async accept(userIdValue:string,quoteId:string,_token:string,requestKey:string,organizationId:string|null):Promise<GenerationQuoteReceipt>{
    this.acceptCount+=1;const item=this.repository.itemById(requestKey);const jobId=`bbbbbbbb-bbbb-4bbb-8bbb-${String(this.acceptCount).padStart(12,'0')}`;this.repository.jobs.set(jobId,{id:jobId,status:'queued',params:{},result:{}});
    const plan=planFromItem(item,0);const quote:GenerationQuote={id:quoteId,userId:userIdValue,organizationId,request:item.approvedRequest as unknown as GenerationQuoteRequest,plan,expiresAt:new Date(Date.now()+60_000),acceptedJobId:jobId,requestKey,acceptedAt:new Date()};
    return{quote,jobStatus:'queued',chargedCredits:item.amountCredits,refundedCredits:0};
  }
}
function planFromItem(item:GenerationBatchItemRecord,delta:number):GenerationQuotePlan{return{operation:item.operation,targetId:item.targetId,workId,inputRevision:item.inputRevision,imageModel:item.imageModel,
  providerModelId:item.providerModelId,quality:'medium',renderStyle:item.kind==='page'?item.renderStyle:'color',referenceCount:0,amountCredits:item.amountCredits+delta,
  pricingVersion:item.pricingVersion,generationMode:item.kind==='page'?'standard':null,jobParams:{},snapshot:item.kind==='page'?{kind:'page',prompt:{workId,draftPrompt:'',compilerBrief:'',inputSnapshot:{pageId:item.targetId,requestKind:'initial',generationMode:'standard',panelCount:1,panels:[],inputImages:[],references:[]}},layoutConfig:{}}
    :{kind:'entity',entity:{entityId:item.entityId!,workId,userId,entityType:'character',name:'ミオ',freeDescription:null,structuredFields:{},promptSupplement:null,status:'draft',referenceSet:{entityId:item.entityId!,images:[],primaryRefId:null,status:'empty',updatedAt:new Date()}},state:null,sourceS3Key:null}};}

class FakeBatchRepository implements GenerationBatchRepositoryPort{
  private batch:GenerationBatchRecord|null=null;private items:GenerationBatchItemRecord[]=[];public jobs=new Map<string,GenerationBatchJobSnapshot>();
  public constructor(private readonly targets:GenerationBatchTarget[]){}
  public async discoverTargets():Promise<GenerationBatchTarget[]>{return this.targets;}
  public async create(_client:DatabaseClient,batch:GenerationBatchRecord,items:GenerationBatchApprovedItem[]):Promise<void>{this.batch=batch;this.items=items.map(item=>({...item,batchId:batch.id,status:'pending',childQuoteId:null,jobId:null,confirmation:null,blocker:null}));}
  public async find():Promise<{batch:GenerationBatchRecord;items:GenerationBatchItemRecord[]}>{if(!this.batch)throw new Error('missing');return{batch:this.batch,items:this.items};}
  public async list():Promise<Array<{batch:GenerationBatchRecord;items:GenerationBatchItemRecord[]}>>{return this.batch?[{batch:this.batch,items:this.items}]:[];}
  public async accept(_client:DatabaseClient,_id:string,key:string):Promise<void>{if(!this.batch)throw new Error('missing');this.batch={...this.batch,status:'running',autoConfirm:true,requestKey:key,acceptedAt:new Date()};}
  public async resume():Promise<void>{if(!this.batch||this.batch.status!=='paused')throw new ConflictError('Only paused');this.batch={...this.batch,status:'running',blockers:[]};}
  public async requestCancel():Promise<void>{if(this.batch){this.batch={...this.batch,status:'cancelled'};for(const item of this.items)if(item.status==='pending')item.status='cancelled';}}
  public async updateBatch(_client:DatabaseClient,_id:string,status:GenerationBatchStatus,blockers:GenerationBatchBlocker[]=[]):Promise<void>{if(this.batch)this.batch={...this.batch,status,blockers};}
  public async updateItem(_client:DatabaseClient,id:string,input:{status:GenerationBatchItemRecord['status'];childQuoteId?:string|null;jobId?:string|null;confirmation?:Record<string,unknown>|null;blocker?:GenerationBatchBlocker|null}):Promise<void>{
    const item=this.itemById(id);Object.assign(item,{status:input.status},input.childQuoteId===undefined?{}:{childQuoteId:input.childQuoteId},input.jobId===undefined?{}:{jobId:input.jobId},input.blocker===undefined?{}:{blocker:input.blocker});
  }
  public async findJob(_client:DatabaseClient,id:string):Promise<GenerationBatchJobSnapshot|null>{return this.jobs.get(id)??null;}
  public async findRunnableBatchIds():Promise<string[]>{return this.batch?.status==='running'?[this.batch.id]:[];}
  public async findCancelledBatchIdsWithActiveChildren():Promise<string[]>{return this.batch?.status==='cancelled'&&this.items.some(item=>item.status==='active'&&item.jobId!==null)?[this.batch.id]:[];}
  public async touchBatch():Promise<void>{}
  public onlyBatch():GenerationBatchRecord|null{return this.batch;}
  public itemByTarget(id:string):GenerationBatchItemRecord{const item=this.items.find(candidate=>candidate.targetId===id);if(!item)throw new Error('item missing');return item;}
  public itemById(id:string):GenerationBatchItemRecord{const item=this.items.find(candidate=>candidate.id===id);if(!item)throw new Error('item missing');return item;}
}
