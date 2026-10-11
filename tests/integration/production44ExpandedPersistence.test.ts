import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations, runProduction44Expansion } from '../../src/lib/migrations.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { PostgresSceneRepository } from '../../src/repositories/SceneRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresGenerationQuotePlanResolver } from '../../src/repositories/GenerationQuotePlanResolver.js';
import { GenerationQuoteService, hashQuoteToken } from '../../src/services/generation/GenerationQuoteService.js';
import { createCancelledGenerationSettlementRecoveryRepository } from '../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { createTerminalGenerationNotificationRecoveryRepository } from '../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import { PageAtomicGenerationService } from '../../src/services/page/PageAtomicGenerationService.js';
import type { SaveAndGeneratePageInput } from '../../src/services/page/PageSaveAndGenerate.js';
import { PostgresPanelRepository } from '../../src/repositories/PanelRepository.js';
import { PostgresPanelFrameRepository } from '../../src/repositories/PanelFrameRepository.js';

import { QuotedImportWorkerService } from '../../src/services/generation/QuotedImportWorkerService.js';
import { QuotedGenerationInputs } from '../../src/services/generation/QuotedGenerationInputs.js';
import { LayoutGuideImageRenderer } from '../../src/services/page/LayoutGuideImageRenderer.js';
import type { EntityReferenceUploadStoragePort } from '../../src/services/entity/EntityReferenceUploadStorage.js';

