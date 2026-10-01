import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { EntityImportAnalysis } from '../domain/types/entityReference.js';
import { PostgresGenerationJobRepository } from './GenerationJobRepository.js';
import { PostgresGenerationQuoteRepository } from './GenerationQuoteRepository.js';
import { PostgresCreditRepository } from './CreditRepository.js';
import { PostgresOrganizationRepository } from './OrganizationRepository.js';
import { bindTransaction } from './TransactionBoundDatabase.js';
import { CreditService } from '../services/credit/CreditService.js';
import { OrganizationService } from '../services/organization/OrganizationService.js';
import { lockMobilePushTokenRegistryForTerminalSettlement, enqueueTerminalGenerationJobNotificationAfterRegistryLock } from './PushNotificationOutboxRepository.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';

const IMPORT_STALE_AFTER_MS=20*60*1000;
const IMPORT_PROGRESS_SQL="COALESCE(NULLIF(j.result->>'import_heartbeat_at','')::timestamptz,j.started_at,j.created_at)";

export class PostgresQuotedImportExecutionRepository {
  public constructor(private readonly database:DatabaseClient & TransactionRunner){}
  public async claim(jobId:string):Promise<GenerationJob|null>{
    const quote=await new PostgresGenerationQuoteRepository(this.database).findAcceptedJob(jobId);
    const updated=await this.database.query(`UPDATE generation_jobs SET status='processing',started_at=NOW(),error_message=NULL
      WHERE id=$1::uuid AND job_type='entity_import_analysis' AND status='queued' AND cancel_requested_at IS NULL RETURNING id`,[jobId]);
    if(!updated.rows.length) return null;
    return new PostgresGenerationJobRepository(this.database).findByIdAndUserId(jobId,quote.userId,quote.organizationId);
  }
  public async checkpointCopy(jobId:string,s3Key:string):Promise<boolean>{
    const result=await this.database.query(`UPDATE generation_jobs SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('import_copy_intent',$2::text)
      WHERE id=$1::uuid AND job_type='entity_import_analysis' AND status='processing' AND cancel_requested_at IS NULL RETURNING id`,[jobId,s3Key]);
    return result.rows.length===1;
  }
  public async touchProgress(jobId:string):Promise<void>{
    await this.database.query(`UPDATE generation_jobs SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('import_heartbeat_at',NOW())
      WHERE id=$1::uuid AND job_type='entity_import_analysis' AND status='processing' AND cancel_requested_at IS NULL`,[jobId]);
  }
  public async complete(job:GenerationJob,analysis:EntityImportAnalysis,entityId:string|null):Promise<boolean>{
    return this.database.transaction(async(client)=>{
      await lockMobilePushTokenRegistryForTerminalSettlement(client);
      const result=await client.query<{id:string;user_id:string;organization_id:string|null;cancel_requested_at:Date|null;cancelled_at:Date|null;retry_count:number}>(
        `UPDATE generation_jobs SET status='completed',completed_at=NOW(),result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('import_analysis',$2::jsonb)
         WHERE id=$1::uuid AND job_type='entity_import_analysis' AND status='processing' AND cancel_requested_at IS NULL AND commit_started_at IS NOT NULL RETURNING *`,
        [job.id,JSON.stringify({suggested_fields:analysis.suggestedFields,prompt_supplement:analysis.promptSupplement,tmp_image_s3_key:analysis.tmpImageS3Key,tmp_image_cdn_url:analysis.tmpImageCdnUrl,entity_id:entityId})],
      );
      if(!result.rows[0]) return false;
      await enqueueTerminalGenerationJobNotificationAfterRegistryLock(client,result.rows[0],'completed');
      return true;
    });
  }
  public async failAndRefund(job:Pick<GenerationJob,'id'|'userId'|'organizationId'|'creditCost'>,message:string,staleBefore?:Date):Promise<void>{
    await this.database.transaction(async(client)=>{
      const bound=bindTransaction(client);const jobs=new PostgresGenerationJobRepository(bound);
      // Cancellation also locks the balance before the job. Preserve that order.
      if(job.organizationId) await new PostgresOrganizationRepository(bound,bound).getCreditBalanceForUpdate(job.organizationId,client);
      else await new PostgresCreditRepository(bound,bound).getBalanceForUpdate(job.userId,client);
      await lockMobilePushTokenRegistryForTerminalSettlement(client);
      if(staleBefore!==undefined){
        const current=await client.query<{status:string;progress_at:Date}>(`SELECT j.status,${IMPORT_PROGRESS_SQL} AS progress_at FROM generation_jobs j WHERE j.id=$1::uuid FOR UPDATE`,[job.id]);
        const row=current.rows[0];
        if(row===undefined || (row.status!=='failed' && row.progress_at>=staleBefore)) return;
      }
      await jobs.markFailed(job.id,sanitizePersistedErrorMessage(message,'Import analysis failed'));
      const status=await client.query<{status:string}>('SELECT status FROM generation_jobs WHERE id=$1::uuid FOR UPDATE',[job.id]);
      if(status.rows[0]?.status!=='failed') return;
      if(job.organizationId){
        await new OrganizationService(new PostgresOrganizationRepository(bound,bound)).refundCredits({organizationId:job.organizationId,actorUserId:job.userId,amount:job.creditCost,description:'Refund for failed quoted import analysis',jobId:job.id});
      }else{
        await new CreditService(new PostgresCreditRepository(bound,bound)).refundCredits({userId:job.userId,amount:job.creditCost,description:'Refund for failed quoted import analysis',jobId:job.id});
      }
    });
  }
  public async recoverExpired(limit=20,jobId:string|null=null):Promise<number>{
    const staleBefore=new Date(Date.now()-IMPORT_STALE_AFTER_MS);
    const result=await this.database.query<{id:string;user_id:string;organization_id:string|null}>(
      `SELECT j.id,j.user_id,j.organization_id FROM generation_jobs j WHERE j.job_type='entity_import_analysis' AND ($2::uuid IS NULL OR j.id=$2::uuid) AND (
        (j.status IN ('queued','processing') AND ${IMPORT_PROGRESS_SQL}<$3)
        OR (j.status='failed' AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.job_id=j.id AND l.type='refund'))
       ) ORDER BY j.created_at LIMIT $1`,[Math.max(1,Math.min(100,limit)),jobId,staleBefore],
    );
    let count=0;
    for(const row of result.rows){
      const jobs=new PostgresGenerationJobRepository(this.database);
      if(await jobs.finalizeCancellation(row.id)){count++;continue;}
      const quote=await new PostgresGenerationQuoteRepository(this.database).findAcceptedJob(row.id);
      // A system settlement uses the accepted actor even if organization membership was revoked.
      const job={id:row.id,userId:row.user_id,organizationId:row.organization_id,creditCost:quote.plan.amountCredits};
      await this.failAndRefund(job,'Import analysis worker stopped or its result is unknown; reconcile this receipt before retrying',staleBefore);
      count++;
    }
    return count;
  }
}
