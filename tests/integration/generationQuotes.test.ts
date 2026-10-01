import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { GenerationQuoteService, hashQuoteToken } from '../../src/services/generation/GenerationQuoteService.js';
import { GenerationQuoteDispatcher } from '../../src/services/generation/GenerationQuoteDispatcher.js';
import { QuotedImportWorkerService } from '../../src/services/generation/QuotedImportWorkerService.js';
import { QuotedGenerationInputs } from '../../src/services/generation/QuotedGenerationInputs.js';
import { LayoutGuideImageRenderer } from '../../src/services/page/LayoutGuideImageRenderer.js';
import { PostgresQuotedImportExecutionRepository } from '../../src/repositories/QuotedImportExecutionRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresImageStorageReferenceRepository } from '../../src/repositories/ImageStorageReferenceRepository.js';
import type { EntityReferenceUploadStoragePort } from '../../src/services/entity/EntityReferenceUploadStorage.js';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import { PostgresGenerationQuotePlanResolver } from '../../src/repositories/GenerationQuotePlanResolver.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;

describePostgres('atomic generation quotes', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `generation_quotes_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 12 });
    database = testDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  function service(client = database): GenerationQuoteService {
    return new GenerationQuoteService({
      database: client,
      resolver: new PostgresGenerationQuotePlanResolver({ imageModel: 'gpt-image-2', generationEnabled: true, stateGenerationEnabled: true, importEnabled: true }),
      enabled: true,
    });
  }
  async function fixture(): Promise<{ userId: string; pageId: string; panelId: string; workId: string }> {
    const userId = randomUUID(); const workId = randomUUID(); const chapterId = randomUUID();
    const episodeId = randomUUID(); const pageId = randomUUID(); const panelId = randomUUID();
    await pool.query(`INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)`, [userId, userId, `${userId}@example.invalid`]);
    await pool.query(`INSERT INTO credit_balances (user_id,purchased_credits) VALUES ($1,30)`, [userId]);
    await pool.query(`INSERT INTO works (id,user_id,title) VALUES ($1,$2,'Quote fixture')`, [workId,userId]);
    await pool.query(`INSERT INTO chapters (id,work_id,"order") VALUES ($1,$2,1)`, [chapterId,workId]);
    await pool.query(`INSERT INTO episodes (id,chapter_id,"order") VALUES ($1,$2,1)`, [episodeId,chapterId]);
    await pool.query(`INSERT INTO pages (id,episode_id,page_number,status,layout_config) VALUES ($1,$2,1,'editing','{"type":"template","template_id":"splash_1"}')`, [pageId,episodeId]);
    await pool.query(`INSERT INTO panels (id,page_id,"order",situation_text) VALUES ($1,$2,1,'A quiet landscape')`, [panelId,pageId]);
    await pool.query(`INSERT INTO panel_frames (page_id,panel_id,vertices,reading_order) VALUES ($1,$2,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]',1)`, [pageId,panelId]);
    return { userId,pageId,panelId,workId };
  }
  async function money(userId: string): Promise<unknown> {
    const result = await pool.query(`SELECT purchased_credits, (SELECT count(*)::int FROM credit_ledger WHERE user_id=$1 AND type='consume') AS debits, (SELECT count(*)::int FROM generation_jobs WHERE user_id=$1) AS jobs FROM credit_balances WHERE user_id=$1`, [userId]);
    return result.rows[0];
  }
  it('見積を繰り返しても無課金で5分期限の現行料金を保存する', async () => {
    const ids = await fixture();
    for (let index=0; index<2; index++) {
      const result = await service().issue(ids.userId, { operation:'page_generate', targetId:ids.pageId });
      expect(result.quote.plan).toMatchObject({ amountCredits:3, referenceCount:0, imageModel:'gpt-image-2', quality:'medium', renderStyle:'color' });
      expect(result.quoteToken).toHaveLength(43);
      expect(result.quote.expiresAt.getTime()-Date.now()).toBeGreaterThan(290_000);
    }
    await expect(money(ids.userId)).resolves.toEqual({ purchased_credits:30, debits:0, jobs:0 });
  });
  it('同時・重複受付は1jobと1控除と1dispatchだけを保存し期限後もreceiptを返す', async () => {
    const ids = await fixture(); const instance=service(); const requestKey=randomUUID();
    const issued = await instance.issue(ids.userId, { operation:'page_generate', targetId:ids.pageId, renderStyle:'monochrome' });
    const receipts = await Promise.all(Array.from({length:4},()=>instance.accept(ids.userId,issued.quote.id,issued.quoteToken,requestKey)));
    expect(new Set(receipts.map((receipt)=>receipt.quote.acceptedJobId)).size).toBe(1);
    await expect(money(ids.userId)).resolves.toEqual({ purchased_credits:27,debits:1,jobs:1 });
    await pool.query(`UPDATE generation_quotes SET expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,[issued.quote.id]);
    const repeated=await instance.accept(ids.userId,issued.quote.id,issued.quoteToken,requestKey);
    expect(repeated.quote.acceptedJobId).toBe(receipts[0]?.quote.acceptedJobId);
    expect(await instance.receipt(ids.userId,issued.quote.id)).toMatchObject({ chargedCredits:3,refundedCredits:0,jobStatus:'queued' });
    expect((await pool.query(`SELECT dispatch_state FROM generation_quotes WHERE id=$1`,[issued.quote.id])).rows[0]).toEqual({dispatch_state:'pending'});
    expect((await pool.query(`SELECT params->>'render_style' AS style FROM generation_jobs WHERE id=$1`,[repeated.quote.acceptedJobId])).rows[0]).toEqual({style:'monochrome'});
  });
  it('内容変更・期限切れ・他人・異なるtokenは一切控除しない', async () => {
    const ids=await fixture(); const instance=service();
    const stale=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    await pool.query(`UPDATE panels SET situation_text='Changed' WHERE id=$1`,[ids.panelId]);
    await expect(instance.accept(ids.userId,stale.quote.id,stale.quoteToken,randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
    const expired=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    await pool.query(`UPDATE generation_quotes SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,[expired.quote.id]);
    await expect(instance.accept(ids.userId,expired.quote.id,expired.quoteToken,randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
    await expect(instance.accept(randomUUID(),stale.quote.id,stale.quoteToken,randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(instance.accept(ids.userId,stale.quote.id,'invalid-token',randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(money(ids.userId)).resolves.toEqual({purchased_credits:30,debits:0,jobs:0});
  });
  it('残高不足や最終receipt保存失敗はjob・控除・page変更をrollbackする', async () => {
    const ids=await fixture(); const instance=service();
    const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    await pool.query(`UPDATE credit_balances SET purchased_credits=2 WHERE user_id=$1`,[ids.userId]);
    await expect(instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID())).rejects.toMatchObject({code:'INSUFFICIENT_CREDITS'});
    await expect(money(ids.userId)).resolves.toEqual({purchased_credits:2,debits:0,jobs:0});
    await pool.query(`UPDATE credit_balances SET purchased_credits=30 WHERE user_id=$1`,[ids.userId]);
    const failing=testDatabase(pool, 'SET accepted_job_id');
    await expect(service(failing).accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID())).rejects.toThrow('Injected receipt failure');
    await expect(money(ids.userId)).resolves.toEqual({purchased_credits:30,debits:0,jobs:0});
    expect((await pool.query(`SELECT status FROM pages WHERE id=$1`,[ids.pageId])).rows[0]).toEqual({status:'editing'});
    expect((await instance.receipt(ids.userId,issued.quote.id)).quote.acceptedJobId).toBeNull();
  });

  it('queue受付不明は同じjobだけを再送し控除を繰り返さない', async () => {
    const ids=await fixture();const instance=service();
    const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    const accepted=await instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID());
    const sent:string[]=[];
    const dispatcher=new GenerationQuoteDispatcher(database,{enqueueJob:async(input)=>{
      sent.push(input.jobId);if(sent.length===1) throw new Error('Unknown queue acknowledgement');return {messageId:'verified-message'};
    }});
    await dispatcher.dispatchQuote(issued.quote.id);
    expect((await pool.query('SELECT dispatch_state FROM generation_quotes WHERE id=$1',[issued.quote.id])).rows[0]).toEqual({dispatch_state:'pending'});
    await pool.query('UPDATE generation_quotes SET dispatch_next_attempt_at=NOW() WHERE id=$1',[issued.quote.id]);
    await dispatcher.dispatchQuote(issued.quote.id);
    expect(sent).toEqual([accepted.quote.acceptedJobId,accepted.quote.acceptedJobId]);
    await expect(money(ids.userId)).resolves.toEqual({purchased_credits:27,debits:1,jobs:1});
  });

  it('受付後のコマ編集でも実行は承認済みsnapshotを使いモデル変更は拒否する', async () => {
    const ids=await fixture();const instance=service();
    const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    const accepted=await instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID());
    await pool.query(`UPDATE panels SET situation_text='Unapproved replacement' WHERE id=$1`,[ids.panelId]);
    await pool.query(`UPDATE pages SET layout_config='{}'::jsonb WHERE id=$1`,[ids.pageId]);
    const job=await new PostgresGenerationJobRepository(database).findByIdAndUserId(accepted.quote.acceptedJobId!,ids.userId);
    const loader={loadByS3Key:async()=>{throw new Error('No image expected');}};
    const inputs=await new QuotedGenerationInputs(database,'gpt-image-2',loader,new LayoutGuideImageRenderer()).page(job!);
    expect(inputs.prompt.draftPrompt).toContain('A quiet landscape');
    expect(inputs.prompt.draftPrompt).not.toContain('Unapproved replacement');
    expect(inputs.prompt.layoutControl?.templateId).toBe('splash_1');
    expect(inputs.inputImages.at(-1)?.role).toBe('layout_reference');
    expect(issued.quote.plan.referenceCount).toBe(0);
    expect(issued.quote.plan.amountCredits).toBe(3);
    expect(inputs.inputImages.at(-1)?.dataUrl).toBe(`data:image/png;base64,${new LayoutGuideImageRenderer().render(inputs.prompt.layoutControl!.frames,{numberFrames:true})!.imageData.toString('base64')}`);
    await expect(new QuotedGenerationInputs(database,'different-model',loader,new LayoutGuideImageRenderer()).page(job!)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
  });

  it('法人quoteは法人残高だけを控除しrole変更後の受付を拒否する', async () => {
    const ids=await fixture();const organizationId=randomUUID();
    await pool.query(`INSERT INTO organizations (id,name,created_by_user_id,status) VALUES ($1,'Quoted workspace',$2,'active')`,[organizationId,ids.userId]);
    await pool.query(`INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())`,[organizationId,ids.userId]);
    await pool.query(`INSERT INTO organization_credit_balances (organization_id,purchased_credits) VALUES ($1,20)`,[organizationId]);
    await pool.query('UPDATE works SET organization_id=$2 WHERE id=$1',[ids.workId,organizationId]);
    const instance=service();const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId},organizationId);
    await pool.query(`UPDATE organization_members SET role='viewer' WHERE organization_id=$1`,[organizationId]);
    await expect(instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID(),organizationId)).rejects.toMatchObject({code:'FORBIDDEN'});
    await pool.query(`UPDATE organization_members SET role='editor' WHERE organization_id=$1`,[organizationId]);
    const accepted=await instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID(),organizationId);
    expect(accepted).toMatchObject({chargedCredits:3,refundedCredits:0});
    expect((await pool.query('SELECT purchased_credits FROM organization_credit_balances WHERE organization_id=$1',[organizationId])).rows[0]).toEqual({purchased_credits:17});
    expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1',[ids.userId])).rows[0]).toEqual({purchased_credits:30});
  });

  async function addCharacter(userId:string,workId:string):Promise<string>{
    const entityId=randomUUID();
    await pool.query(`INSERT INTO entities (id,user_id,work_id,name,entity_type) VALUES ($1,$2,$3,'Quote character','character')`,[entityId,userId,workId]);
    await pool.query(`INSERT INTO reference_sets (entity_id,reference_images,primary_ref_id,status) VALUES ($1,$2::jsonb,'base','ready')`,
      [entityId,JSON.stringify([{ref_id:'base',s3_key:`saved/${userId}/entities/${entityId}/base.png`,cdn_url:'https://example.invalid/base.png',source:'upload',created_at:'2026-01-01T00:00:00Z'}])]);
    return entityId;
  }

  it('baseと状態previewは内容・確定base参照を固定して各1creditだけを控除する', async () => {
    const ids=await fixture();const entityId=await addCharacter(ids.userId,ids.workId);const stateId=randomUUID();
    await pool.query(`INSERT INTO entity_states (id,entity_id,name,description) VALUES ($1,$2,'injured','Scar on cheek')`,[stateId,entityId]);
    const instance=service();
    const base=await instance.issue(ids.userId,{operation:'entity_preview',targetId:entityId});
    const state=await instance.issue(ids.userId,{operation:'entity_state_preview',targetId:stateId,entityId});
    expect(base.quote.plan).toMatchObject({amountCredits:1,referenceCount:0});
    expect(state.quote.plan).toMatchObject({amountCredits:1,referenceCount:1});
    await pool.query(`UPDATE entity_states SET description='Changed injury' WHERE id=$1`,[stateId]);
    await expect(instance.accept(ids.userId,state.quote.id,state.quoteToken,randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
    const baseReceipt=await instance.accept(ids.userId,base.quote.id,base.quoteToken,randomUUID());
    expect(baseReceipt.chargedCredits).toBe(1);
    await new PostgresGenerationJobRepository(database).markFailed(baseReceipt.quote.acceptedJobId!,'Fixture completion');
    const freshState=await instance.issue(ids.userId,{operation:'entity_state_preview',targetId:stateId,entityId});
    const stateReceipt=await instance.accept(ids.userId,freshState.quote.id,freshState.quoteToken,randomUUID());
    expect(stateReceipt.chargedCredits).toBe(1);
    expect((await pool.query(`SELECT params->>'target' AS target,params->>'entity_state_id' AS state FROM generation_jobs WHERE id=$1`,[stateReceipt.quote.acceptedJobId])).rows[0]).toEqual({target:'entity_state',state:stateId});
  });

  it('同一画像の旧状態は重複課金せず別の確定状態画像だけ追加参照に数える', async () => {
    const ids=await fixture();const entityIds:string[]=[];
    for(let i=0;i<4;i++) entityIds.push(await addCharacter(ids.userId,ids.workId));
    const legacyStateId=randomUUID();const variantId=randomUUID();const entityId=entityIds[0]!;
    await pool.query(`INSERT INTO entity_states (id,entity_id,costume_note) VALUES ($1,$2,'Legacy note')`,[legacyStateId,entityId]);
    const assignments=entityIds.map((id)=>({entity_id:id,state_id:null as string|null,role:'primary' as const,expression:'calm',action:'standing_firm',position:'center'}));assignments.push({entity_id:entityId,state_id:legacyStateId,role:'primary' as const,expression:'calm',action:'standing_firm',position:'center'});
    await pool.query('UPDATE panels SET entities=$2::jsonb WHERE id=$1',[ids.panelId,JSON.stringify(assignments)]);
    expect((await service().issue(ids.userId,{operation:'page_generate',targetId:ids.pageId})).quote.plan).toMatchObject({referenceCount:4,amountCredits:4});
    const descriptor={ref_id:'injured-image',s3_key:`saved/${ids.userId}/entities/${entityId}/states/${variantId}/injured-image.png`,storage_owner_user_id:ids.userId,
      image_model:'gpt-image-2',base_ref_id:'base',created_at:'2026-01-01T00:00:00Z',input_fingerprint:computeStateReferenceFingerprint({entityId,stateId:variantId,name:'injured',description:'Scar',baseRefId:'base'})};
    await pool.query(`INSERT INTO entity_states (id,entity_id,name,description,reference_image) VALUES ($1,$2,'injured','Scar',$3::jsonb)`,[variantId,entityId,JSON.stringify(descriptor)]);
    assignments.push({entity_id:entityId,state_id:variantId,role:'primary' as const,expression:'calm',action:'standing_firm',position:'center'});
    await pool.query('UPDATE panels SET entities=$2::jsonb WHERE id=$1',[ids.panelId,JSON.stringify(assignments)]);
    expect((await service().issue(ids.userId,{operation:'page_generate',targetId:ids.pageId})).quote.plan).toMatchObject({referenceCount:5,amountCredits:5});
  });

  async function importFixture():Promise<{userId:string;instance:GenerationQuoteService;storage:EntityReferenceUploadStoragePort;request:{operation:'entity_import_analysis';uploadTokenHash:string;entityType:'object'};sourceKey:string}>{
    const ids=await fixture();const uploadId=randomUUID();const tokenHash=hashQuoteToken(randomUUID());
    const imageData=Buffer.from('89504e470d0a1a0a00000000','hex');const sourceKey=`tmp/${ids.userId}/entities/imports/${uploadId}.png`;
    await pool.query(`INSERT INTO entity_reference_upload_tokens (id,token_hash,user_id,purpose,mime_type,size_bytes,s3_key,expires_at)
      VALUES ($1,$2,$3,'entity_reference_import','image/png',$4,$5,NOW()+INTERVAL '10 minutes')`,[uploadId,tokenHash,ids.userId,imageData.length,sourceKey]);
    const storage:EntityReferenceUploadStoragePort={
      createPresignedPutUrl:async()=>{throw new Error('Unexpected presign');},
      loadUploadedImage:async()=>({imageData,mimeType:'image/png',eTag:'"source-v1"',cdnUrl:'https://example.invalid/source.png'}),
      stabilizeUploadedImage:async(input)=>({s3Key:input.destinationS3Key,cdnUrl:'https://example.invalid/stable.png'}),
    };
    return {userId:ids.userId,sourceKey,storage,request:{operation:'entity_import_analysis',uploadTokenHash:tokenHash,entityType:'object'},
      instance:new GenerationQuoteService({database,enabled:true,resolver:new PostgresGenerationQuotePlanResolver({imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true,uploadStorage:storage})})};
  }

  it('quoted importの同時受付・重複配信は1解析・1控除にし画像cleanup inventoryを保つ', async () => {
    const f=await importFixture();const issued=await f.instance.issue(f.userId,f.request);const key=randomUUID();
    const accepted=await Promise.all(Array.from({length:3},()=>f.instance.accept(f.userId,issued.quote.id,issued.quoteToken,key)));
    const jobId=accepted[0]!.quote.acceptedJobId!;let calls=0;
    const worker=new QuotedImportWorkerService(database,f.storage,{analyze:async()=>{calls++;return {suggestedFields:{category:'weapon'},promptSupplement:'A sword'};}});
    expect((await new PostgresAccountDeletionRepository(database,database).getFlight(f.userId)).activePersonalGenerationJobCount).toBe(1);
    await worker.processJob(jobId);await worker.processJob(jobId);
    expect(calls).toBe(1);
    expect((await new PostgresGenerationJobRepository(database).findByIdAndUserId(jobId,f.userId))?.errorMessage).toBeNull();
    await expect(money(f.userId)).resolves.toEqual({purchased_credits:29,debits:1,jobs:1});
    const receipt=await f.instance.receipt(f.userId,issued.quote.id);expect(receipt).toMatchObject({jobStatus:'completed',chargedCredits:1,refundedCredits:0});
    const copyKey=`tmp/${f.userId}/entities/imports/${jobId}.png`;
    expect((await new PostgresAccountDeletionRepository(database,database).getFlight(f.userId)).personalAssetKeys).toEqual(expect.arrayContaining([f.sourceKey,copyKey]));
    const protectedKeys=await new PostgresImageStorageReferenceRepository(database).findProtectedImageS3Keys({protectRecentCandidateHours:1});
    expect(protectedKeys.has(copyKey)).toBe(true);
    await pool.query(`UPDATE generation_jobs SET expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,[jobId]);
    expect((await new PostgresGenerationJobRepository(database).pruneExpiredTerminalJobs({dryRun:true,maxDeletes:100})).candidateIds).not.toContain(jobId);
  });

  it('quoted importの失敗・停止は1回だけ返金し勝手な再解析をしない', async () => {
    const f=await importFixture();const issued=await f.instance.issue(f.userId,f.request);
    const accepted=await f.instance.accept(f.userId,issued.quote.id,issued.quoteToken,randomUUID());const jobId=accepted.quote.acceptedJobId!;let calls=0;
    const worker=new QuotedImportWorkerService(database,f.storage,{analyze:async()=>{calls++;throw new Error('Provider refused');}});
    await worker.processJob(jobId);await worker.processJob(jobId);
    await new PostgresQuotedImportExecutionRepository(database).recoverExpired();
    expect(calls).toBe(1);
    await expect(f.instance.receipt(f.userId,issued.quote.id)).resolves.toMatchObject({jobStatus:'failed',chargedCredits:1,refundedCredits:1});
    expect(await new PostgresGenerationJobRepository(database).prepareRetry(jobId,3)).toBe(false);
    await expect(money(f.userId)).resolves.toEqual({purchased_credits:30,debits:1,jobs:1});

    const stopped=await importFixture();const stoppedQuote=await stopped.instance.issue(stopped.userId,stopped.request);
    const stoppedReceipt=await stopped.instance.accept(stopped.userId,stoppedQuote.quote.id,stoppedQuote.quoteToken,randomUUID());
    await pool.query(`UPDATE generation_jobs SET status='processing',started_at=NOW()-INTERVAL '25 minutes' WHERE id=$1`,[stoppedReceipt.quote.acceptedJobId]);
    await new PostgresQuotedImportExecutionRepository(database).recoverExpired();
    await new PostgresQuotedImportExecutionRepository(database).recoverExpired();
    await expect(stopped.instance.receipt(stopped.userId,stoppedQuote.quote.id)).resolves.toMatchObject({jobStatus:'failed',chargedCredits:1,refundedCredits:1});
  });

  it('import画像の見積後変更は課金前に拒否し受付後変更はprovider前に失敗返金する', async () => {
    const f=await importFixture();const issued=await f.instance.issue(f.userId,f.request);
    const load=f.storage.loadUploadedImage;
    f.storage.loadUploadedImage=async(input)=>{const image=await load(input);return image===null?null:{...image,eTag:'"changed"'};};
    await expect(f.instance.accept(f.userId,issued.quote.id,issued.quoteToken,randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
    await expect(money(f.userId)).resolves.toEqual({purchased_credits:30,debits:0,jobs:0});
    f.storage.loadUploadedImage=load;
    const accepted=await f.instance.accept(f.userId,issued.quote.id,issued.quoteToken,randomUUID());
    f.storage.loadUploadedImage=async(input)=>{const image=await load(input);return image===null?null:{...image,eTag:'"changed"'};};
    let calls=0;
    const worker=new QuotedImportWorkerService(database,f.storage,{analyze:async()=>{calls++;throw new Error('Must not run');}});
    expect(await worker.processJob(accepted.quote.acceptedJobId!)).toMatchObject({jobStatus:'failed'});
    expect(calls).toBe(0);
    await expect(f.instance.receipt(f.userId,issued.quote.id)).resolves.toMatchObject({chargedCredits:1,refundedCredits:1});
  });

  it('quote受付待機中の編集をlock後に検出して控除しない', async () => {
    const ids=await fixture();const instance=service();const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    const blocker=await pool.connect();
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM panels WHERE id=$1 FOR UPDATE',[ids.panelId]);
      const accepted=instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID());
      const state=await Promise.race([accepted.then(()=>'settled',()=>'settled'),new Promise<string>((resolve)=>setTimeout(()=>resolve('pending'),30))]);
      expect(state).toBe('pending');
      await blocker.query(`UPDATE panels SET situation_text='Changed while admission waited' WHERE id=$1`,[ids.panelId]);await blocker.query('COMMIT');
      await expect(accepted).rejects.toMatchObject({code:'CONFLICT'});
      await expect(money(ids.userId)).resolves.toEqual({purchased_credits:30,debits:0,jobs:0});
    }finally{await blocker.query('ROLLBACK');blocker.release();}
  });

  it('旧受付がcapacity lockを持つ場合もuser FKと新quoteでdeadlockしない', async () => {
    const ids=await fixture();const instance=service();const issued=await instance.issue(ids.userId,{operation:'page_generate',targetId:ids.pageId});
    const legacy=await pool.connect();
    try{
      await legacy.query('BEGIN');
      await legacy.query(`SELECT pg_advisory_xact_lock(81527,hashtext('generation_jobs:global'))`);
      const accepted=instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID());
      await new Promise<void>((resolve)=>setTimeout(resolve,30));
      await legacy.query(`INSERT INTO generation_jobs (user_id,job_type,status,credit_cost,params) VALUES ($1,'entity_generate','completed',0,'{}')`,[ids.userId]);
      await legacy.query('COMMIT');
      expect((await accepted).chargedCredits).toBe(3);
    }finally{await legacy.query('ROLLBACK');legacy.release();}
  });

  it('import候補からbase previewする場合は所有画像を固定し候補期限より長いquoteを発行しない', async () => {
    const ids=await fixture();const entityId=await addCharacter(ids.userId,ids.workId);
    const sourceKey=`tmp/${ids.userId}/entities/imports/${randomUUID()}.png`;
    let imageData=Buffer.from('89504e470d0a1a0a00000000','hex');
    const loader={loadByS3Key:async()=>({imageData,mimeType:'image/png' as const})};
    const instance=new GenerationQuoteService({database,enabled:true,resolver:new PostgresGenerationQuotePlanResolver({
      imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true,candidateImageLoader:loader,
    })});
    const expiresAt=Date.now()+60_000;
    const request={operation:'entity_preview' as const,targetId:entityId,sourceCandidate:{s3Key:sourceKey,expiresAt}};
    const issued=await instance.issue(ids.userId,request);
    expect(issued.quote.expiresAt.getTime()).toBe(expiresAt);
    expect(issued.quote.plan).toMatchObject({referenceCount:1,amountCredits:1});
    imageData=Buffer.from('89504e470d0a1a0a11111111','hex');
    await expect(instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
    await expect(money(ids.userId)).resolves.toEqual({purchased_credits:30,debits:0,jobs:0});
    imageData=Buffer.from('89504e470d0a1a0a00000000','hex');
    const accepted=await instance.accept(ids.userId,issued.quote.id,issued.quoteToken,randomUUID());
    const job=await new PostgresGenerationJobRepository(database).findByIdAndUserId(accepted.quote.acceptedJobId!,ids.userId);
    const inputs=new QuotedGenerationInputs(database,'gpt-image-2',loader,new LayoutGuideImageRenderer());
    expect((await inputs.entity(job!)).inputImages).toHaveLength(1);
    imageData=Buffer.from('89504e470d0a1a0a22222222','hex');
    await expect(inputs.entity(job!)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
    expect((await new PostgresAccountDeletionRepository(database,database).getFlight(ids.userId)).personalAssetKeys).toContain(sourceKey);
    expect((await new PostgresImageStorageReferenceRepository(database).findProtectedImageS3Keys({protectRecentCandidateHours:48})).has(sourceKey)).toBe(true);
  });
});

function testDatabase(pool: Pool, failSql?: string): DatabaseClient & TransactionRunner {
  return {
    query: <T extends QueryResultRow>(sql:string,values?:readonly unknown[]) => pool.query<T>(sql,values ? [...values] : undefined),
    transaction: async <T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T> => {
      const connection=await pool.connect();
      try {
        await connection.query('BEGIN');
        const result=await work({ query: async <R extends QueryResultRow>(sql:string,values?:readonly unknown[]) => {
          if (failSql && sql.includes(failSql)) throw new Error('Injected receipt failure');
          return connection.query<R>(sql,values ? [...values] : undefined);
        }});
        await connection.query('COMMIT'); return result;
      } catch(error) {await connection.query('ROLLBACK'); throw error;} finally {connection.release();}
    },
  };
}
