import {computeStateReferenceFingerprint} from '../../src/domain/state/StateReferenceFingerprint.js';
import {randomUUID} from 'node:crypto';
import {Pool,type QueryResultRow} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {DatabaseClient,TransactionRunner} from '../../src/lib/db.js';
import {runPendingMigrations} from '../../src/lib/migrations.js';
import {withPostgresTestMigrationLock} from './postgresTestMigrationLock.js';
import {GenerationQuoteService} from '../../src/services/generation/GenerationQuoteService.js';
import {PageGenerationService} from '../../src/services/page/PageGenerationService.js';
import {PostgresPageRepository} from '../../src/repositories/PageRepository.js';
import {PostgresEntityRepository} from '../../src/repositories/EntityRepository.js';
import {PostgresGenerationJobRepository} from '../../src/repositories/GenerationJobRepository.js';
import {PostgresCreditRepository} from '../../src/repositories/CreditRepository.js';
import {CreditService} from '../../src/services/credit/CreditService.js';
import {ModeSelector} from '../../src/services/page/ModeSelector.js';
import {PageAtomicGenerationService} from '../../src/services/page/PageAtomicGenerationService.js';
import type {SaveAndGeneratePageInput} from '../../src/services/page/PageSaveAndGenerate.js';
import {PostgresGenerationQuotePlanResolver} from '../../src/repositories/GenerationQuotePlanResolver.js';
import { rejectionOf, throwingRejectionOf } from './asyncPostgresAssertions.js';

