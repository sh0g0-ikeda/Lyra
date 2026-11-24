import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresGenerationQuoteRepository, type QuoteDispatchLease } from '../../repositories/GenerationQuoteRepository.js';
import type { GenerationJobType } from '../../domain/types/job.js';

export interface QuotedJobQueuePort {
  enqueueJob(input:{jobId:string;jobType:GenerationJobType},options?:{deferWake?:boolean}):Promise<{messageId:string|null}>;
  wakeWorker?():Promise<void>;
}
export interface GenerationQuoteDispatcherOptions {
  batchCancellationFenceEnabled?: boolean;
}
export class GenerationQuoteDispatcher {
  private readonly repository:PostgresGenerationQuoteRepository;
  public constructor(database:DatabaseClient & TransactionRunner,private readonly queue:QuotedJobQueuePort,
    private readonly options:GenerationQuoteDispatcherOptions={}){this.repository=new PostgresGenerationQuoteRepository(database);}
  public async dispatchQuote(quoteId:string):Promise<void>{await this.dispatchOne(quoteId);}
  public async dispatchPending(limit=20):Promise<number>{
    let count=0;
    for(let index=0;index<Math.max(0,Math.min(100,limit));index++){if(!await this.dispatchOne(null)) break;count++;}
    return count;
  }
  private async dispatchOne(quoteId:string|null):Promise<boolean>{
    let lease:QuoteDispatchLease|null;
    try{lease=await this.repository.claimDispatch(quoteId,this.options.batchCancellationFenceEnabled===true);}
    catch{warnDispatch('claim','DISPATCH_CLAIM_FAILED');return false;}
    if(!lease) return false;
    let stage:'fence'|'enqueue'|'commit'='fence';
    try{
      let result:{messageId:string|null}|null;
      if(this.options.batchCancellationFenceEnabled===true){
        stage='enqueue';
        result=await this.repository.dispatchWithBatchFence(lease,()=>this.queue.enqueueJob({jobId:lease.job_id,jobType:lease.job_type},{deferWake:true}));
      }else{
        const allowed=await this.repository.isDispatchAllowed(lease,false);
        if(!allowed)result=null;
        else{stage='enqueue';result=await this.queue.enqueueJob({jobId:lease.job_id,jobType:lease.job_type});}
      }
      if(result===null){
        await this.repository.finishDispatch(lease,false);
        warnDispatch('fence','DISPATCH_FENCED');
        return true;
      }
      if(result.messageId===null) throw new Error('Queue acknowledgement is unknown');
      stage='commit';
      await this.repository.finishDispatch(lease,true,result.messageId);
      if(this.options.batchCancellationFenceEnabled===true){
        try{await this.queue.wakeWorker?.();}
        catch{warnDispatch('wake','WORKER_WAKE_FAILED');}
      }
    }catch{
      // An unknown queue receipt is safe to redeliver only with the same job ID.
      warnDispatch(stage,'DISPATCH_ATTEMPT_FAILED');
      await this.repository.finishDispatch(lease,false).catch(()=>warnDispatch('release','DISPATCH_RELEASE_FAILED'));
    }
    return true;
  }
}
function warnDispatch(stage:'claim'|'fence'|'enqueue'|'commit'|'release'|'wake',code:string):void{
  // Never include provider errors, authored inputs, queue bodies, URLs or credentials.
  console.warn(`[generation-quote-dispatch] stage=${stage} code=${code}`);
}
