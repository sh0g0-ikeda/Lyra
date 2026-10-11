import {PostgresGenerationQuoteRepository} from '../../src/repositories/GenerationQuoteRepository.js';
import type {DatabaseClient,TransactionRunner} from '../../src/lib/db.js';
import {Hono} from 'hono';
import type {AppEnv} from '../../src/types/app.js';
import {createWorkDeletionAccessGuard} from '../../src/routes/workDeletionAccessGuard.js';
import {errorHandler} from '../../src/middleware/errorHandler.js';
import {PostgresGenerationJobRepository} from '../../src/repositories/GenerationJobRepository.js';
import {PostgresFencedStateReferenceRepository} from '../../src/repositories/FencedStateReferenceRepository.js';
import {computeStateReferenceFingerprint} from '../../src/domain/state/StateReferenceFingerprint.js';
import {FencedStateReferenceConfirmationService} from '../../src/services/entity/FencedStateReferenceConfirmationService.js';
import type {ConfirmEntityStateReferenceInput} from '../../src/domain/types/entityStateReference.js';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createSyntheticPostgresDatabase,type SyntheticPostgresDatabase} from './postgresTestDatabase.js';
import {runPendingMigrations} from '../../src/lib/migrations.js';
import {PostgresWorkDeletionRepository} from '../../src/repositories/WorkDeletionRepository.js';
import {WorkDeletionService} from '../../src/services/work/WorkDeletionService.js';
const suite=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
type PromiseOutcome<T>={status:'fulfilled';value:T}|{status:'rejected';reason:unknown};
function captureOutcome<T>(promise:Promise<T>):Promise<PromiseOutcome<T>>{
 return promise.then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason}));
}
suite('永久作品削除の独立DB契約',()=>{
 let db:SyntheticPostgresDatabase;
 let repository:PostgresWorkDeletionRepository;
 beforeAll(async()=>{
  db=await createSyntheticPostgresDatabase({databaseUrl:process.env.DATABASE_URL!,prefix:'delupload',max:8});
  await runPendingMigrations(db.database);
  repository=new PostgresWorkDeletionRepository(db.database);
 },120000);
 afterAll(async()=>{await db?.close();},120000);
 async function fixture():Promise<{user:string;work:string;chapter:string;episode:string;page:string;key:string}>{
  const f={user:randomUUID(),work:randomUUID(),chapter:randomUUID(),episode:randomUUID(),page:randomUUID(),key:''};
  f.key=`saved/${f.user}/pages/${f.page}_final.png`;
  await db.pool.query("INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)",[f.user,f.user,f.user+'@example.invalid']);
  await db.pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'deletion fixture')",[f.work,f.user]);
  await db.pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)',[f.chapter,f.work]);
  await db.pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[f.episode,f.chapter]);
  await db.pool.query('INSERT INTO pages(id,episode_id,page_number,generated_image) VALUES($1,$2,1,$3)',[f.page,f.episode,JSON.stringify({s3_key:f.key})]);
  return f;
 }
 it('manifestを先に保存しpending中の直接編集を拒否し消去後のみcascadeする',async()=>{
  const f=await fixture();
  const request=await repository.request(f.user,f.work,null);
  expect(request.status).toBe('pending');
  expect((await db.pool.query('SELECT 1 FROM works WHERE id=$1',[f.work])).rows).toHaveLength(1);
  await expect(db.pool.query("UPDATE pages SET status='editing' WHERE id=$1",[f.page])).rejects.toMatchObject({constraint:'work_deletion_write_guard'});
  const erased:string[]=[];
  await new WorkDeletionService(repository,{scanPrefix:async()=>({keys:[],next:null}),erase:async key=>{erased.push(key);}}).recoverPendingRequests(1);
  expect(erased).toEqual([f.key]);
  expect((await db.pool.query('SELECT s3_key FROM work_deletion_assets WHERE request_id=$1',[request.id])).rows[0].s3_key).toBeNull();
  expect((await db.pool.query('SELECT 1 FROM work_deletion_prefixes WHERE request_id=$1',[request.id])).rows).toHaveLength(0);
  const foreign=await fixture();await expect(db.pool.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[foreign.page,JSON.stringify({s3_key:f.key})])).rejects.toMatchObject({constraint:'work_deletion_write_guard'});
  expect((await repository.find(f.user,request.id,null)).status).toBe('completed');
  expect((await db.pool.query('SELECT 1 FROM works WHERE id=$1',[f.work])).rows).toHaveLength(0);
  expect((await repository.request(f.user,f.work,null)).id).toBe(request.id);
 });
 it('画像消去失敗の場合に作品とmanifestを残す',async()=>{
  const f=await fixture();const request=await repository.request(f.user,f.work,null);
  await new WorkDeletionService(repository,{scanPrefix:async()=>({keys:[],next:null}),erase:async()=>{throw new Error('injected');}}).recoverPendingRequests(1);
  expect((await repository.find(f.user,request.id,null)).status).toBe('pending_external_action');
  expect((await db.pool.query('SELECT 1 FROM pages WHERE id=$1',[f.page])).rows).toHaveLength(1);
 });
 it('scope外の削除でDB状態を変えない',async()=>{
  const f=await fixture();const other=await fixture();
  await expect(repository.request(other.user,f.work,null)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await db.pool.query('SELECT 1 FROM work_deletion_requests WHERE work_id=$1',[f.work])).rows).toHaveLength(0);
 });
 it('生成INSERTが先ならactive jobを保護して削除を拒否する',async()=>{
  const f=await fixture();const client=await db.pool.connect();
   let transactionOpen=false;let deletionResult:Promise<PromiseOutcome<unknown>>|undefined;
   try{
    await client.query('BEGIN');transactionOpen=true;
    await client.query("INSERT INTO generation_jobs(id,user_id,job_type,credit_cost,params) VALUES($1,$2,'page_generate',0,$3)",[randomUUID(),f.user,JSON.stringify({page_id:f.page})]);
    deletionResult=captureOutcome(repository.request(f.user,f.work,null));
    await client.query('COMMIT');transactionOpen=false;
   }finally{
    try{if(transactionOpen)await client.query('ROLLBACK');}finally{client.release();}
   }
   if(deletionResult===undefined)throw new Error('削除要求が開始されていません');
   const deletionOutcome=await deletionResult;
   expect(deletionOutcome.status).toBe('rejected');
   if(deletionOutcome.status==='fulfilled')throw new Error('active jobがある作品の削除要求が成功しました');
   expect(deletionOutcome.reason).toMatchObject({code:'CONFLICT'});
  expect((await db.pool.query('SELECT 1 FROM work_deletion_requests WHERE work_id=$1',[f.work])).rows).toHaveLength(0);
 });
 it('削除受付が先なら旧clientのentity生成INSERTも拒否する',async()=>{
  const f=await fixture();const entity=randomUUID();
  await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'character')",[entity,f.work,f.user]);
  await repository.request(f.user,f.work,null);
  await expect(db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,credit_cost,params) VALUES($1,$2,'entity_generate',0,$3)",[randomUUID(),f.user,JSON.stringify({entity_id:entity})])).rejects.toMatchObject({constraint:'work_deletion_write_guard'});
 });

 it('他作品への参照登録が先ならCOMMITを待ち共有画像の消去を拒否する',async()=>{
  const f=await fixture();const other=await fixture();const client=await db.pool.connect();
   let transactionOpen=false;let deletionResult:Promise<PromiseOutcome<unknown>>|undefined;
   try{
    await client.query('BEGIN');transactionOpen=true;
    await client.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[other.page,JSON.stringify({s3_key:f.key})]);
    deletionResult=captureOutcome(repository.request(f.user,f.work,null));
    await client.query('COMMIT');transactionOpen=false;
   }finally{
    try{if(transactionOpen)await client.query('ROLLBACK');}finally{client.release();}
   }
   if(deletionResult===undefined)throw new Error('削除要求が開始されていません');
   const deletionOutcome=await deletionResult;
   expect(deletionOutcome.status).toBe('rejected');
   if(deletionOutcome.status==='fulfilled')throw new Error('共有画像を持つ作品の削除要求が成功しました');
   expect(deletionOutcome.reason).toMatchObject({code:'CONFLICT'});
 });
 it('削除manifest確定後に別作品が同じ画像を採用しようとすると拒否する',async()=>{
  const f=await fixture();const other=await fixture();await repository.request(f.user,f.work,null);
  await expect(db.pool.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[other.page,JSON.stringify({s3_key:f.key})])).rejects.toMatchObject({constraint:'work_deletion_write_guard'});
 });
 it('同期画像書込みが未確定なら受付せず作品を表示できるまま残す',async()=>{
  const f=await fixture();await db.pool.query('INSERT INTO work_storage_operations(work_id) VALUES($1)',[f.work]);
  await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});
  expect((await db.pool.query('SELECT deletion_started_at FROM works WHERE id=$1',[f.work])).rows[0].deletion_started_at).toBeNull();
 });
 it('他作品所有の画像keyをpageに設定していても消去manifestに採用しない',async()=>{
  const f=await fixture();const other=await fixture();
  await db.pool.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[f.page,JSON.stringify({s3_key:other.key})]);
  await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});
 });
 it.each(['personal','organization','historical'])('confirmed v2参照を%s work claimでfenceして内容を消しaccountを変更しない',async scope=>{
  const f=await fixture();const entityId=randomUUID(),stateId=randomUUID(),jobId=randomUUID();
  const organizationId=scope==='organization'?randomUUID():null;
  if(organizationId!==null){await db.pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'v2 scrub',$2)",[organizationId,f.user]);await db.pool.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner')",[organizationId,f.user]);await db.pool.query('UPDATE works SET organization_id=$2 WHERE id=$1',[f.work,organizationId]);}
  await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'character')",[entityId,f.work,f.user]);
  await db.pool.query("INSERT INTO reference_sets(entity_id,primary_ref_id,reference_images,status) VALUES($1,'base-ref',$2,'ready')",[entityId,JSON.stringify([{ref_id:'base-ref',s3_key:`saved/${f.user}/entities/${entityId}/base.png`}])]);
  await db.pool.query("INSERT INTO entity_states(id,entity_id,name,description,created_at,updated_at) VALUES($1,$2,'injured','A cheek scar','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')",[stateId,entityId]);
  const input:ConfirmEntityStateReferenceInput={userId:f.user,organizationId,entityId,stateId,jobId,
   candidateS3Key:`session/${f.user}/entities/${entityId}/${jobId}-1.png`,expectedStateRevision:'2026-09-30T00:00:00.000Z',
   descriptor:{refId:`${jobId}-1`,s3Key:`saved/${f.user}/entities/${entityId}/states/${stateId}/${jobId}-1.png`,storageOwnerUserId:f.user,imageModel:'gpt-image-2',baseRefId:'base-ref',createdAt:'2026-09-30T00:00:01.000Z',inputFingerprint:computeStateReferenceFingerprint({entityId,stateId,name:'injured',description:'A cheek scar',baseRefId:'base-ref'})}};
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result,completed_at) VALUES($1,$2,'entity_generate','completed',1,$3,$4,now())",[jobId,f.user,JSON.stringify({target:'entity_state',entity_id:entityId,entity_state_id:stateId,base_primary_ref_id:'base-ref',state_revision:input.expectedStateRevision,state_input_fingerprint:input.descriptor.inputFingerprint,image_model:'gpt-image-2'}),JSON.stringify({candidates:[{ref_id:input.descriptor.refId,s3_key:input.candidateS3Key}]})]);
  if(organizationId!==null)await db.pool.query('UPDATE generation_jobs SET organization_id=$2 WHERE id=$1',[jobId,organizationId]);
  const fenced=new PostgresFencedStateReferenceRepository(db.database);
  const attempt=(await fenced.admit(input,{mimeType:'image/png',sizeBytes:100,digest:'a'.repeat(64),sourceRevision:{eTag:'"source"'}})).attempt!;
  await fenced.authorizeDispatch(attempt);
  const {protocol,attemptToken,s3Key,digest,mimeType,sizeBytes}=attempt.intent;
  await fenced.confirmObservedImage(attempt,{kind:'image',protocol,attemptToken,s3Key,digest,mimeType,sizeBytes,eTag:'"image"',versionId:'image-v1'});
  if(scope==='historical')await db.pool.query('DELETE FROM entities WHERE id=$1',[entityId]);
  const request=await repository.request(f.user,f.work,organizationId);
  await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  let fencedCount=0;
  const confirmation=new FencedStateReferenceConfirmationService({repository:fenced,
    imageCreator:{loadSource:async()=>{throw new Error('not called');},createImage:async()=>{throw new Error('not called');}},
    recovery:{observe:async()=>{throw new Error('not called');},fenceAndErase:async()=>{fencedCount++;return {kind:'marker',protocol,attemptToken,s3Key,eTag:'"marker"',versionId:'marker-v2',historyErased:true};}}});
  const erased:string[]=[];
  await new WorkDeletionService(repository,{scanPrefix:async()=>({keys:[],next:null}),erase:async key=>{erased.push(key);}},confirmation).recoverPendingRequests(1);
  expect(await repository.find(f.user,request.id,organizationId)).toMatchObject({status:'completed'});
  expect(fencedCount).toBe(1);expect(erased).not.toContain(s3Key);
  expect((await db.pool.query('SELECT entity_id,candidate_s3_key,descriptor,scrubbed_at,marker_receipt FROM state_reference_copy_attempts WHERE attempt_token=$1',[attemptToken])).rows[0]).toMatchObject({entity_id:null,candidate_s3_key:null,descriptor:null,scrubbed_at:expect.any(Date),marker_receipt:expect.any(Object)});
  expect((await db.pool.query('SELECT account_deletion_started_at FROM users WHERE id=$1',[f.user])).rows[0].account_deletion_started_at).toBeNull();
  expect((await db.pool.query('SELECT status,result FROM generation_jobs WHERE id=$1',[jobId])).rows[0]).toMatchObject({status:'completed',result:null});
 });

 it('pending作品の直接画像URL取得はHTTP guardで404となりsignerを呼ばない',async()=>{
  const f=await fixture();await repository.request(f.user,f.work,null);let signed=false;
  const app=new Hono<AppEnv>();app.onError(errorHandler);app.use('*',async(c,next)=>{c.set('user',{id:f.user,supabaseId:f.user,email:'guard@example.invalid',displayName:null,planCode:'free'});await next();});
  app.use('*',createWorkDeletionAccessGuard(db.database));app.get('/api/pages/:id/export-image',c=>{signed=true;return c.json({url:'not-issued'});});
  expect((await app.request(`/api/pages/${f.page}/export-image`)).status).toBe(404);expect(signed).toBe(false);
 });
 it('HTTP画像copy実行中に削除受付を拒否し成功後は受付できる',async()=>{
  const f=await fixture();let blocked=false;
  const app=new Hono<AppEnv>();app.onError(errorHandler);app.use('*',async(c,next)=>{c.set('user',{id:f.user,supabaseId:f.user,email:'guard@example.invalid',displayName:null,planCode:'free'});await next();});
  app.use('*',createWorkDeletionAccessGuard(db.database));app.post('/api/pages/:id/confirm',async c=>{
   await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});blocked=true;return c.json({confirmed:true});
  });
  expect((await app.request(`/api/pages/${f.page}/confirm`,{method:'POST'})).status).toBe(200);expect(blocked).toBe(true);
  expect((await repository.request(f.user,f.work,null)).status).toBe('pending');
 });
 it('org billing権限で削除せずactive editorだけが同一orgのreceiptを取得できる',async()=>{
  const f=await fixture(),editor=await fixture(),billing=await fixture();const org=randomUUID();
  await db.pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Deletion scope',$2)",[org,f.user]);
  await db.pool.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'editor'),($1,$4,'billing')",[org,f.user,editor.user,billing.user]);
  await db.pool.query('UPDATE works SET organization_id=$2 WHERE id=$1',[f.work,org]);
  await expect(repository.request(billing.user,f.work,org)).rejects.toMatchObject({code:'NOT_FOUND'});
  const request=await repository.request(editor.user,f.work,org);
  expect((await repository.list(editor.user,org)).map(row=>row.id)).toContain(request.id);
  await expect(repository.find(billing.user,request.id,org)).rejects.toMatchObject({code:'NOT_FOUND'});
  await db.pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2",[org,editor.user]);
  await expect(repository.find(editor.user,request.id,org)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('pending workの生成履歴はIDと料金を保ち画像候補を返さない',async()=>{
  const f=await fixture();const job=randomUUID();
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result,completed_at) VALUES($1,$2,'page_generate','completed',0,$3,$4,now())",[job,f.user,JSON.stringify({page_id:f.page}),JSON.stringify({s3_key:f.key})]);
  await repository.request(f.user,f.work,null);
  const jobs=new PostgresGenerationJobRepository(db.database);
  expect(await jobs.findByIdAndUserId(job,f.user)).toMatchObject({id:job,status:'completed',result:null,creditCost:0});
  expect((await jobs.listHistory({userId:f.user,limit:20,cursor:null})).jobs[0]).toMatchObject({id:job,result:null});
 });

 it('再試行した画像jobの旧write完了が不明ならcompletedでも受付しない',async()=>{
  const f=await fixture();
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,retry_count,params,result,completed_at) VALUES($1,$2,'page_generate','completed',0,1,$3,$4,now())",[randomUUID(),f.user,JSON.stringify({page_id:f.page}),JSON.stringify({s3_key:f.key})]);
  await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});
 });

 it('S3を書かないstory-only terminal retryでは作品削除を妨げない',async()=>{
  const f=await fixture();await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,retry_count,params,completed_at) VALUES($1,$2,'episode_story_autofill','completed',0,2,$3,now())",[randomUUID(),f.user,JSON.stringify({episode_id:f.episode})]);
  expect((await repository.request(f.user,f.work,null)).status).toBe('pending');
 });

 it('過去confirmed画像のprefix探索cursorを失敗後に再開し全探索完了後だけ消去する',async()=>{
  const f=await fixture();const entity=randomUUID();await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'old images')",[entity,f.work,f.user]);
  const prefix=`saved/${f.user}/entities/${entity}/`,old1=prefix+'retired-a.png',old2=prefix+'retired-b.png';
  const request=await repository.request(f.user,f.work,null);
  await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  const erased:string[]=[];let fail=true;const cursors:Array<string|null>=[];
  const storage={erase:async(key:string)=>{erased.push(key);},scanPrefix:async(input:{prefix:string;cursor:{key:string;version:string}|null})=>{
   if(input.prefix!=='saved/')return {keys:[],next:null};cursors.push(input.cursor?.key??null);
   if(input.cursor===null)return {keys:[old1],next:{key:old1,version:'v1'}};
   if(fail)throw new Error('listing temporarily unavailable');return {keys:[old2],next:null};
  }};
  await new WorkDeletionService(repository,storage).recoverPendingRequests(1);
  expect(erased).toEqual([]);expect((await repository.find(f.user,request.id,null)).blockerCode).toBe('ASSET_INVENTORY_FAILED');
  expect((await db.pool.query('SELECT key_marker FROM work_deletion_prefixes WHERE request_id=$1 AND prefix=$2',[request.id,'saved/'])).rows[0].key_marker).toBe(old1);
  fail=false;await db.pool.query('UPDATE work_deletion_requests SET next_retry_at=now() WHERE id=$1',[request.id]);
  await new WorkDeletionService(repository,storage).recoverPendingRequests(1);
  expect((await repository.find(f.user,request.id,null)).status).toBe('completed');expect(erased.sort()).toEqual([f.key,old1,old2].sort());expect(cursors).toEqual([null,old1,old1]);
 });
 it('探索で見つかった過去画像が他作品から参照されていれば消去を開始しない',async()=>{
  const f=await fixture(),other=await fixture();const entity=randomUUID();await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'old shared')",[entity,f.work,f.user]);
  const prefix=`saved/${f.user}/entities/${entity}/`,key=prefix+'retired.png';
  await db.pool.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[other.page,JSON.stringify({s3_key:key})]);
  const request=await repository.request(f.user,f.work,null);
  await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  let erased=false;await new WorkDeletionService(repository,{erase:async()=>{erased=true;},scanPrefix:async input=>({keys:input.prefix==='saved/'?[key]:[],next:null})}).recoverPendingRequests(1);
  expect(erased).toBe(false);expect((await repository.find(f.user,request.id,null)).status).toBe('pending_external_action');
 });

 it('削除transactionが先にmanifestを持った場合に待機中の他作品参照UPDATEも拒否する',async()=>{
  const f=await fixture(),other=await fixture();let release:()=>void=()=>undefined,ready:()=>void=()=>undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;}),frozen=new Promise<void>(resolve=>{ready=resolve;});
  const delayed:DatabaseClient&TransactionRunner={query:db.database.query.bind(db.database),transaction:work=>db.database.transaction(async client=>{const value=await work(client);ready();await gate;return value;})};
  const deletion=new PostgresWorkDeletionRepository(delayed).request(f.user,f.work,null);await frozen;
   const updateResult=captureOutcome(db.pool.query('UPDATE pages SET generated_image=$2 WHERE id=$1',[other.page,JSON.stringify({s3_key:f.key})]));
   try{release();await deletion;}finally{release();}
   const updateOutcome=await updateResult;
   expect(updateOutcome.status).toBe('rejected');
   if(updateOutcome.status==='fulfilled')throw new Error('削除manifest確定後の画像参照UPDATEが成功しました');
   expect(updateOutcome.reason).toMatchObject({constraint:'work_deletion_write_guard'});
 });

 it('作品と画像消去後も課金ledgerとaccepted quote receiptの同一IDを保持する',async()=>{
  const f=await fixture(),job=randomUUID(),quote=randomUUID(),requestKey=randomUUID(),ledger=randomUUID();
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result,completed_at) VALUES($1,$2,'page_generate','completed',1,$3,$4,now())",[job,f.user,JSON.stringify({page_id:f.page}),JSON.stringify({s3_key:f.key})]);
  await db.pool.query("INSERT INTO credit_ledger(id,user_id,type,amount,monthly_after,purchased_after,job_id) VALUES($1,$2,'consume',-1,0,0,$3)",[ledger,f.user,job]);
  await db.pool.query("INSERT INTO generation_quotes(id,token_hash,user_id,operation,target_id,request,plan,expires_at,accepted_job_id,request_key,accepted_at,dispatch_state) VALUES($1,$2,$3,'page_generate',$4,$5,$6,now()+interval '1 hour',$7,$8,now(),'dispatched')",[quote,quote.replaceAll('-','').repeat(2),f.user,f.page,JSON.stringify({operation:'page_generate',targetId:f.page}),JSON.stringify({operation:'page_generate',targetId:f.page,workId:f.work,amountCredits:1,snapshot:{private:'story text'},jobParams:{prompt:'story text'}}),job,requestKey]);
  const request=await repository.request(f.user,f.work,null);await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  await new WorkDeletionService(repository,{scanPrefix:async()=>({keys:[],next:null}),erase:async()=>undefined}).recoverPendingRequests(1);
  expect((await repository.find(f.user,request.id,null)).status).toBe('completed');
  const quotes=new PostgresGenerationQuoteRepository(db.database);const receipt=await quotes.receipt(db.database,f.user,null,quote);
  expect(receipt).toMatchObject({jobStatus:'completed',chargedCredits:1,refundedCredits:0,quote:{id:quote,acceptedJobId:job,requestKey,plan:{amountCredits:1}}});
  expect(receipt.quote.plan).not.toHaveProperty('snapshot');expect(receipt.quote.plan).not.toHaveProperty('jobParams');
  expect((await quotes.find(db.database,f.user,null,quote)).acceptedJobId).toBe(job);
  expect((await db.pool.query('SELECT id,amount FROM credit_ledger WHERE id=$1',[ledger])).rows[0]).toEqual({id:ledger,amount:-1});
 });

 it('退会actorのaudit無し旧画像もresource UUIDで探索し他作品画像を残す',async()=>{
  const f=await fixture(),oldActor=await fixture(),editor=await fixture(),other=await fixture();const org=randomUUID(),entity=randomUUID();
  await db.pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Historical actor',$2)",[org,f.user]);
  await db.pool.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'editor'),($1,$4,'editor')",[org,f.user,oldActor.user,editor.user]);
  await db.pool.query('UPDATE works SET organization_id=$2 WHERE id=$1',[f.work,org]);
  await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'old confirmation')",[entity,f.work,f.user]);
  await db.pool.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2',[org,oldActor.user]);
  const oldPage=`saved/${oldActor.user}/pages/${f.page}_final.png`,oldEntity=`saved/${oldActor.user}/entities/${entity}/previous-confirmation.png`;
  const foreign=`saved/${oldActor.user}/pages/${other.page}_final.png`,erased:string[]=[];
  const request=await repository.request(editor.user,f.work,org);await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  await new WorkDeletionService(repository,{scanPrefix:async input=>({keys:input.prefix==='saved/'?[oldPage,oldEntity,foreign]:[],next:null}),erase:async key=>{erased.push(key);}}).recoverPendingRequests(1);
  expect((await repository.find(editor.user,request.id,org)).status).toBe('completed');expect(erased.sort()).toEqual([f.key,oldPage,oldEntity].sort());expect(erased).not.toContain(foreign);
 });
 it('owner scopeに帰属不能な旧resource objectがあれば完全消去と報告せず止める',async()=>{
  const f=await fixture();const orphan=`saved/${f.user}/entities/${randomUUID()}/unmapped.png`;
  const request=await repository.request(f.user,f.work,null);await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  let erased=false;await new WorkDeletionService(repository,{scanPrefix:async input=>({keys:input.prefix==='saved/'?[orphan]:[],next:null}),erase:async()=>{erased=true;}}).recoverPendingRequests(1);
  expect(erased).toBe(false);expect((await repository.find(f.user,request.id,null)).status).toBe('pending_external_action');
 });
 it('先に削除されたpageのUUIDと画像をownership journalで保持して後の作品削除で消去する',async()=>{
  const f=await fixture();await db.pool.query('DELETE FROM pages WHERE id=$1',[f.page]);
  const request=await repository.request(f.user,f.work,null);await db.pool.query("UPDATE work_deletion_requests SET next_retry_at=now()+interval '1 day' WHERE status<>'completed' AND id<>$1",[request.id]);
  const erased:string[]=[];await new WorkDeletionService(repository,{scanPrefix:async p=>({keys:p.prefix==='saved/'?[f.key]:[],next:null}),erase:async key=>{erased.push(key);}}).recoverPendingRequests(1);
  expect((await repository.find(f.user,request.id,null)).status).toBe('completed');expect(erased).toEqual([f.key]);
 });
 it('旧削除済みpageでもretained jobのscope付きwork_idからUUIDをsnapshotする',async()=>{
  const f=await fixture(),oldPage=randomUUID(),job=randomUUID(),key=`saved/${f.user}/pages/${oldPage}_final.png`;
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result,completed_at) VALUES($1,$2,'page_generate','completed',0,$3,$4,now())",[job,f.user,JSON.stringify({page_id:oldPage,work_id:f.work}),JSON.stringify({s3_key:key})]);
  const request=await repository.request(f.user,f.work,null);expect((await db.pool.query("SELECT 1 FROM work_deletion_resources WHERE request_id=$1 AND kind='page' AND resource_id=$2",[request.id,oldPage])).rows).toHaveLength(1);
 });
 it('import copy intent後の失敗はcommit timestampがなくても遅延write不明として拒否する',async()=>{
  const f=await fixture(),entity=randomUUID();await db.pool.query("INSERT INTO entities(id,work_id,user_id,name) VALUES($1,$2,$3,'intent')",[entity,f.work,f.user]);
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,result) VALUES($1,$2,'entity_import_analysis','failed',0,$3,$4)",[randomUUID(),f.user,JSON.stringify({entity_id:entity}),JSON.stringify({import_copy_intent:`saved/${f.user}/entities/${entity}/copy.png`})]);
  await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});
 });

 it('旧entity jobはaccepted quoteのwork scopeを使い他tenantの偽work_idは採用しない',async()=>{
  const f=await fixture(),other=await fixture(),entity=randomUUID(),job=randomUUID(),quote=randomUUID();
  await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,completed_at) VALUES($1,$2,'entity_generate','completed',0,$3,now())",[job,f.user,JSON.stringify({entity_id:entity})]);
  await db.pool.query("INSERT INTO generation_quotes(id,token_hash,user_id,operation,target_id,request,plan,expires_at,accepted_job_id,request_key,accepted_at,dispatch_state) VALUES($1,$2,$3,'entity_preview',$4,'{}',$5,now()+interval '1 hour',$6,$7,now(),'dispatched')",[quote,quote.replaceAll('-','').repeat(2),f.user,entity,JSON.stringify({workId:f.work}),job,randomUUID()]);
  const request=await repository.request(f.user,f.work,null);expect((await db.pool.query("SELECT 1 FROM work_deletion_resources WHERE request_id=$1 AND kind='entity' AND resource_id=$2",[request.id,entity])).rows).toHaveLength(1);
  const forged=randomUUID();await db.pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params,completed_at) VALUES($1,$2,'page_generate','completed',0,$3,now())",[forged,other.user,JSON.stringify({page_id:randomUUID(),work_id:f.work})]);
  expect((await db.pool.query("SELECT lyra_resource_work_id('generation_jobs',to_jsonb(j)) AS work FROM generation_jobs j WHERE id=$1",[forged])).rows[0].work).toBeNull();
 });
 it('pageを別作品へ移した履歴があれば旧作品で画像所有を決めつけず拒否する',async()=>{
  const f=await fixture(),other=await fixture();await db.pool.query('UPDATE pages SET episode_id=$2,page_number=2 WHERE id=$1',[f.page,other.episode]);
  await expect(repository.request(f.user,f.work,null)).rejects.toMatchObject({code:'CONFLICT'});
  await expect(repository.request(other.user,other.work,null)).rejects.toMatchObject({code:'CONFLICT'});
 });

});
