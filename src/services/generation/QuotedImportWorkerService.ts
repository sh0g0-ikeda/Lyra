import { createHash } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import { ENTITY_IMPORT_ANALYSIS_MODEL } from '../../domain/constants/entityReference.js';
import { extensionForEntityReferenceUploadMimeType, imageDataMatchesEntityReferenceUploadMimeType } from '../../domain/constants/entityReferenceUpload.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { parseStructuredFields } from '../../lib/validators/entity.schema.js';
import type { EntityImportAnalyzerPort } from '../../infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import type { EntityReferenceUploadStoragePort } from '../entity/EntityReferenceUploadStorage.js';
import { PostgresGenerationQuoteRepository } from '../../repositories/GenerationQuoteRepository.js';
import { PostgresGenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { PostgresEntityRepository } from '../../repositories/EntityRepository.js';
import { PostgresQuotedImportExecutionRepository } from '../../repositories/QuotedImportExecutionRepository.js';
import { assertQuotedJobMatches } from './QuotedGenerationInputs.js';
import { ensureAllowedReferenceSourceKey } from '../entity/EntityReferenceSourceKeyPolicy.js';

export class QuotedImportWorkerService {
  public constructor(private readonly database:DatabaseClient & TransactionRunner,private readonly storage:EntityReferenceUploadStoragePort,
    private readonly analyzer:EntityImportAnalyzerPort,private readonly enabled=true){}
  public async processJob(jobId:string):Promise<{status:'processed'|'skipped';jobStatus?:'completed'|'failed'|'cancelled'}>{
    if(!this.enabled) throw new ConfigurationError('Import analysis worker is temporarily disabled');
    const execution=new PostgresQuotedImportExecutionRepository(this.database);
    const jobs=new PostgresGenerationJobRepository(this.database);
    const job=await execution.claim(jobId);
    if(!job) return {status:'skipped'};
    const heartbeat=setInterval(()=>{void execution.touchProgress(jobId).catch(()=>undefined);},60_000);
    try{
      await execution.touchProgress(jobId);
      const quote=await new PostgresGenerationQuoteRepository(this.database).findAcceptedJob(jobId);
      assertQuotedJobMatches(job,quote,ENTITY_IMPORT_ANALYSIS_MODEL);
      const snapshot=quote.plan.snapshot;
      if(snapshot.kind!=='import') throw new ConfigurationError('Import snapshot is invalid');
      const source=snapshot.source;
      if(source.entityId!==null){
        const entity=await new PostgresEntityRepository(this.database).findReferenceContextByIdAndUserId(source.entityId,job.userId,job.organizationId ?? null);
        if(entity===null || entity.entityType!==snapshot.entityType) throw new ConfigurationError('Quoted import entity changed before execution');
      }
      ensureAllowedReferenceSourceKey(source.s3Key,job.userId,source.entityId ?? '');
      const image=await this.storage.loadUploadedImage({s3Key:source.s3Key,mimeType:source.mimeType,sizeBytes:source.sizeBytes});
      if(!image || image.eTag!==source.eTag || image.imageData.length!==source.sizeBytes || image.mimeType!==source.mimeType
        || createHash('sha256').update(image.imageData).digest('hex')!==source.sha256
        || !imageDataMatchesEntityReferenceUploadMimeType(image.imageData,image.mimeType)) throw new ConfigurationError('Quoted import image changed');
      if(await jobs.finalizeCancellation(jobId)) return {status:'processed',jobStatus:'cancelled'};
      const destination=`tmp/${job.userId}/entities/imports/${job.id}.${extensionForEntityReferenceUploadMimeType(source.mimeType)}`;
      if(!await execution.checkpointCopy(jobId,destination)){
        await jobs.finalizeCancellation(jobId);return {status:'skipped'};
      }
      const stabilized=await this.storage.stabilizeUploadedImage({sourceS3Key:source.s3Key,destinationS3Key:destination,mimeType:source.mimeType,eTag:source.eTag});
      if(stabilized.s3Key!==destination) throw new ConfigurationError('Import storage returned an unexpected destination');
      if(await jobs.finalizeCancellation(jobId)) return {status:'processed',jobStatus:'cancelled'};
      const analysis=await this.analyzer.analyze({entityType:snapshot.entityType,dataUrl:`data:${image.mimeType};base64,${image.imageData.toString('base64')}`});
      if(await jobs.finalizeCancellation(jobId)) return {status:'processed',jobStatus:'cancelled'};
      if(!await jobs.beginCommit(jobId)) return {status:'skipped'};
      const completed=await execution.complete(job,{suggestedFields:parseStructuredFields(snapshot.entityType,analysis.suggestedFields),
        promptSupplement:analysis.promptSupplement.slice(0,2000),tmpImageS3Key:stabilized.s3Key,tmpImageCdnUrl:stabilized.cdnUrl},source.entityId);
      return completed ? {status:'processed',jobStatus:'completed'} : {status:'skipped'};
    }catch(error){
      if(await jobs.finalizeCancellation(jobId)) return {status:'processed',jobStatus:'cancelled'};
      await execution.failAndRefund(job,error instanceof Error ? error.message : 'Import analysis failed');
      return {status:'processed',jobStatus:'failed'};
    }finally{
      clearInterval(heartbeat);
    }
  }
}
