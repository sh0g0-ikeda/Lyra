import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresGenerationBatchConfirmationRepository } from '../../src/repositories/GenerationBatchConfirmationRepository.js';
import { PostgresGenerationBatchRepository } from '../../src/repositories/GenerationBatchRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const url=process.env.DATABASE_URL;
function enabled():boolean{if(process.env.APP_ENV!=='test'||url===undefined)return false;const address=new URL(url);return['127.0.0.1','localhost','::1','[::1]'].includes(address.hostname)&&address.pathname==='/lyra_test';}
const suite=enabled()?describe:describe.skip;

suite('generation batch confirmation concurrency',()=>{
  const schema='batch_confirm_'+randomUUID().replaceAll('-','');let admin:Pool;let pool:Pool;let database:DatabaseClient&TransactionRunner;
  beforeAll(async()=>{admin=new Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`,max:4});
    database={query:(sql,values)=>pool.query(sql,values===undefined?undefined:[...values]),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>)=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await work({query:(sql,values)=>client.query(sql,values===undefined?undefined:[...values])});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
    await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database));
  },180_000);
  afterAll(async()=>{await pool?.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}});

  it('同じbase完了jobを2workerが見てもcopy leaseは1つだけでcancelとstale publishを拒否する',async()=>{
    const fixture=await seed('entity_base');const confirmations=new PostgresGenerationBatchConfirmationRepository(database);
    const first=await confirmations.prepareBase(fixture.itemId);const second=await confirmations.prepareBase(fixture.itemId);
    expect(first.newlyPrepared).toBe(true);expect(second.inProgress).toBe(true);expect(second.claimToken).toBe(first.claimToken);
    await expect(new PostgresGenerationBatchRepository().requestCancel(database,fixture.batchId)).rejects.toMatchObject({code:'CONFLICT'});
    await database.query("UPDATE entities SET name='同時編集',updated_at=updated_at+INTERVAL '1 second' WHERE id=$1::uuid",[fixture.entityId]);
    await expect(confirmations.commitBase(first,{s3Key:`saved/${fixture.userId}/entities/${fixture.entityId}/${fixture.itemId}.png`,cdnUrl:'https://example.invalid/ref.png'})).rejects.toMatchObject({code:'CONFLICT'});
    const refs=await database.query<{primary_ref_id:string|null}>('SELECT primary_ref_id FROM reference_sets WHERE entity_id=$1::uuid',[fixture.entityId]);
    expect(refs.rows[0]?.primary_ref_id).toBeNull();
  });

  it('state確定もbatch claim中は別workerとcancelを通さない',async()=>{
    const fixture=await seed('entity_state');const confirmations=new PostgresGenerationBatchConfirmationRepository(database);
    const first=await confirmations.prepareState(fixture.itemId);const second=await confirmations.prepareState(fixture.itemId);
    expect(first.newlyPrepared).toBe(true);expect(second.inProgress).toBe(true);expect(second.claimToken).toBe(first.claimToken);
    await expect(new PostgresGenerationBatchRepository().requestCancel(database,fixture.batchId)).rejects.toMatchObject({code:'CONFLICT'});
  });

  it('期限切れstate claimは同じitemと生成jobのまま再claimし旧claimの遅延commitを拒否する',async()=>{
    const fixture=await seed('entity_state');const confirmations=new PostgresGenerationBatchConfirmationRepository(database);
    const first=await confirmations.prepareState(fixture.itemId);
    await expireStateClaim(fixture.itemId);
    const recovered=await confirmations.prepareState(fixture.itemId);
    expect(recovered.newlyPrepared).toBe(true);
    expect(recovered.claimToken).not.toBe(first.claimToken);
    const concurrent=await confirmations.prepareState(fixture.itemId);
    expect(concurrent.inProgress).toBe(true);
    expect(concurrent.claimToken).toBe(recovered.claimToken);
    await expect(confirmations.commitState(first)).rejects.toMatchObject({code:'CONFLICT'});
    const unchanged=await database.query<{job_id:string;status:string}>(
      'SELECT job_id,status FROM generation_batch_items WHERE id=$1::uuid',[fixture.itemId]);
    expect(unchanged.rows[0]).toEqual({job_id:fixture.jobId,status:'confirming'});
    expect((await database.query<{count:string}>('SELECT COUNT(*)::text AS count FROM generation_jobs WHERE id=$1::uuid',[fixture.jobId])).rows[0]?.count).toBe('1');
    await confirmations.commitState(recovered);
    expect((await database.query<{status:string}>('SELECT status FROM generation_batch_items WHERE id=$1::uuid',[fixture.itemId])).rows[0]?.status).toBe('completed');
  });

  it('state confirmation回復claimは永続障害時も上限を超えて再発行しない',async()=>{
    const fixture=await seed('entity_state');const confirmations=new PostgresGenerationBatchConfirmationRepository(database);
    await confirmations.prepareState(fixture.itemId);
    for(let retry=0;retry<3;retry+=1){await expireStateClaim(fixture.itemId);await confirmations.prepareState(fixture.itemId);}
    await expireStateClaim(fixture.itemId);
    await expect(confirmations.prepareState(fixture.itemId)).rejects.toMatchObject({code:'CONFLICT'});
  });

  it('cancelが先に確定したbatchはcopy intentもstorage publishも開始しない',async()=>{
    const fixture=await seed('entity_base');await new PostgresGenerationBatchRepository().requestCancel(database,fixture.batchId);
    await expect(new PostgresGenerationBatchConfirmationRepository(database).prepareBase(fixture.itemId)).rejects.toMatchObject({code:'CONFLICT'});
    const item=await database.query<{confirmation:unknown}>('SELECT confirmation FROM generation_batch_items WHERE id=$1::uuid',[fixture.itemId]);
    expect(item.rows[0]?.confirmation).toBeNull();
  });

  it('storage待機中にwork削除権限を失ったbaseは参照へpublishしない',async()=>{
    const fixture=await seed('entity_base');const confirmations=new PostgresGenerationBatchConfirmationRepository(database);const claim=await confirmations.prepareBase(fixture.itemId);
    await database.query("INSERT INTO work_deletion_requests(work_id,owner_user_id,requested_by,status) VALUES($1,$2,$2,'pending')",[fixture.workId,fixture.userId]);
    await expect(confirmations.commitBase(claim,{s3Key:`saved/${fixture.userId}/entities/${fixture.entityId}/${fixture.itemId}.png`,cdnUrl:'https://example.invalid/ref.png'})).rejects.toMatchObject({code:'CONFLICT'});
    const refs=await database.query<{primary_ref_id:string|null}>('SELECT primary_ref_id FROM reference_sets WHERE entity_id=$1::uuid',[fixture.entityId]);expect(refs.rows[0]?.primary_ref_id).toBeNull();
  });

  it('古いprocessing batchが並んでもactionableな後続batchをbounded pollへ返す',async()=>{
    const first=await seed('entity_base'),second=await seed('entity_base'),actionable=await seed('entity_base');
    await database.query("UPDATE generation_jobs SET status='processing' WHERE id=ANY($1::uuid[])",[[first.jobId,second.jobId]]);
    await database.query("UPDATE generation_batches SET updated_at=NOW()-INTERVAL '1 hour' WHERE id=ANY($1::uuid[])",[[first.batchId,second.batchId]]);
    const ids=await new PostgresGenerationBatchRepository().findRunnableBatchIds(database,2);
    expect(ids).toContain(actionable.batchId);
  });

  async function seed(kind:'entity_base'|'entity_state'):Promise<{userId:string;workId:string;entityId:string;batchId:string;itemId:string;jobId:string}>{
    const userId=randomUUID(),workId=randomUUID(),entityId=randomUUID(),batchId=randomUUID(),itemId=randomUUID(),jobId=randomUUID(),stateId=randomUUID();
    await database.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[userId,userId,`${userId}@example.invalid`]);
    await database.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Batch confirm')",[workId,userId]);
    await database.query("INSERT INTO entities(id,work_id,user_id,entity_type,name,status) VALUES($1,$2,$3,'character','ミオ','draft')",[entityId,workId,userId]);
    await database.query("INSERT INTO reference_sets(entity_id,status) VALUES($1,'empty')",[entityId]);
    const revision=(await database.query<{updated_at:Date}>('SELECT updated_at FROM entities WHERE id=$1',[entityId])).rows[0]!.updated_at.toISOString();
    if(kind==='entity_state')await database.query("INSERT INTO entity_states(id,entity_id,name,description) VALUES($1,$2,'負傷','頬に傷')",[stateId,entityId]);
    await database.query(`INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result,completed_at)
      VALUES($1,$2,'entity_generate','completed',1,$3::jsonb,$4::jsonb,NOW())`,[jobId,userId,JSON.stringify({entity_id:entityId,image_model:'gpt-image-2.5-sunburst',provider_model_id:'gpt-image-2.5-sunburst-2026-09-08'}),JSON.stringify({candidates:[{s3_key:`session/${userId}/entities/${entityId}/${jobId}-1.png`}]})]);
    await database.query(`INSERT INTO generation_batches(id,user_id,work_id,kind,status,selection,render_style,image_model,pricing_version,maximum_credits,auto_confirm,approved_plan,expires_at,request_key,accepted_at)
      VALUES($1,$2,$3,'character_references','running','missing_only','color','gpt-image-2.5-sunburst','v1',1,TRUE,'{}'::jsonb,NOW()+INTERVAL '5 minutes',$4,NOW())`,[batchId,userId,workId,randomUUID()]);
    await database.query(`INSERT INTO generation_batch_items(id,batch_id,position,kind,label,target_id,entity_id,status,approved_request,approved_input,input_revision,operation,image_model,provider_model_id,amount_credits,pricing_version,job_id)
      VALUES($1,$2,0,$3,'対象',$4,$5,'active','{}'::jsonb,$6::jsonb,'revision',$7,'gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08',1,'v1',$8)`,
      [itemId,batchId,kind,kind==='entity_state'?stateId:entityId,entityId,JSON.stringify(kind==='entity_state'?{state_revision:'revision'}:{entity_revision:revision}),kind==='entity_state'?'entity_state_preview':'entity_preview',jobId]);
    return{userId,workId,entityId,batchId,itemId,jobId};
  }

  async function expireStateClaim(itemId:string):Promise<void>{
    await database.query(`UPDATE generation_batch_items SET confirmation=jsonb_set(confirmation,'{lease_until}',
      to_jsonb((NOW()-INTERVAL '1 minute')::text)) WHERE id=$1::uuid`,[itemId]);
  }
});
