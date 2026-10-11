import {S3Client} from '@aws-sdk/client-s3';
import {ConfigurationError} from '../../domain/errors/index.js';
import type {DatabaseClient,TransactionRunner} from '../../lib/db.js';
import type {Env} from '../../lib/env.js';
import {PostgresWorkDeletionRepository} from '../../repositories/WorkDeletionRepository.js';
import {WorkDeletionService,type WorkStateReferenceErasurePort} from '../../services/work/WorkDeletionService.js';
import {S3WorkAssetErasure} from '../aws/S3WorkAssetErasure.js';
export interface WorkDeletionRuntime {service:WorkDeletionService;intervalMs:number;batchSize:number}
/** Admission is independent of recovery. Turning the feature off never abandons
 * a previously accepted durable request. An unconfigured store fails closed. */
export function createWorkDeletionRuntime(environment:Env,database:DatabaseClient&TransactionRunner,
 stateReferences?:Partial<WorkStateReferenceErasurePort>,profile:'canonical'|'legacy_2debe_v1'|'production44_expanded_pg18_v1'=environment.LYRA_PERSISTENCE_PROFILE):WorkDeletionRuntime{
 const bucket=environment.S3_BUCKET_IMAGES;
 const storage=bucket===undefined||environment.LOCAL_IMAGE_FALLBACK_ENABLED
  ?{erase:async():Promise<void>=>{throw new ConfigurationError('Work deletion storage unavailable');}}
  :new S3WorkAssetErasure(new S3Client({region:environment.AWS_REGION,maxAttempts:2}),bucket);
 if(environment.WORK_DELETION_ENABLED&&(bucket===undefined||environment.LOCAL_IMAGE_FALLBACK_ENABLED))
  throw new ConfigurationError('Permanent work deletion requires durable S3 storage');
 return {service:new WorkDeletionService(new PostgresWorkDeletionRepository(database,profile),storage,
  stateReferences?.fenceWorkReferences===undefined?undefined:{fenceWorkReferences:request=>stateReferences.fenceWorkReferences!(request)}),
  intervalMs:environment.WORK_DELETION_RECOVERY_INTERVAL_MS,batchSize:environment.WORK_DELETION_RECOVERY_BATCH_SIZE};
}
export function startWorkDeletionRecovery(runtime:WorkDeletionRuntime):()=>Promise<void>{
 let stopped=false;let active:Promise<void>|null=null;
 const run=():void=>{
  if(stopped||active!==null)return;
  active=(async()=>{try{await runtime.service.recoverPendingRequests(runtime.batchSize);}
   catch{console.error('Work deletion recovery failed; durable requests retained');}})().finally(()=>{active=null;});
 };
 run();const timer=setInterval(run,runtime.intervalMs);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);await active;};
}
