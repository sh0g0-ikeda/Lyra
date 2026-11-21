import { ConflictError, ConfigurationError } from '../../../domain/errors/index.js';
import type { GenerationBatchItemRecord, GenerationBatchRecord } from '../../../domain/types/generationBatch.js';
import type { ConfirmedEntityStateReference } from '../../../domain/types/entityStateReference.js';
import type { EntityImageStoragePort } from '../../../infrastructure/aws/S3EntityImageStorage.js';
import type { GenerationBatchConfirmationRepositoryPort } from '../../../repositories/GenerationBatchConfirmationRepository.js';
import type { GenerationBatchJobSnapshot } from '../../../repositories/GenerationBatchRepository.js';

export interface BatchStateReferenceConfirmationPort {
  confirmReference(userId:string,entityId:string,stateId:string,input:{jobId:string;candidateS3Key:string;expectedStateRevision:string},organizationId?:string|null):Promise<ConfirmedEntityStateReference>;
}
export interface GenerationBatchConfirmationPort {
  confirm(batch:GenerationBatchRecord,item:GenerationBatchItemRecord,job:GenerationBatchJobSnapshot):Promise<'confirmed'|'in_progress'>;
}

/** Base references use a stable item-owned destination and a durable pre-copy
 * intent. State references delegate to the existing fenced confirmation
 * contract so an uncertain storage result can never cause a second copy. */
export class GenerationBatchConfirmationService implements GenerationBatchConfirmationPort {
  public constructor(
    private readonly repository:GenerationBatchConfirmationRepositoryPort,
    private readonly imageStorage:EntityImageStoragePort,
    private readonly stateConfirmation:BatchStateReferenceConfirmationPort,
  ){}

  public async confirm(batch:GenerationBatchRecord,item:GenerationBatchItemRecord,job:GenerationBatchJobSnapshot):Promise<'confirmed'|'in_progress'>{
    if(item.kind==='page')return 'confirmed';
    if(item.kind==='entity_base'){
      const intent=await this.repository.prepareBase(item.id);
      if(!intent.newlyPrepared){
        if(intent.committed)return 'confirmed';
        if(intent.inProgress)return 'in_progress';
        throw new ConflictError('Base reference copy outcome requires review; no new copy was started');
      }
      let stored:{s3Key:string;cdnUrl:string};
      try{
        stored=await this.imageStorage.finalizeReferenceImage({userId:intent.userId,entityId:intent.entityId,refId:intent.refId,sourceS3Key:intent.sourceS3Key});
      }catch{
        throw new ConflictError('Base reference copy outcome requires review; no new copy was started');
      }
      await this.repository.commitBase(intent,stored);
      return 'confirmed';
    }
    if(item.entityId===null)throw new ConfigurationError('State batch item has no entity');
    const claim=await this.repository.prepareState(item.id);
    if(!claim.newlyPrepared){
      if(claim.committed)return 'confirmed';
      if(claim.inProgress)return 'in_progress';
      throw new ConflictError('State reference confirmation outcome requires review');
    }
    const source=firstCandidate(job.result);
    await this.stateConfirmation.confirmReference(batch.userId,item.entityId,item.targetId,{
      jobId:job.id,candidateS3Key:source,expectedStateRevision:readString(item.approvedInput.state_revision,'state_revision'),
    },batch.organizationId);
    await this.repository.commitState(claim);
    return 'confirmed';
  }
}
function firstCandidate(result:Record<string,unknown>):string{const candidates=result.candidates;if(!Array.isArray(candidates)||candidates.length===0)throw new ConflictError('Generated reference candidate is missing');
  const first=candidates[0];if(typeof first!=='object'||first===null)throw new ConflictError('Generated reference candidate is invalid');return readString((first as Record<string,unknown>).s3_key,'candidate s3_key');}
function readString(value:unknown,name:string):string{if(typeof value!=='string'||value.length===0)throw new ConflictError(`${name} is unavailable`);return value;}