const native = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const profile = 'production44_expanded_pg18_v1';
native('expanded54 persistence capabilities', () => {
  let admin: Pool, pool: Pool, database: DatabaseClient & TransactionRunner;
  const schema = 'expanded_persistence_' + randomUUID().replaceAll('-','');
  beforeAll(async () => {
    admin = new Pool({connectionString:process.env.DATABASE_URL});
    await admin.query('CREATE SCHEMA '+schema);
    pool = new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public',max:8});
    database = {query:pool.query.bind(pool),transaction:async work=>{
      const client=await pool.connect();
      try {await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }};
    await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production44-pg18')}));
    expect(await runProduction44Expansion(pool)).toHaveLength(10);
  },120_000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
  async function seed():Promise<{userId:string;workId:string;episodeId:string;pageId:string;entityId:string}> {
    const userId=randomUUID(),workId=randomUUID(),chapterId=randomUUID(),episodeId=randomUUID(),pageId=randomUUID(),panelId=randomUUID(),entityId=randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[userId,userId,userId+'@example.invalid']);
    await pool.query('INSERT INTO credit_balances(user_id,purchased_credits) VALUES($1,30)',[userId]);
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'expanded')",[workId,userId]);
    await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)',[chapterId,workId]);
    await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[episodeId,chapterId]);
    await pool.query(`INSERT INTO pages(id,episode_id,page_number,status,layout_config,story_page_purpose) VALUES($1,$2,1,'editing','{"type":"template","template_id":"splash_1"}','physical-marker-expanded')`,[pageId,episodeId]);
    await pool.query("INSERT INTO panels(id,page_id,\"order\",situation_text) VALUES($1,$2,1,'A quiet landscape')",[panelId,pageId]);
    await pool.query(`INSERT INTO panel_frames(page_id,panel_id,vertices,reading_order) VALUES($1,$2,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]',1)`,[pageId,panelId]);
    await pool.query("INSERT INTO entities(id,user_id,work_id,name) VALUES($1,$2,$3,'character')",[entityId,userId,workId]);
    return{userId,workId,episodeId,pageId,entityId};
  }
  function quotes():GenerationQuoteService {
    return new GenerationQuoteService({database,enabled:true,persistenceProfile:profile,
      resolver:new PostgresGenerationQuotePlanResolver({persistenceProfile:profile,imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true})});
  }
  it('direct保存の内部factoryがphysical列へ保存して同じsnapshotで一回だけ受付する',async()=>{
    const f=await seed();
    const pages=new PostgresPageRepository(database,profile);
    const page=await pages.findPageByIdAndUserId(f.pageId,f.userId);
    const panels=await new PostgresPanelRepository(database,profile).findPanelsByPageIdAndUserId(f.pageId,f.userId);
    const frames=await new PostgresPanelFrameRepository(database,profile).findFramesByPageIdAndUserId(f.pageId,f.userId);
    const input:SaveAndGeneratePageInput={expectedUpdatedAt:page!.updatedAt.toISOString(),requestId:randomUUID(),page:{storyPagePurpose:'direct physical saved'},renderStyle:'monochrome',language:'ja',panels,frames};
    const service=new PageAtomicGenerationService({database,persistenceProfile:profile,generationEnabled:true,
      resolver:new PostgresGenerationQuotePlanResolver({persistenceProfile:profile,imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true})});
    expect((await service.getGenerationReadiness(f.userId,f.pageId)).ready).toBe(true);
    const first=await service.saveAndGenerate(f.userId,f.pageId,input);
    expect(await service.saveAndGenerate(f.userId,f.pageId,input)).toEqual(first);
    expect((await pool.query('SELECT story_page_purpose FROM pages WHERE id=$1',[f.pageId])).rows[0].story_page_purpose).toBe('direct physical saved');
    expect(JSON.stringify((await pool.query('SELECT plan FROM generation_quotes WHERE accepted_job_id=$1',[first.jobId])).rows[0])).toContain('direct physical saved');
    expect((await pool.query("SELECT count(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type='consume'",[first.jobId])).rows[0].n).toBe(1);
  });
  it.each([false,true])('import jobのexpanded内部factoryが成功または失敗を一回だけ精算する failure=%s',async failure=>{
    const f=await seed(),uploadId=randomUUID(),tokenHash=hashQuoteToken(randomUUID());
    const imageData=Buffer.from('89504e470d0a1a0a00000000','hex');
    const sourceKey=`tmp/${f.userId}/entities/imports/${uploadId}.png`;
    await pool.query(`INSERT INTO entity_reference_upload_tokens(id,token_hash,user_id,purpose,mime_type,size_bytes,s3_key,expires_at) VALUES($1,$2,$3,'entity_reference_import','image/png',$4,$5,NOW()+INTERVAL '10 minutes')`,[uploadId,tokenHash,f.userId,imageData.length,sourceKey]);
    const storage:EntityReferenceUploadStoragePort={createPresignedPutUrl:async()=>{throw new Error('Unexpected presign');},loadUploadedImage:async()=>({imageData,mimeType:'image/png',eTag:'source-v1',cdnUrl:'https://example.invalid/source.png'}),stabilizeUploadedImage:async input=>({s3Key:input.destinationS3Key,cdnUrl:'https://example.invalid/stable.png'})};
    const service=new GenerationQuoteService({database,enabled:true,persistenceProfile:profile,resolver:new PostgresGenerationQuotePlanResolver({persistenceProfile:profile,imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true,uploadStorage:storage})});
    const issued=await service.issue(f.userId,{operation:'entity_import_analysis',uploadTokenHash:tokenHash,entityType:'object'});
    const accepted=await service.accept(f.userId,issued.quote.id,issued.quoteToken,randomUUID());let calls=0;
    const worker=new QuotedImportWorkerService(database,storage,{analyze:async()=>{calls++;if(failure)throw new Error('Artificial provider failure');return{suggestedFields:{category:'weapon'},promptSupplement:'A sword'};}},true,profile);
    await worker.processJob(accepted.quote.acceptedJobId!);await worker.processJob(accepted.quote.acceptedJobId!);
    expect(calls).toBe(1);
    expect(await service.receipt(f.userId,issued.quote.id)).toMatchObject({jobStatus:failure?'failed':'completed',chargedCredits:1,refundedCredits:failure?1:0});
    expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1',[f.userId])).rows[0].purchased_credits).toBe(failure?30:29);
  });
  it('physical page設定とvariant/starting stateを同profileで保存し他人を拒否する',async()=>{
    const f=await seed();const scenes=new PostgresSceneRepository(database,profile);
    const state=await scenes.createEntityState(f.entityId,{name:'rain',description:'wet coat',sceneId:null,costumeNote:null,costumeRefId:null,conditionNote:null,hairNote:null,expressionDefault:'neutral',extraNote:null},f.userId);
    expect(state.name).toBe('rain');
    await pool.query("INSERT INTO reference_sets(entity_id,reference_images,primary_ref_id,status) VALUES($1,$2::jsonb,'base','ready')",[f.entityId,JSON.stringify([{ref_id:'base',s3_key:`saved/${f.userId}/entities/${f.entityId}/base.png`,cdn_url:'https://example.invalid/base.png',source:'upload',created_at:'2026-01-01T00:00:00Z'}])]);
    await pool.query('UPDATE entity_states SET reference_image=$2::jsonb WHERE id=$1',[state.id,JSON.stringify({ref_id:'state-image',s3_key:`saved/${f.userId}/entities/${f.entityId}/state.png`,storage_owner_user_id:f.userId,image_model:'gpt-image-2',base_ref_id:'base',created_at:'2026-01-01T00:00:00Z',input_fingerprint:computeStateReferenceFingerprint({entityId:f.entityId,stateId:state.id,name:'rain',description:'wet coat',baseRefId:'base'})})]);
    const story=new PostgresStoryRepository(database,database,profile);
    const starting=[{entityId:f.entityId,stateId:state.id}];
    expect(await story.validateEpisodeStartingEntityStates(f.episodeId,f.userId,starting)).toBe(true);
    expect((await story.updateEpisode(f.episodeId,f.userId,{startingEntityStates:starting}))?.startingEntityStates).toEqual(starting);
    expect(await scenes.updateEntityState(f.entityId,state.id,randomUUID(),{name:'foreign'})).toBeNull();
    const pages=new PostgresPageRepository(database,profile);
    await pages.updatePageSettings(f.pageId,f.userId,{storyPagePurpose:'physical updated'});
    expect((await pool.query('SELECT story_page_purpose FROM pages WHERE id=$1',[f.pageId])).rows[0].story_page_purpose).toBe('physical updated');
    expect((await pages.findEpisodePlanningContextByIdAndUserId(f.episodeId,f.userId))?.episode.startingEntityStates).toEqual(starting);
  });
  it('quoteの内部factoryもphysical sourceを使い重複受付・取消・返還を一度に保つ',async()=>{
    const f=await seed(), service=quotes();
    const issued=await service.issue(f.userId,{operation:'page_generate',targetId:f.pageId});
    expect(JSON.stringify(issued.quote.plan)).toContain('physical-marker-expanded');
    const key=randomUUID();
    const [first,second]=await Promise.all([service.accept(f.userId,issued.quote.id,issued.quoteToken,key),service.accept(f.userId,issued.quote.id,issued.quoteToken,key)]);
    expect(second.quote.acceptedJobId).toBe(first.quote.acceptedJobId);
    const jobId=first.quote.acceptedJobId!;
    const jobs=new PostgresGenerationJobRepository(database,profile);
    const job=await jobs.findByIdAndUserId(jobId,f.userId);
    const inputs=await new QuotedGenerationInputs(database,'gpt-image-2',{loadByS3Key:async()=>{throw new Error('Unexpected stored image');}},new LayoutGuideImageRenderer(),profile).page(job!);
    expect(JSON.stringify(inputs.prompt)).toContain('physical-marker-expanded');
    expect((await jobs.requestCancellation(jobId,f.userId))?.status).toBe('cancelled');
    const recovery=await createCancelledGenerationSettlementRecoveryRepository(database,profile);
    expect(await recovery.settleAndVerify(jobId)).toBe(true);
    expect(await recovery.settleAndVerify(jobId)).toBe(true);
    expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1',[f.userId])).rows[0].purchased_credits).toBe(30);
    expect((await pool.query("SELECT count(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type='refund'",[jobId])).rows[0].n).toBe(1);
    const notifications=await createTerminalGenerationNotificationRecoveryRepository(database,profile);
    expect(await notifications.enqueueCurrentTerminal(jobId)).toBe('deferred');
    expect((await pool.query('SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1',[jobId])).rows).toEqual([]);
  });
});
