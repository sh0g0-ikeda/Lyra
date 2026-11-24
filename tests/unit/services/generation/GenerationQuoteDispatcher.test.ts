import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../../src/lib/db.js';
import { GenerationQuoteDispatcher } from '../../../../src/services/generation/GenerationQuoteDispatcher.js';

function result<T extends QueryResultRow>(rows:T[]):QueryResult<T>{return{rows,rowCount:rows.length,command:'SELECT',oid:0,fields:[]};}

describe('GenerationQuoteDispatcher',()=>{
  it('batch無効時は055テーブルを一切参照せず既存quoteを配信する',async()=>{
    const sql:string[]=[];const queue=vi.fn(async()=>({messageId:'message-1'}));
    const database=fakeDatabase(async(text)=>{
      sql.push(text);
      if(text.includes('WITH candidate'))return result([{id:'quote-1',job_id:'job-1',job_type:'entity_generate',lease_token:'lease-1'}]);
      if(text.includes('SELECT EXISTS'))return result([{allowed:true}]);
      return result([{accepted_job_id:'job-1'}]);
    });

    await new GenerationQuoteDispatcher(database,{enqueueJob:queue}).dispatchQuote('quote-1');

    expect(queue).toHaveBeenCalledWith({jobId:'job-1',jobType:'entity_generate'});
    expect(sql.join('\n')).not.toContain('generation_batch_items');
    expect(sql.join('\n')).not.toContain('generation_batches');
  });

  it('batch有効時はcancelled親の子quoteをclaimせずqueueへ送らない',async()=>{
    const sql:string[]=[];const queue=vi.fn(async()=>({messageId:'must-not-send'}));
    const database=fakeDatabase(async(text)=>{sql.push(text);return result([]);});

    await new GenerationQuoteDispatcher(database,{enqueueJob:queue},{batchCancellationFenceEnabled:true}).dispatchQuote('quote-1');

    expect(queue).not.toHaveBeenCalled();
    expect(sql[0]).toContain('generation_batch_items');
    expect(sql[0]).toContain("batch.status='cancelled'");
  });

  it('batch子は親行の共有lockと最終job fenceを保持したtransaction内で送信する',async()=>{
    const sql:string[]=[];const order:string[]=[];
    const queue={enqueueJob:vi.fn(async(_input:unknown,options?:{deferWake?:boolean})=>{expect(options?.deferWake).toBe(true);order.push('send');return{messageId:'message-1'};}),
      wakeWorker:vi.fn(async()=>{order.push('wake');})};
    const database=fakeDatabase(async(text)=>{
      sql.push(text);
      if(text.includes('WITH candidate'))return result([{id:'quote-1',job_id:'job-1',job_type:'entity_generate',lease_token:'lease-1'}]);
      if(text.includes('SELECT batch.status'))return result([{status:'running'}]);
      if(text.includes('SELECT EXISTS'))return result([{allowed:true}]);
      if(text.includes('UPDATE generation_quotes'))order.push('finish');
      return result([{accepted_job_id:'job-1'}]);
    });

    await new GenerationQuoteDispatcher(database,queue,{batchCancellationFenceEnabled:true}).dispatchQuote('quote-1');

    expect(queue.enqueueJob).toHaveBeenCalledOnce();
    expect(sql.join('\n')).toContain('FOR SHARE OF batch');
    expect(order).toEqual(['send','finish','wake']);
  });

  it('queue失敗ログへ例外本文やURLを含めずstageとcodeだけを残す',async()=>{
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>undefined);
    const database=fakeDatabase(async(text)=>{
      if(text.includes('WITH candidate'))return result([{id:'quote-1',job_id:'job-1',job_type:'entity_generate',lease_token:'lease-1'}]);
      if(text.includes('SELECT EXISTS'))return result([{allowed:true}]);
      return result([{accepted_job_id:'job-1'}]);
    });
    const queue={enqueueJob:async():Promise<never>=>{throw new Error('secret https://private.invalid/body');}};

    await new GenerationQuoteDispatcher(database,queue).dispatchQuote('quote-1');

    expect(warning).toHaveBeenCalledWith('[generation-quote-dispatch] stage=enqueue code=DISPATCH_ATTEMPT_FAILED');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private.invalid');
    warning.mockRestore();
  });
});

function fakeDatabase(query:(text:string)=>Promise<QueryResult<QueryResultRow>>):DatabaseClient&TransactionRunner{
  const database={
    query:<T extends QueryResultRow>(text:string):Promise<QueryResult<T>>=>query(text) as Promise<QueryResult<T>>,
    transaction:<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>=>work(database),
  } satisfies DatabaseClient&TransactionRunner;
  return database;
}
