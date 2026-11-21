import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../src/domain/errors/index.js';
import type { GenerationBatchItemRecord, GenerationBatchRecord } from '../../../../src/domain/types/generationBatch.js';
import type { EntityImageStoragePort } from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';
import type { GenerationBatchBaseConfirmation, GenerationBatchConfirmationRepositoryPort } from '../../../../src/repositories/GenerationBatchConfirmationRepository.js';
import { GenerationBatchConfirmationService, type BatchStateReferenceConfirmationPort } from '../../../../src/services/generation/batch/GenerationBatchConfirmationService.js';

describe('GenerationBatchConfirmationService',()=>{
  it('別workerが処理中のbase copy intentを成功・失敗扱いせず再copyしない',async()=>{
    let copies=0;const repository:GenerationBatchConfirmationRepositoryPort={
      prepareBase:async()=>({...intent(),newlyPrepared:false,committed:false,inProgress:true}),commitBase:async()=>{throw new Error('commit must not run');},
      prepareState:async()=>stateClaim(),commitState:async()=>undefined,
    };
    const service=new GenerationBatchConfirmationService(repository,storage(async()=>{copies+=1;return{s3Key:'dest',cdnUrl:'cdn'};}),stateConfirmation());
    await expect(service.confirm(batch(),item('entity_base'),job())).resolves.toBe('in_progress');
    expect(copies).toBe(0);
  });

  it('storage結果不明のbase copyは同じintentを再送しない',async()=>{
    let calls=0;let prepared=false;const repository:GenerationBatchConfirmationRepositoryPort={
      prepareBase:async()=>{if(prepared)throw new ConflictError('outcome requires review');prepared=true;return{...intent(),newlyPrepared:true,committed:false};},
      commitBase:async()=>{throw new Error('commit must not run');},
      prepareState:async()=>stateClaim(),commitState:async()=>undefined,
    };
    const service=new GenerationBatchConfirmationService(repository,storage(async()=>{calls+=1;throw new Error('timeout');}),stateConfirmation());
    await expect(service.confirm(batch(),item('entity_base'),job())).rejects.toBeInstanceOf(ConflictError);
    await expect(service.confirm(batch(),item('entity_base'),job())).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toBe(1);
  });

  it('state確定は既存fenced confirmation契約へjob候補と承認revisionを渡す',async()=>{
    const received:unknown[]=[];const state=stateConfirmation(async(...args)=>{received.push(args);return{entityId:'entity',stateId:'state',stateRevision:'next',referenceImage:{refId:'ref',s3Key:'key',storageOwnerUserId:'user',imageModel:'gpt-image-2.5-sunburst',providerModelId:'gpt-image-2.5-sunburst-2026-09-08',provider:'openai',baseRefId:'base',createdAt:'now',inputFingerprint:'fingerprint'}};});
    const service=new GenerationBatchConfirmationService({prepareBase:async()=>intent(),commitBase:async()=>undefined,prepareState:async()=>stateClaim(),commitState:async()=>undefined},storage(async()=>({s3Key:'dest',cdnUrl:'cdn'})),state);
    await service.confirm(batch(),item('entity_state'),job());
    expect(received[0]).toEqual(['user','entity','state',{jobId:'job',candidateS3Key:'candidate.png',expectedStateRevision:'state-rev'},null]);
  });

  it('別workerが処理中のstate confirmationはfenced serviceを二重起動しない',async()=>{
    let confirms=0;const repository:GenerationBatchConfirmationRepositoryPort={prepareBase:async()=>intent(),commitBase:async()=>undefined,
      prepareState:async()=>({...stateClaim(),newlyPrepared:false,inProgress:true}),commitState:async()=>undefined};
    const service=new GenerationBatchConfirmationService(repository,storage(async()=>({s3Key:'dest',cdnUrl:'cdn'})),stateConfirmation(async()=>{confirms+=1;throw new Error('must not run');}));
    await expect(service.confirm(batch(),item('entity_state'),job())).resolves.toBe('in_progress');
    expect(confirms).toBe(0);
  });
});
function intent():GenerationBatchBaseConfirmation{return{itemId:'item',userId:'user',organizationId:null,entityId:'entity',jobId:'job',sourceS3Key:'candidate.png',refId:'ref',expectedRevision:'entity-rev',imageModel:'gpt-image-2.5-sunburst',providerModelId:'gpt-image-2.5-sunburst-2026-09-08',provider:'openai',newlyPrepared:true,committed:false,inProgress:false,claimToken:'claim'};}
function stateClaim(){return{itemId:'item',claimToken:'claim',newlyPrepared:true,committed:false,inProgress:false};}
function storage(finalize:EntityImageStoragePort['finalizeReferenceImage']):EntityImageStoragePort{return{finalizeReferenceImage:finalize} as unknown as EntityImageStoragePort;}
function stateConfirmation(confirm?:BatchStateReferenceConfirmationPort['confirmReference']):BatchStateReferenceConfirmationPort{return{confirmReference:confirm??(async()=>{throw new Error('state must not run');})};}
function batch():GenerationBatchRecord{return{id:'batch',userId:'user',organizationId:null,workId:'work',episodeId:null,kind:'character_references',status:'running',selection:'missing_only',renderStyle:'color',imageModel:'gpt-image-2.5-sunburst',pricingVersion:'v1',maximumCredits:1,autoConfirm:true,expiresAt:new Date(),acceptedAt:new Date(),requestKey:'request',blockers:[],createdAt:new Date(),updatedAt:new Date()};}
function item(kind:'entity_base'|'entity_state'):GenerationBatchItemRecord{return{id:'item',batchId:'batch',position:0,kind,label:'label',targetId:kind==='entity_state'?'state':'entity',entityId:'entity',dependsOnItemId:null,status:'active',approvedRequest:{},approvedInput:kind==='entity_state'?{state_revision:'state-rev'}:{entity_revision:'entity-rev'},inputRevision:'revision',operation:kind==='entity_state'?'entity_state_preview':'entity_preview',imageModel:'gpt-image-2.5-sunburst',providerModelId:'gpt-image-2.5-sunburst-2026-09-08',renderStyle:null,amountCredits:1,pricingVersion:'v1',childQuoteId:'quote',jobId:'job',confirmation:null,blocker:null};}
function job(){return{id:'job',status:'completed',params:{},result:{candidates:[{s3_key:'candidate.png'}]}};}
