import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresGenerationQuoteRepository } from '../../repositories/GenerationQuoteRepository.js';
import type { GenerationJobType } from '../../domain/types/job.js';

export interface QuotedJobQueuePort {
  enqueueJob(input:{jobId:string;jobType:GenerationJobType}):Promise<{messageId:string|null}>;
}
export class GenerationQuoteDispatcher {
  private readonly repository:PostgresGenerationQuoteRepository;
  public constructor(database:DatabaseClient & TransactionRunner,private readonly queue:QuotedJobQueuePort){this.repository=new PostgresGenerationQuoteRepository(database);}
  public async dispatchQuote(quoteId:string):Promise<void>{await this.dispatchOne(quoteId);}
  public async dispatchPending(limit=20):Promise<number>{
    let count=0;
    for(let index=0;index<Math.max(0,Math.min(100,limit));index++){if(!await this.dispatchOne(null)) break;count++;}
    return count;
  }
  private async dispatchOne(quoteId:string|null):Promise<boolean>{
    const lease=await this.repository.claimDispatch(quoteId);
    if(!lease) return false;
    try{
      const result=await this.queue.enqueueJob({jobId:lease.job_id,jobType:lease.job_type});
      if(result.messageId===null) throw new Error('Queue acknowledgement is unknown');
      await this.repository.finishDispatch(lease,true,result.messageId);
    }catch{
      // An unknown queue receipt is safe to redeliver only with the same job ID.
      await this.repository.finishDispatch(lease,false).catch(()=>undefined);
    }
    return true;
  }
}