const run=process.env.APP_ENV==='test' && process.env.DATABASE_URL ? describe : describe.skip;
run('legacy atomic save-and-generate compatibility',()=>{
 let admin:Pool;let pool:Pool;const schema=`page_atomic_${process.pid}_${Date.now()}`;
 beforeAll(async()=>{admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:12});await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database()));},120_000);
 afterAll(async()=>{await pool?.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
 function database(failSql?:string):DatabaseClient&TransactionRunner{
  return {query:<T extends QueryResultRow=QueryResultRow>(sql:string,values?:readonly unknown[])=>pool.query<T>(sql,values?[...values]:undefined),transaction:async<T>(callback:(client:DatabaseClient)=>Promise<T>):Promise<T>=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await callback({query:<R extends QueryResultRow=QueryResultRow>(sql:string,values?:readonly unknown[])=>{if(failSql&&sql.includes(failSql))throw new Error('Injected atomic failure');return client.query<R>(sql,values?[...values]:undefined);}});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
 }
 function service(failSql?:string,dispatch?:()=>Promise<void>,generationEnabled=true){return new PageAtomicGenerationService({database:database(failSql),generationEnabled,resolver:new PostgresGenerationQuotePlanResolver({imageModel:'gpt-image-2',generationEnabled:true,pageGenerationEnabled:true,stateGenerationEnabled:true,importEnabled:false}),dispatcher:dispatch?{dispatchQuote:dispatch}:undefined});}
 async function fixture(){
  const userId=randomUUID(),workId=randomUUID(),chapterId=randomUUID(),episodeId=randomUUID(),pageId=randomUUID(),panelId=randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[userId,userId,`${userId}@example.invalid`]);await pool.query('INSERT INTO credit_balances(user_id,purchased_credits) VALUES($1,30)',[userId]);
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'atomic')",[workId,userId]);await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)',[chapterId,workId]);await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[episodeId,chapterId]);
  const page=await pool.query("INSERT INTO pages(id,episode_id,page_number,status,layout_config) VALUES($1,$2,1,'editing','{\"keep_metadata\":\"yes\",\"type\":\"template\",\"template_id\":\"splash_1\"}') RETURNING updated_at",[pageId,episodeId]);
  await pool.query('INSERT INTO panels(id,page_id,"order",situation_text) VALUES($1,$2,1,\'before\')',[panelId,pageId]);
  await pool.query(`INSERT INTO panel_frames(page_id,panel_id,vertices,reading_order) VALUES($1,$2,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]',1)`,[pageId,panelId]);
  const input:SaveAndGeneratePageInput={expectedUpdatedAt:page.rows[0].updated_at.toISOString(),requestId:randomUUID(),page:{storyPagePurpose:'saved purpose'},renderStyle:'monochrome',language:'ja',panels:[{id:panelId,order:1,panelRole:'action',panelSize:'standard',situationText:'approved saved scene',composition:{source:'custom',galleryItemId:null,compositionPrompt:null,shotType:null,angle:null,customNote:null},dialogueInPanel:true,dialogue:[],sfxText:null,backgroundNote:'new background',panelNotes:null,entities:[]}],frames:[{panelId,vertices:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],borderStyle:'solid',borderWidth:3,borderColor:'#000000',zIndex:1,readingOrder:1}]};
  return {userId,workId,chapterId,episodeId,pageId,panelId,input};
 }
 async function state(ids:Awaited<ReturnType<typeof fixture>>){return (await pool.query(`SELECT p.status,p.layout_config,(SELECT situation_text FROM panels WHERE id=$2) AS scene,(SELECT purchased_credits FROM credit_balances WHERE user_id=$3) AS credits,(SELECT COUNT(*)::int FROM generation_jobs WHERE user_id=$3) AS jobs,(SELECT COUNT(*)::int FROM credit_ledger WHERE user_id=$3 AND type='consume') AS debits FROM pages p WHERE p.id=$1`,[ids.pageId,ids.panelId,ids.userId])).rows[0];}
 it('public quote機能を要求せず同時同keyを一度だけ保存課金しcommit後にdispatchする',async()=>{
  const ids=await fixture();let calls=0;
  const instance=service(undefined,async()=>{calls++;expect((await state(ids)).jobs).toBe(1);});
  const results=await Promise.all(Array.from({length:3},()=>instance.saveAndGenerate(ids.userId,ids.pageId,ids.input)));
  expect(new Set(results.map(result=>result.jobId)).size).toBe(1);expect(calls).toBeGreaterThan(0);
  expect(await state(ids)).toMatchObject({status:'generating',scene:'approved saved scene',credits:27,jobs:1,debits:1,layout_config:{keep_metadata:'yes',story_page_purpose:'saved purpose'}});
  const job=(await pool.query('SELECT params,result FROM generation_jobs WHERE id=$1',[results[0]!.jobId])).rows[0];
  expect(job.params).toMatchObject({render_style:'monochrome',save_and_generate_request_id:ids.input.requestId,page_revision:results[0]!.pageRevision});
  expect(job.result.input_snapshot).toMatchObject({renderStyle:'monochrome',panelCount:1});
  const snapshot=(await pool.query('SELECT plan FROM generation_quotes WHERE id=$1',[job.params.quote_id])).rows[0].plan.snapshot;
  expect(snapshot.prompt.draftPrompt).toContain('approved saved scene');
  expect(await rejectionOf(instance.saveAndGenerate(ids.userId,ids.pageId,{...ids.input,page:{storyPagePurpose:'different'}}))).toMatchObject({code:'CONFLICT'});
  expect((await state(ids)).debits).toBe(1);
 });
 it.each(['UPDATE panels','INSERT INTO panel_frames','INSERT INTO generation_jobs','INSERT INTO credit_ledger','SET accepted_job_id','SET params=params ||'])('%s失敗ならdraft・job・charge・receiptをまとめてrollbackする',async(failSql)=>{
  const ids=await fixture();expect(await throwingRejectionOf(service(failSql).saveAndGenerate(ids.userId,ids.pageId,ids.input))).toThrow('Injected atomic failure');expect(await state(ids)).toMatchObject({status:'editing',scene:'before',credits:30,jobs:0,debits:0});
  expect((await pool.query('SELECT id FROM generation_quotes WHERE user_id=$1',[ids.userId])).rows).toEqual([]);
 });
 it('stale・残高不足・foreign・不一致panelは書込前またはrollbackで拒否する',async()=>{
  const ids=await fixture();const instance=service();
  expect(await rejectionOf(instance.saveAndGenerate(ids.userId,ids.pageId,{...ids.input,expectedUpdatedAt:'2000-01-01T00:00:00Z'}))).toMatchObject({code:'PAGE_STALE'});
  expect(await rejectionOf(instance.saveAndGenerate(randomUUID(),ids.pageId,ids.input))).toMatchObject({code:'NOT_FOUND'});
  expect(await rejectionOf(instance.saveAndGenerate(ids.userId,ids.pageId,ids.input,randomUUID()))).toBeDefined();
  expect(await rejectionOf(instance.saveAndGenerate(ids.userId,ids.pageId,{...ids.input,panels:[{...ids.input.panels[0]!,id:randomUUID()}]}))).toMatchObject({code:'VALIDATION_ERROR'});
  await pool.query('UPDATE credit_balances SET purchased_credits=2 WHERE user_id=$1',[ids.userId]);
  expect(await rejectionOf(instance.saveAndGenerate(ids.userId,ids.pageId,ids.input))).toMatchObject({code:'INSUFFICIENT_CREDITS'});
  expect(await state(ids)).toMatchObject({status:'editing',scene:'before',credits:2,jobs:0,debits:0});
 });
 it('queue結果不明は確定済みreceiptを返し同key再送でも二重chargeしない',async()=>{
  const ids=await fixture();const instance=service(undefined,async()=>{throw new Error('unknown queue result');});const first=await instance.saveAndGenerate(ids.userId,ids.pageId,ids.input);const second=await instance.saveAndGenerate(ids.userId,ids.pageId,ids.input);expect(second).toEqual(first);expect(await service(undefined,undefined,false).saveAndGenerate(ids.userId,ids.pageId,ids.input)).toEqual(first);expect((await state(ids)).debits).toBe(1);
 });
 it('readinessは無課金で現在revisionとserver priceと具体的blockerを返す',async()=>{
  const ids=await fixture();const instance=service();
  const ready=await instance.getGenerationReadiness(ids.userId,ids.pageId);
  expect(ready).toMatchObject({ready:true,estimatedCreditCost:3,pageRevision:ids.input.expectedUpdatedAt,blockers:[]});
  await pool.query('UPDATE credit_balances SET purchased_credits=2 WHERE user_id=$1',[ids.userId]);
  await pool.query(`UPDATE panels SET dialogue='[{"entity_id":null,"text":"hello","type":"speech","position":"top"}]' WHERE id=$1`,[ids.panelId]);
  const blocked=await instance.getGenerationReadiness(ids.userId,ids.pageId);
  expect(blocked.ready).toBe(false);
  expect(blocked.blockers.map(blocker=>blocker.code)).toContain('INSUFFICIENT_CREDITS');
  expect(blocked.blockers.map(blocker=>blocker.code)).toContain('DIALOGUE_SPEAKER_REQUIRED');
  expect(await state(ids)).toMatchObject({credits:2,jobs:0,debits:0});
  expect((await pool.query('SELECT id FROM generation_quotes WHERE user_id=$1',[ids.userId])).rows).toEqual([]);
  expect(await rejectionOf(instance.getGenerationReadiness(randomUUID(),ids.pageId))).toMatchObject({code:'NOT_FOUND'});
 });

 it('参照不要のobjectに画像がなくてもmodel互換blockerを誤って追加しない',async()=>{
  const ids=await fixture();const objectId=randomUUID();
  await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name) VALUES($1,$2,$3,'object','sword')",[objectId,ids.workId,ids.userId]);
  await pool.query('UPDATE panels SET entities=$2::jsonb WHERE id=$1',[ids.panelId,JSON.stringify([{
   entity_id:objectId,role:'primary',expression:'calm',custom_expression:null,action:'standing_firm',custom_action:null,
   position:'center',facing_direction:null,effect_note:null,state_id:null,
  }])]);

  const readiness=await service().getGenerationReadiness(ids.userId,ids.pageId);
  expect(readiness.ready).toBe(true);
  expect(readiness.blockers.map(blocker=>blocker.code)).not.toContain('CHARACTER_REFERENCE_MODEL_INCOMPATIBLE');
 });

 it('割当characterのHy4 primaryはblockしGPT primary再confirmで履歴を残したまま回復する',async()=>{
  const ids=await fixture();const entityId=randomUUID();
  await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name) VALUES($1,$2,$3,'character','hero')",[entityId,ids.workId,ids.userId]);
  const hy4={ref_id:'hy4',s3_key:`saved/${ids.userId}/entities/${entityId}/hy4.png`,cdn_url:'https://example.invalid/hy4.png',source:'generated',created_at:'2026-01-01T00:00:00Z',image_model:'hy4-preview',provider_model_id:'hy4-preview',provider:'tencent'};
  await pool.query("INSERT INTO reference_sets(entity_id,reference_images,primary_ref_id,status) VALUES($1,$2::jsonb,'hy4','ready')",[entityId,JSON.stringify([hy4])]);
  await pool.query('UPDATE panels SET entities=$2::jsonb WHERE id=$1',[ids.panelId,JSON.stringify([{
   entity_id:entityId,role:'primary',expression:'calm',custom_expression:null,action:'standing_firm',custom_action:null,
   position:'center',facing_direction:null,effect_note:null,state_id:null,
  }])]);

  const blocked=await service().getGenerationReadiness(ids.userId,ids.pageId);
  expect(blocked.blockers).toContainEqual(expect.objectContaining({
   code:'CHARACTER_REFERENCE_MODEL_INCOMPATIBLE',entityId,
  }));

  const gpt={...hy4,ref_id:'gpt',s3_key:`saved/${ids.userId}/entities/${entityId}/gpt.png`,cdn_url:'https://example.invalid/gpt.png',image_model:'gpt-image-2',provider_model_id:'gpt-image-2',provider:'openai'};
  await pool.query("UPDATE reference_sets SET reference_images=$2::jsonb,primary_ref_id='gpt' WHERE entity_id=$1",[entityId,JSON.stringify([hy4,gpt])]);
  const restored=await service().getGenerationReadiness(ids.userId,ids.pageId);
  expect(restored.blockers.map(blocker=>blocker.code)).not.toContain('CHARACTER_REFERENCE_MODEL_INCOMPATIBLE');
  expect((await pool.query('SELECT jsonb_array_length(reference_images) AS count FROM reference_sets WHERE entity_id=$1',[entityId])).rows[0]).toEqual({count:2});
 });

 it('canonical base/旧note状態は重複せず確定variantのみ追加参照として保存課金する',async()=>{
  const ids=await fixture();const entityIds:string[]=[];
  for(let index=0;index<4;index++){
   const entity=randomUUID();entityIds.push(entity);
   await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name) VALUES($1,$2,$3,'character','reference character')",[entity,ids.workId,ids.userId]);
   await pool.query("INSERT INTO reference_sets(entity_id,reference_images,primary_ref_id,status) VALUES($1,$2::jsonb,'base','ready')",[entity,JSON.stringify([{ref_id:'base',s3_key:`saved/${ids.userId}/entities/${entity}/base.png`,cdn_url:'https://example.invalid/base.png',source:'upload',created_at:'2026-01-01T00:00:00Z'}])]);
  }
  const entityId=entityIds[0]!;const legacyId=randomUUID(),variantId=randomUUID();
  await pool.query("INSERT INTO entity_states(id,entity_id,costume_note) VALUES($1,$2,'legacy note')",[legacyId,entityId]);
  await pool.query("INSERT INTO entity_states(id,entity_id,name,description) VALUES($1,$2,'injured','Scar')",[variantId,entityId]);
  for(let index=2;index<=3;index++){
   const panelId=randomUUID();await pool.query('INSERT INTO panels(id,page_id,"order") VALUES($1,$2,$3)',[panelId,ids.pageId,index]);
   ids.input.panels.push({...ids.input.panels[0]!,id:panelId,order:index});ids.input.frames.push({...ids.input.frames[0]!,panelId,readingOrder:index});
  }
  const assignment=(entityId:string,stateId:string|null)=>({entityId,stateId,role:'primary' as const,expression:'calm' as const,customExpression:null,action:'standing_firm' as const,customAction:null,position:'center' as const,facingDirection:null,effectNote:null});
  ids.input.panels[0]!.entities=entityIds.map(id=>assignment(id,null));ids.input.panels[1]!.entities=[assignment(entityId,legacyId)];ids.input.panels[2]!.entities=[assignment(entityId,variantId)];
  expect(await rejectionOf(service().saveAndGenerate(ids.userId,ids.pageId,ids.input))).toMatchObject({code:'VALIDATION_ERROR'});
  expect(await state(ids)).toMatchObject({scene:'before',credits:30,jobs:0,debits:0});
  const image={ref_id:'injured-image',s3_key:`saved/${ids.userId}/entities/${entityId}/states/${variantId}/injured-image.png`,storage_owner_user_id:ids.userId,image_model:'gpt-image-2',base_ref_id:'base',created_at:'2026-01-01T00:00:00Z',input_fingerprint:computeStateReferenceFingerprint({entityId,stateId:variantId,name:'injured',description:'Scar',baseRefId:'base'})};
  await pool.query('UPDATE entity_states SET reference_image=$2::jsonb WHERE id=$1',[variantId,JSON.stringify(image)]);
  const saved=await service().saveAndGenerate(ids.userId,ids.pageId,ids.input);
  const quote=(await pool.query('SELECT q.plan FROM generation_quotes q WHERE q.accepted_job_id=$1',[saved.jobId])).rows[0].plan;
  expect(quote).toMatchObject({referenceCount:5,amountCredits:5});
  expect(await state(ids)).toMatchObject({credits:25,jobs:1,debits:1});
  expect((await service().getGenerationReadiness(ids.userId,ids.pageId)).estimatedCreditCost).toBe(5);
 });
 it('退会開始後はdraft・job・debitを一切作らない',async()=>{
  const ids=await fixture();await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1',[ids.userId]);
  expect((await service().getGenerationReadiness(ids.userId,ids.pageId)).blockers.map(blocker=>blocker.code)).toContain('GENERATION_DISABLED');
  expect(await rejectionOf(service().saveAndGenerate(ids.userId,ids.pageId,ids.input))).toMatchObject({code:'CONFLICT'});
  expect(await state(ids)).toMatchObject({scene:'before',credits:30,jobs:0,debits:0});
 });

 it('法人保存はedit/generate権限を要求し法人残高だけ課金する',async()=>{
  const ids=await fixture();const organizationId=randomUUID();
  await pool.query("INSERT INTO organizations(id,name,created_by_user_id,status) VALUES($1,'atomic organization',$2,'active')",[organizationId,ids.userId]);
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status,joined_at) VALUES($1,$2,'viewer','active',NOW())",[organizationId,ids.userId]);
  await pool.query('INSERT INTO organization_credit_balances(organization_id,purchased_credits) VALUES($1,20)',[organizationId]);
  await pool.query('UPDATE works SET organization_id=$2 WHERE id=$1',[ids.workId,organizationId]);
  expect(await rejectionOf(service().saveAndGenerate(ids.userId,ids.pageId,ids.input,organizationId))).toMatchObject({code:'FORBIDDEN'});
  expect((await state(ids)).jobs).toBe(0);
  await pool.query("UPDATE organization_members SET role='editor' WHERE organization_id=$1",[organizationId]);
  const first=await service().saveAndGenerate(ids.userId,ids.pageId,ids.input,organizationId);
  expect(await service().saveAndGenerate(ids.userId,ids.pageId,ids.input,organizationId)).toEqual(first);
  expect((await pool.query('SELECT purchased_credits FROM organization_credit_balances WHERE organization_id=$1',[organizationId])).rows[0]).toEqual({purchased_credits:17});
  expect((await state(ids)).credits).toBe(30);
 });

 it.each([0,1,2])('legacy/quote/atomic競合順序%sでも一つだけadmitしdeadlockしない',async(rotation)=>{
  const ids=await fixture();const db=database();
  const quotes=new GenerationQuoteService({database:db,enabled:true,resolver:new PostgresGenerationQuotePlanResolver({imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:false})});
  const issued=await quotes.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
  const legacy=new PageGenerationService(new PostgresPageRepository(db),new PostgresEntityRepository(db),new PostgresGenerationJobRepository(db),new CreditService(new PostgresCreditRepository(db,db)),{enqueue:async()=>({messageId:'local-test-queue'})},new ModeSelector());
  const attempts=[()=>service().saveAndGenerate(ids.userId,ids.pageId,ids.input),()=>quotes.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID()),()=>legacy.enqueuePageGeneration(ids.userId,ids.pageId)];
  const ordered=[...attempts.slice(rotation),...attempts.slice(0,rotation)];
  const results=await Promise.allSettled(ordered.map(run=>run()));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(await state(ids)).toMatchObject({status:'generating',credits:27,jobs:1,debits:1});
 },15_000);

});
