import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import type { EpisodePagePlanApplyResult } from '../../src/domain/types/page.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { CreditService } from '../../src/services/credit/CreditService.js';
import { PostgresCreditRepository } from '../../src/repositories/CreditRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../../src/repositories/PageGenerationExecutionRepository.js';
import { PostgresEntityGenerationExecutionRepository } from '../../src/repositories/EntityGenerationExecutionRepository.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../src/repositories/EpisodePageSkeletonExecutionRepository.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresBillingRepository } from '../../src/repositories/BillingRepository.js';
import { PostgresSceneRepository } from '../../src/repositories/SceneRepository.js';
import { PostgresEpisodeExportJobRepository } from '../../src/repositories/EpisodeExportJobRepository.js';
import { attestProduction44RuntimeSchema } from '../../src/lib/production44RuntimeSchemaAttestation.js';
import { createCancelledGenerationSettlementRecoveryRepository } from '../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { CancelledGenerationSettlementRecoveryService } from '../../src/services/job/CancelledGenerationSettlementRecoveryService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const dbDescribe=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
const jobTypes=['page_generate','entity_generate','episode_story_autofill','episode_page_skeleton'] as const;
type OldJobType=typeof jobTypes[number];
interface Fixture {userId:string;pageId:string;episodeId:string;jobId:string;tokenId:string;}
interface OldPushRepository {
  claimPending(limit:number):Promise<Array<{userId:string;jobStatus:string}>>;
}
const planResult:EpisodePagePlanApplyResult={updatedPageCount:1,updatedPanelCount:4,updatedAssignmentCount:0,filledFieldCount:4,compilerUsed:true,compilerProvider:'openai',compilerModel:'test-model',compilerPromptVersion:'test-version',compilerError:null};
const provenance={imageModel:'gpt-image-2',provider:'openai' as const,providerModelId:'gpt-image-2'};

dbDescribe('実44の生成終端・retry・保存互換profile',()=>{
  let admin:Pool;let pool:Pool;let database:DatabaseClient&TransactionRunner;
  let OldPage:typeof PostgresPageRepository;
  let OldJobs:typeof PostgresGenerationJobRepository;
  let OldCredits:typeof PostgresCreditRepository;
  let OldCreditService:typeof CreditService;
  let OldPush:new(client:DatabaseClient,runner:TransactionRunner)=>OldPushRepository;
  const schema='production44_terminal_'+process.pid+'_'+Date.now();
  beforeAll(async()=>{
    expect(schema).toMatch(/^production44_terminal_[0-9]+_[0-9]+$/u);
    admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public -c idle_in_transaction_session_timeout=30000 -c statement_timeout=30000',max:8,connectionTimeoutMillis:5000});
    database=testDatabase(pool);
    const migrations=await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production44-pg18')}));
    expect(migrations).toHaveLength(44);
    const oldRoot=join(process.cwd(),'tests/fixtures/production44-pg18/old-runtime/runtime');
    // Five selected modules match observed image tokens. The remaining dependency
    // closure is pinned historical source, not a full deployed-image identity proof.
    const load=async(file:string):Promise<unknown>=>import(pathToFileURL(join(oldRoot,file)).href);
    OldPage=(await load('src/repositories/PageRepository.js') as {PostgresPageRepository:typeof PostgresPageRepository}).PostgresPageRepository;
    OldJobs=(await load('src/repositories/GenerationJobRepository.js') as {PostgresGenerationJobRepository:typeof PostgresGenerationJobRepository}).PostgresGenerationJobRepository;
    OldCredits=(await load('src/repositories/CreditRepository.js') as {PostgresCreditRepository:typeof PostgresCreditRepository}).PostgresCreditRepository;
    OldCreditService=(await load('src/services/credit/CreditService.js') as {CreditService:typeof CreditService}).CreditService;
    OldPush=(await load('src/repositories/PushNotificationOutboxRepository.js') as {PostgresPushNotificationOutboxRepository:typeof OldPush}).PostgresPushNotificationOutboxRepository;
  },120_000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});

  it('44 SQL再構築catalogをread-onlyで照合する',async()=>{expect(await attestProduction44RuntimeSchema(database)).toBe('production44_pg18_v1');});

  it('同じ履歴でもconsume guardを無効化した場合は候補として拒否する',async()=>{
    await pool.query('ALTER TABLE credit_ledger DISABLE TRIGGER generation_job_credit_consume_guard');
    try { await expect(attestProduction44RuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED'); }
    finally { await pool.query('ALTER TABLE credit_ledger ENABLE TRIGGER generation_job_credit_consume_guard'); }
  });

  it('旧stateの生成と更新がvariant列を必要とせず旧projectionへ戻せる',async()=>{
    const fixture=await createFixture('entity_generate');const entityId=randomUUID();
    await pool.query("INSERT INTO entities(id,user_id,work_id,entity_type,name) SELECT $1,$2,chapters.work_id,'character','QA' FROM episodes JOIN chapters ON chapters.id=episodes.chapter_id WHERE episodes.id=$3",[entityId,fixture.userId,fixture.episodeId]);
    const scenes=new PostgresSceneRepository(database,'production44_pg18_v1');
    const state=await scenes.createEntityState(entityId,{sceneId:null,costumeNote:'old costume',costumeRefId:null,conditionNote:null,hairNote:null,expressionDefault:'neutral',extraNote:null},fixture.userId);
    expect((await scenes.updateEntityState(entityId,state.id,fixture.userId,{costumeNote:'candidate costume'}))?.costumeNote).toBe('candidate costume');
    expect((await pool.query('SELECT costume_note FROM entity_states WHERE id=$1',[state.id])).rows[0]?.costume_note).toBe('candidate costume');
    expect(await scenes.updateEntityState(entityId,state.id,randomUUID(),{costumeNote:'foreign'})).toBeNull();
    await expect(scenes.updateEntityState(entityId,state.id,fixture.userId,{name:'unsupported'})).rejects.toBeInstanceOf(Error);
  });

  it('現行export relationでqueue・lease奪取・heartbeat・完了とscope拒否が成立する',async()=>{
    const fixture=await createFixture('page_generate');const exports=new PostgresEpisodeExportJobRepository(database,database);
    const input={userId:fixture.userId,organizationId:null,episodeId:fixture.episodeId,pageIds:[fixture.pageId],format:'pdf' as const,filename:'QA.pdf',requestFingerprint:'a'.repeat(64),idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000)};
    const created=await exports.createOrGet(input);
    expect((await exports.createOrGet(input)).created).toBe(false);
    expect(await exports.findUndispatchedForJob(created.job.id)).not.toBeNull();
    expect(await exports.findForScope({jobId:created.job.id,userId:randomUUID(),organizationId:null})).toBeNull();
    const first=randomUUID(),second=randomUUID();
    expect(await exports.claim({jobId:created.job.id,leaseToken:first,leaseDurationSeconds:60,maxAttempts:3})).not.toBeNull();
    await pool.query("UPDATE episode_export_jobs SET created_at=NOW()-INTERVAL '3 minutes',started_at=NOW()-INTERVAL '2 minutes',last_heartbeat_at=NOW()-INTERVAL '2 minutes',processing_lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[created.job.id]);
    expect(await exports.claim({jobId:created.job.id,leaseToken:second,leaseDurationSeconds:60,maxAttempts:3})).not.toBeNull();
    expect(await exports.heartbeat({jobId:created.job.id,leaseToken:first,leaseDurationSeconds:60})).toBe(false);
    expect(await exports.heartbeat({jobId:created.job.id,leaseToken:second,leaseDurationSeconds:60})).toBe(true);
    expect(await exports.complete({jobId:created.job.id,leaseToken:second,artifactS3Key:`exports/${fixture.userId}/episodes/${fixture.episodeId}/${created.job.id}.pdf`,artifactMimeType:'application/pdf',artifactSizeBytes:123})).toBe(true);
    expect((await exports.findForScope({jobId:created.job.id,userId:fixture.userId,organizationId:null}))?.status).toBe('completed');
  });

  // Old-shaped SQL represents the pinned physical contract, not proof of the deployed binary.
  it('旧writerの物理metadataを読みcandidate変更を旧projectionが読めて画像を維持する',async()=>{
    const fixture=await createFixture('page_generate');
    await pool.query("UPDATE pages SET story_page_purpose='old physical',layout_config='{\"story_page_purpose\":\"stale JSON\"}' WHERE id=$1",[fixture.pageId]);
    const pages=new PostgresPageRepository(database,'production44_pg18_v1');
    expect((await pages.findPageByIdAndUserId(fixture.pageId,fixture.userId))?.storyPagePurpose).toBe('old physical');
    expect((await pages.findPromptContextByIdAndUserId(fixture.pageId,fixture.userId))?.storyPagePurpose).toBe('old physical');
    expect(await pages.findEpisodePlanningContextByIdAndUserId(fixture.episodeId,fixture.userId)).not.toBeNull();
    await pages.updatePageSettings(fixture.pageId,fixture.userId,{storyPagePurpose:'candidate physical'});
    expect((await pool.query('SELECT story_page_purpose,generated_image FROM pages WHERE id=$1',[fixture.pageId])).rows[0]).toEqual({story_page_purpose:'candidate physical',generated_image:{s3_key:'test/previous-saved.png'}});
    expect(await pages.updatePageSettings(fixture.pageId,randomUUID(),{storyPagePurpose:'foreign'})).toBeNull();
    expect((await new PostgresStoryRepository(database,database,'production44_pg18_v1').updateEpisode(fixture.episodeId,fixture.userId,{title:'compatible'}))?.title).toBe('compatible');
  });

  it('接続済みidentity keyと削除timestampがbilling/write fencingに有効である',async()=>{
    const fixture=await createFixture('entity_generate');
    await pool.query("UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1",[fixture.userId]);
    const billing=await new PostgresBillingRepository(database,database,'production44_pg18_v1').findBillingUserProfile(fixture.userId);
    expect(billing?.accountDeleted).toBe(true);
    await expect(pool.query("INSERT INTO generation_jobs(user_id,job_type,status,credit_cost,params) VALUES($1,'entity_generate','queued',0,'{}')",[fixture.userId])).rejects.toBeInstanceOf(Error);
    const deletion=new PostgresAccountDeletionRepository(database,database,'production44_pg18_v1');
    expect(await deletion.hasBlockedIdentityKey('synthetic-key')).toBe(false);
    await expect(deletion.hasBlockedIdentity({identityId:fixture.userId,identityKey:null})).rejects.toBeInstanceOf(Error);
  });

  it.each(jobTypes)('%sの完了をapplicationで一回だけ通知し既存job形式で読める',async(jobType)=>{
    const fixture=await createFixture(jobType);await beginProcessing(fixture);
    expect(await complete(jobType,fixture)).toBe(true);
    const row=await readJob(fixture);expect(row.status).toBe('completed');
    expect(await countOutbox(fixture)).toBe(1);expect(await countDelivery(fixture)).toBe(1);
    if(jobType==='page_generate')expect((await pool.query('SELECT generated_image FROM pages WHERE id=$1',[fixture.pageId])).rows[0]?.generated_image).toMatchObject({s3_key:'test/pages/result.png',image_model:'gpt-image-2'});
    if(jobType==='entity_generate')expect(row.result).toMatchObject({structured_fields:{name:'QA character'},candidates:[{ref_id:'qa',s3_key:'test/entity.png'}]});
    if(jobType==='page_generate')await assertCompletionFails(fixture);
    else expect(await complete(jobType,fixture)).toBe(false);
    expect(await countOutbox(fixture)).toBe(1);
  });

  it.each(jobTypes)('%sの失敗が実44schemaで成立しduplicate settlementを増やさない',async(jobType)=>{
    const fixture=await createFixture(jobType);
    expect(await fail(jobType,fixture)).toBe(true);expect(await fail(jobType,fixture)).toBe(false);
    expect((await readJob(fixture)).status).toBe('failed');expect(await countOutbox(fixture)).toBe(1);expect(await countDelivery(fixture)).toBe(1);
  });

  it.each(['pending','processing','sent','dead'] as const)('retryは%s通知の未送信leaseだけを無効化し新しい世代へ一回通知する',async(status)=>{
    const fixture=await createFixture('entity_generate');const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect(await jobs.markFailed(fixture.jobId,'synthetic QA failure')).toBe(true);
    const lease=randomUUID();await pool.query(`UPDATE mobile_push_notification_deliveries
      SET status=$2,lease_token=CASE WHEN $2='processing' THEN $3::uuid ELSE NULL END,
          locked_at=CASE WHEN $2='processing' THEN NOW() ELSE NULL END,
          sent_at=CASE WHEN $2='sent' THEN NOW() ELSE NULL END,
          error_code=CASE WHEN $2='dead' THEN 'SYNTHETIC' ELSE NULL END,attempt_count=1,updated_at=NOW()
      WHERE outbox_id IN(SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1)`,[fixture.jobId,status,lease]);
    expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(true);expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(false);
    expect((await readJob(fixture)).retry_count).toBe(1);await beginProcessing(fixture);
    expect(await complete('entity_generate',fixture)).toBe(true);
    expect(await countOutbox(fixture)).toBe(2);expect(await countDelivery(fixture)).toBe(2);
    const prior=(await pool.query('SELECT d.status,d.lease_token FROM mobile_push_notification_deliveries d JOIN mobile_push_notification_outbox o ON o.id=d.outbox_id WHERE o.generation_job_id=$1 AND o.generation_retry_count=0',[fixture.jobId])).rows[0];
    expect(prior).toMatchObject(status==='pending'||status==='processing'?{status:'canceled',lease_token:null}:{status,lease_token:null});
  });

  it('取消要求済みjobをfailedへ書き換えず通知と保存画像を増やさない',async()=>{
    const fixture=await createFixture('page_generate');
    await pool.query('UPDATE generation_jobs SET cancel_requested_at=NOW(),cancel_requested_by=$2 WHERE id=$1',[fixture.jobId,fixture.userId]);
    expect(await fail('page_generate',fixture)).toBe(false);expect(await countOutbox(fixture)).toBe(0);
    expect((await readJob(fixture)).status).toBe('queued');
    expect((await pool.query('SELECT generated_image FROM pages WHERE id=$1',[fixture.pageId])).rows[0]?.generated_image).toEqual({s3_key:'test/previous-saved.png'});
  });

  it('jobの完了CASが失敗すると先行page更新もrollbackして保存画像を守る',async()=>{
    const fixture=await createFixture('page_generate');
    await assertCompletionFails(fixture);
    expect((await readJob(fixture)).status).toBe('queued');expect(await countOutbox(fixture)).toBe(0);
    expect((await pool.query('SELECT generated_image,status FROM pages WHERE id=$1',[fixture.pageId])).rows[0]).toEqual({generated_image:{s3_key:'test/previous-saved.png'},status:'editing'});
  });

  it('別userのfailは対象jobと通知を変更しない',async()=>{
    const fixture=await createFixture('entity_generate');
    expect(await new PostgresEntityGenerationExecutionRepository(database,'production44_pg18_v1').failEntityGeneration({jobId:fixture.jobId,userId:randomUUID(),errorMessage:'foreign'})).toBe(false);
    expect((await readJob(fixture)).status).toBe('queued');expect(await countOutbox(fixture)).toBe(0);
  });

  it('quote付きjobは旧retry経路へ混入させない',async()=>{
    const fixture=await createFixture('entity_generate');const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    await pool.query("UPDATE generation_jobs SET params=params||jsonb_build_object('quote_id',$2::text) WHERE id=$1",[fixture.jobId,randomUUID()]);
    expect(await jobs.markFailed(fixture.jobId,'QA')).toBe(true);
    expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(false);expect((await readJob(fixture)).retry_count).toBe(0);
  });

  it('有償queued取消と重複refundで元の月次・購入残高へ一度だけ戻る',async()=>{
    const fixture=await createFixture('entity_generate',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'QA charge',jobId:fixture.jobId});
    const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
    expect(await jobs.requestCancellation(fixture.jobId,fixture.userId)).toBeNull();
    expect((await readJob(fixture)).status).toBe('cancelled');
    await credits.refundCredits({userId:fixture.userId,amount:12,description:'duplicate QA refund',jobId:fixture.jobId});
    await assertRestoredCredits(fixture);expect(await countOutbox(fixture)).toBe(0);
  });

  it('取消後に届いたconsumeは038 guardで拒否し残高更新もrollbackする',async()=>{
    const fixture=await createFixture('entity_generate',12);const credits=await fundedCredits(fixture);
    const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
    await expect(credits.consumeCredits({userId:fixture.userId,cost:12,description:'late QA charge',jobId:fixture.jobId})).rejects.toBeInstanceOf(Error);
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId])).rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect((await pool.query('SELECT * FROM credit_ledger WHERE job_id=$1',[fixture.jobId])).rowCount).toBe(0);
    expect(await countOutbox(fixture)).toBe(0);
  });

  it('有償processing取消のfinalize再実行で画像と返還済残高を守る',async()=>{
    const fixture=await createFixture('page_generate',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'QA processing charge',jobId:fixture.jobId});
    await pool.query("UPDATE generation_jobs SET status='processing',started_at=NOW() WHERE id=$1",[fixture.jobId]);
    const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('processing');
    expect(await jobs.finalizeCancellation(fixture.jobId)).toBe(true);expect(await jobs.finalizeCancellation(fixture.jobId)).toBe(true);
    await assertRestoredCredits(fixture);expect(await countOutbox(fixture)).toBe(0);
    expect((await pool.query('SELECT generated_image FROM pages WHERE id=$1',[fixture.pageId])).rows[0]?.generated_image).toEqual({s3_key:'test/previous-saved.png'});
  });

  it('有償failed jobへの並行refundでledgerと残高を一度だけ戻す',async()=>{
    const fixture=await createFixture('entity_generate',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'QA fail charge',jobId:fixture.jobId});
    expect(await fail('entity_generate',fixture)).toBe(true);
    await Promise.all([credits.refundCredits({userId:fixture.userId,amount:12,description:'QA refund A',jobId:fixture.jobId}),credits.refundCredits({userId:fixture.userId,amount:12,description:'QA refund B',jobId:fixture.jobId})]);
    await assertRestoredCredits(fixture);expect(await countOutbox(fixture)).toBe(1);
  });

  it('実旧Page writerと候補writerの変更を双方向に読み保存画像を維持する',async()=>{
    const fixture=await createFixture('page_generate');const oldPages=new OldPage(database);const candidatePages=new PostgresPageRepository(database,'production44_pg18_v1');
    await pool.query('UPDATE pages SET generated_image=$2::jsonb WHERE id=$1',[fixture.pageId,JSON.stringify({s3_key:'test/previous-saved.png',cdn_url:null,generation_mode:null,generated_at:null})]);
    await oldPages.updatePageSettings(fixture.pageId,fixture.userId,{storyPagePurpose:'old module'});
    expect((await candidatePages.findPageByIdAndUserId(fixture.pageId,fixture.userId))?.storyPagePurpose).toBe('old module');
    await candidatePages.updatePageSettings(fixture.pageId,fixture.userId,{storyPagePurpose:'candidate module'});
    expect((await oldPages.findPageByIdAndUserId(fixture.pageId,fixture.userId))?.storyPagePurpose).toBe('candidate module');
    expect((await oldPages.findPageByIdAndUserId(fixture.pageId,fixture.userId))?.generatedImage?.s3Key).toBe('test/previous-saved.png');
  });

  it.each([true,false])('旧consume=%sの消費を旧新refundが並行精算しても一度だけ戻す',async(oldConsume)=>{
    const fixture=await createFixture('entity_generate',12);const candidateCredits=await fundedCredits(fixture);
    const oldCredits=new OldCreditService(new OldCredits(database,database));
    await (oldConsume?oldCredits:candidateCredits).consumeCredits({userId:fixture.userId,cost:12,description:'mixed debit',jobId:fixture.jobId});
    await new PostgresGenerationJobRepository(database,'production44_pg18_v1').markFailed(fixture.jobId,'mixed failure');
    const input={userId:fixture.userId,amount:12,description:'mixed refund',jobId:fixture.jobId};
    await Promise.all([oldCredits.refundCredits(input),candidateCredits.refundCredits(input)]);
    await assertRestoredCredits(fixture);
  });

  it('旧job writerの失敗を候補が読みretryし候補jobを旧readerが読める',async()=>{
    const fixture=await createFixture('entity_generate');const oldJobs=new OldJobs(database);const candidateJobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect(await oldJobs.markFailed(fixture.jobId,'old failure')).toBe(true);
    expect((await candidateJobs.findByIdAndUserId(fixture.jobId,fixture.userId))?.status).toBe('failed');
    expect(await candidateJobs.prepareRetry(fixture.jobId,2)).toBe(true);
    expect((await oldJobs.findByIdAndUserId(fixture.jobId,fixture.userId))?.retryCount).toBe(1);
    expect(await candidateJobs.markFailed(fixture.jobId,'candidate failure')).toBe(true);
    expect((await oldJobs.findByIdAndUserId(fixture.jobId,fixture.userId))?.status).toBe('failed');
  });

  it('旧取消後の候補再精算が残高を一度だけ復元する',async()=>{
    const fixture=await createFixture('episode_story_autofill',12);await fundedCredits(fixture);
    const oldCredits=new OldCreditService(new OldCredits(database,database));
    await oldCredits.consumeCredits({userId:fixture.userId,cost:12,description:'old cancellation debit',jobId:fixture.jobId});
    expect((await new OldJobs(database).requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
    const lockQueries:string[]=[];
    const tracked:DatabaseClient&TransactionRunner={query:database.query,transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>=>database.transaction(client=>work({query:async<R extends QueryResultRow>(sql:string,values?:readonly unknown[])=>{lockQueries.push(sql);return client.query<R>(sql,values);}}))};
    const candidateJobs=new PostgresGenerationJobRepository(tracked,'production44_pg18_v1');
    expect(await candidateJobs.finalizeCancellation(fixture.jobId)).toBe(true);
    expect(await candidateJobs.finalizeCancellation(fixture.jobId)).toBe(true);
    await assertRestoredCredits(fixture);
    const balanceLock=lockQueries.findIndex(sql=>sql.includes('FROM credit_balances')&&sql.includes('FOR UPDATE'));
    const jobLock=lockQueries.findIndex(sql=>sql.includes('FROM generation_jobs')&&sql.includes('FOR UPDATE'));
    expect(balanceLock).toBeGreaterThanOrEqual(0);expect(jobLock).toBeGreaterThan(balanceLock);
  });

  it('processing候補を旧writerがcancelledにした場合も同じidentityだけ精算する',async()=>{
    const fixture=await createFixture('episode_story_autofill',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'processing debit',jobId:fixture.jobId});
    await pool.query("UPDATE generation_jobs SET status='processing',started_at=NOW(),cancel_requested_at=NOW(),cancel_requested_by=$2 WHERE id=$1",[fixture.jobId,fixture.userId]);
    const raced:DatabaseClient&TransactionRunner={transaction:database.transaction,query:async<R extends QueryResultRow>(sql:string,values?:readonly unknown[])=>{
      const result=await database.query<R>(sql,values);
      if(sql==='SELECT * FROM generation_jobs WHERE id = $1::uuid')expect(await new OldJobs(database).finalizeCancellation(fixture.jobId)).toBe(true);
      return result;
    }};
    expect(await new PostgresGenerationJobRepository(raced,'production44_pg18_v1').finalizeCancellation(fixture.jobId)).toBe(true);
    await assertRestoredCredits(fixture);
  });

  it('無料取消の再精算はledgerを作らずcompletedは変更しない',async()=>{
    const free=await createFixture('episode_story_autofill');const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    await new OldJobs(database).requestCancellation(free.jobId,free.userId);
    expect(await jobs.finalizeCancellation(free.jobId)).toBe(true);
    expect((await pool.query('SELECT * FROM credit_ledger WHERE job_id=$1',[free.jobId])).rowCount).toBe(0);
    const completed=await createFixture('episode_story_autofill');await beginProcessing(completed);await complete('episode_story_autofill',completed);
    expect(await jobs.finalizeCancellation(completed.jobId)).toBe(false);
    expect((await readJob(completed)).status).toBe('completed');
  });

  it('取消再精算時に期限切れとなった月次分は購入枠へ一回だけ戻す',async()=>{
    const fixture=await cancelledOldJob();
    await pool.query("UPDATE credit_balances SET monthly_expires_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",[fixture.userId]);
    const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');await jobs.finalizeCancellation(fixture.jobId);await jobs.finalizeCancellation(fixture.jobId);
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId])).rows[0]).toEqual({monthly_credits:0,purchased_credits:30});
    expect((await pool.query("SELECT amount,monthly_delta,purchased_delta FROM credit_ledger WHERE job_id=$1 AND type='refund'",[fixture.jobId])).rows).toEqual([{amount:12,monthly_delta:0,purchased_delta:12}]);
  });

  it('取消再精算と旧refundが並行してもbalanceとledgerを一回だけ復元する',async()=>{
    const fixture=await cancelledOldJob();const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    const oldCredits=new OldCreditService(new OldCredits(database,database));
    await Promise.all([jobs.finalizeCancellation(fixture.jobId),jobs.finalizeCancellation(fixture.jobId),oldCredits.refundCredits({userId:fixture.userId,amount:12,description:'old concurrent refund',jobId:fixture.jobId})]);
    await assertRestoredCredits(fixture);
    expect(await countOutbox(fixture)).toBe(0);
  });

  it('法人取消再精算は同じ法人の残高だけ戻し個人残高を変更しない',async()=>{
    const fixture=await createFixture('episode_story_autofill',12);await fundedCredits(fixture);const orgId=randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'mixed QA',$2)",[orgId,fixture.userId]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')",[orgId,fixture.userId]);
    await pool.query("INSERT INTO organization_credit_balances(organization_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,0,18,NOW()+INTERVAL '1 day')",[orgId]);
    await pool.query('UPDATE generation_jobs SET organization_id=$2 WHERE id=$1',[fixture.jobId,orgId]);
    await pool.query("INSERT INTO credit_ledger(user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,'consume',-12,-10,-2,0,18,'old org debit',$3)",[fixture.userId,orgId,fixture.jobId]);
    expect((await new OldJobs(database).requestCancellation(fixture.jobId,fixture.userId,orgId))?.status).toBe('cancelled');
    const jobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    await Promise.all([jobs.finalizeCancellation(fixture.jobId),jobs.finalizeCancellation(fixture.jobId)]);
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM organization_credit_balances WHERE organization_id=$1',[orgId])).rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId])).rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect((await pool.query("SELECT COUNT(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='refund' AND organization_id=$2",[fixture.jobId,orgId])).rows[0]?.n).toBe(1);
    expect((await pool.query("SELECT COUNT(*)::int n FROM organization_audit_logs WHERE organization_id=$1 AND action='credit.refunded'",[orgId])).rows[0]?.n).toBe(1);
  });

  it.each(['active','failed','user','organization','type','retry','cost'] as const)('取消候補の%sがlock前に変わった場合は返還も状態変更もしない',async(change)=>{
    const fixture=await cancelledOldJob();const otherUser=randomUUID(),otherOrg=randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1::uuid,$1::text,$2)',[otherUser,otherUser+'@example.invalid']);
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'other QA',$2)",[otherOrg,otherUser]);
    const changes={active:"status='queued',cancel_requested_at=NULL,cancel_requested_by=NULL,cancelled_at=NULL,completed_at=NULL,retry_count=retry_count+1",failed:"status='failed',cancel_requested_at=NULL,cancel_requested_by=NULL,cancelled_at=NULL,error_message='changed'",user:'user_id=$2::uuid',organization:'organization_id=$2::uuid',type:"job_type='entity_generate'",retry:'retry_count=retry_count+1',cost:'credit_cost=13'};
    const raced:DatabaseClient&TransactionRunner={transaction:database.transaction,query:async<R extends QueryResultRow>(sql:string,values?:readonly unknown[])=>{
      const result=await database.query<R>(sql,values);
      if(sql==='SELECT * FROM generation_jobs WHERE id = $1::uuid')await pool.query('UPDATE generation_jobs SET '+changes[change]+' WHERE id=$1',[fixture.jobId,...(change==='user'?[otherUser]:change==='organization'?[otherOrg]:[])]);
      return result;
    }};
    expect(await new PostgresGenerationJobRepository(raced,'production44_pg18_v1').finalizeCancellation(fixture.jobId)).toBe(false);
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId])).rows[0]).toEqual({monthly_credits:0,purchased_credits:18});
    expect((await pool.query("SELECT COUNT(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='refund'",[fixture.jobId])).rows[0]?.n).toBe(0);
  });

  async function cancelledOldJob():Promise<Fixture>{
    const fixture=await createFixture('episode_story_autofill',12);await fundedCredits(fixture);
    await new OldCreditService(new OldCredits(database,database)).consumeCredits({userId:fixture.userId,cost:12,description:'old debit',jobId:fixture.jobId});
    expect((await new OldJobs(database).requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');return fixture;
  }

  it('旧terminal通知欠落と旧retry後の古い通知claimを再現し混在起動の未解決gateとして固定する',async()=>{
    const fixture=await createFixture('page_generate');const oldJobs=new OldJobs(database);
    expect(await oldJobs.markFailed(fixture.jobId,'old terminal')).toBe(true);
    expect(await countOutbox(fixture)).toBe(0);
    const candidateJobs=new PostgresGenerationJobRepository(database,'production44_pg18_v1');
    expect(await candidateJobs.prepareRetry(fixture.jobId,3)).toBe(true);
    expect(await candidateJobs.markFailed(fixture.jobId,'candidate terminal')).toBe(true);
    expect(await countOutbox(fixture)).toBe(1);
    expect(await oldJobs.prepareRetry(fixture.jobId,3)).toBe(true);
    // The old invalid-context sweep ignores available_at and emits a lowercase
    // error code rejected by actual44. Isolate that existing old-writer failure
    // before checking the independent stale-generation claim below.
    await expect(new OldPush(database,database).claimPending(100)).rejects.toMatchObject({constraint:'mobile_push_notification_deliveries_error_code_check'});
    await pool.query("UPDATE mobile_push_notification_deliveries d SET status='canceled',locked_at=NULL,lease_token=NULL,sent_at=NULL,error_code=NULL,updated_at=NOW() FROM mobile_push_notification_outbox o WHERE d.outbox_id=o.id AND o.user_id<>$1 AND d.status IN('pending','processing')",[fixture.userId]);
    const deliveries=await new OldPush(database,database).claimPending(100);
    expect(deliveries.find(delivery=>delivery.userId===fixture.userId)?.jobStatus).toBe('failed');
    expect((await readJob(fixture)).status).toBe('queued');
  });

  async function fundedCredits(fixture:Fixture):Promise<CreditService>{
    await pool.query('INSERT INTO credit_balances(user_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,10,20,NOW()+INTERVAL \'1 day\')',[fixture.userId]);
    return new CreditService(new PostgresCreditRepository(database,database));
  }
  async function assertRestoredCredits(fixture:Fixture):Promise<void>{
    expect((await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId])).rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect((await pool.query("SELECT type,SUM(amount)::int amount,COUNT(*)::int n FROM credit_ledger WHERE user_id=$1 AND job_id=$2 GROUP BY type ORDER BY type",[fixture.userId,fixture.jobId])).rows).toEqual([{type:'consume',amount:-12,n:1},{type:'refund',amount:12,n:1}]);
  }

  // Await real database work before a synchronous assertion. Bun's Vitest
  // compatibility matcher can leave a parameterized rejection unobserved.
  async function assertCompletionFails(fixture:Fixture):Promise<void>{
    let observedError:unknown;
    try { await complete('page_generate',fixture); }
    catch(error:unknown) { observedError=error; }
    expect(observedError).toBeInstanceOf(Error);
    if(!(observedError instanceof Error))throw new Error('Expected completion transaction to fail');
    expect(observedError.message).toContain('completion state');
  }
  async function createFixture(jobType:OldJobType,creditCost=0):Promise<Fixture>{
    const fixture={userId:randomUUID(),pageId:randomUUID(),episodeId:randomUUID(),jobId:randomUUID(),tokenId:randomUUID()};const workId=randomUUID();const chapterId=randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[fixture.userId,fixture.userId,fixture.userId+'@example.invalid']);
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'legacy terminal QA')",[workId,fixture.userId]);
    await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)',[chapterId,workId]);await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[fixture.episodeId,chapterId]);
    await pool.query("INSERT INTO pages(id,episode_id,page_number,status,generated_image) VALUES($1,$2,1,'editing',$3::jsonb)",[fixture.pageId,fixture.episodeId,JSON.stringify({s3_key:'test/previous-saved.png'})]);
    await pool.query("INSERT INTO mobile_push_tokens(id,user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id) VALUES($1,$2,$3,'android','ja',$4,$5,'test-v1')",[fixture.tokenId,fixture.userId,randomUUID(),fixture.tokenId.replaceAll('-','').repeat(2),'v1.'+'b'.repeat(16)+'.'+'c'.repeat(40)+'.'+'d'.repeat(22)]);
    await pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,generation_mode,credit_cost,params) VALUES($1,$2,$3,'queued','standard',$5,$4::jsonb)",[fixture.jobId,fixture.userId,jobType,JSON.stringify({page_id:fixture.pageId,episode_id:fixture.episodeId}),creditCost]);return fixture;
  }
  async function beginProcessing(fixture:Fixture):Promise<void>{await pool.query("UPDATE generation_jobs SET status='processing',started_at=NOW(),commit_started_at=NOW() WHERE id=$1",[fixture.jobId]);}
  async function readJob(fixture:Fixture):Promise<QueryResultRow>{return (await pool.query('SELECT * FROM generation_jobs WHERE id=$1',[fixture.jobId])).rows[0]!;}
  async function countOutbox(fixture:Fixture):Promise<number>{return (await pool.query('SELECT COUNT(*)::int n FROM mobile_push_notification_outbox WHERE generation_job_id=$1',[fixture.jobId])).rows[0]?.n as number;}
  async function countDelivery(fixture:Fixture):Promise<number>{return (await pool.query('SELECT COUNT(*)::int n FROM mobile_push_notification_deliveries WHERE outbox_id IN(SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1)',[fixture.jobId])).rows[0]?.n as number;}
  async function fail(jobType:OldJobType,fixture:Fixture):Promise<boolean>{
    const input={jobId:fixture.jobId,userId:fixture.userId,errorMessage:'synthetic QA failure'};
    if(jobType==='page_generate')return new PostgresPageGenerationExecutionRepository(database,'production44_pg18_v1').failPageGeneration(input);
    if(jobType==='entity_generate')return new PostgresEntityGenerationExecutionRepository(database,'production44_pg18_v1').failEntityGeneration(input);
    if(jobType==='episode_story_autofill')return new PostgresEpisodeStoryAutofillExecutionRepository(database,'production44_pg18_v1').failEpisodeStoryAutofill(input);
    return new PostgresEpisodePageSkeletonExecutionRepository(database,'production44_pg18_v1').failEpisodePageSkeleton(input);
  }
  async function complete(jobType:OldJobType,fixture:Fixture):Promise<boolean>{
    const identity={jobId:fixture.jobId,userId:fixture.userId};
    if(jobType==='page_generate')return new PostgresPageGenerationExecutionRepository(database,'production44_pg18_v1').completePageGeneration({...identity,...provenance,pageId:fixture.pageId,generationMode:'standard',requestKind:'initial',s3Key:'test/pages/result.png',cdnUrl:'https://example.invalid/result.png',generatedAt:new Date().toISOString(),costUsd:null,openaiRequestId:null,promptMetadata:{draftPrompt:'QA',compilerBrief:'QA',compiledPrompt:'QA',compiledPromptUsed:false,promptCompilerProvider:'none',compilerModel:null,compilerPromptVersion:null,compilerError:null}});
    if(jobType==='entity_generate')return new PostgresEntityGenerationExecutionRepository(database,'production44_pg18_v1').completeEntityGeneration({...identity,...provenance,structuredFields:{name:'QA character'},candidates:[{refId:'qa',s3Key:'test/entity.png',cdnUrl:'https://example.invalid/entity.png'}],compiledBrief:'QA',compiledPrompt:'QA',openaiRequestId:null,costUsd:null,compiledPromptUsed:false,promptCompilerProvider:'none',compilerModel:null,compilerPromptVersion:null,compilerError:null,imageParams:{quality:'medium',size:'1024x1024'},createdAt:new Date().toISOString()});
    if(jobType==='episode_story_autofill')return new PostgresEpisodeStoryAutofillExecutionRepository(database,'production44_pg18_v1').completeEpisodeStoryAutofill({...identity,result:planResult});
    return new PostgresEpisodePageSkeletonExecutionRepository(database,'production44_pg18_v1').completeEpisodePageSkeleton({...identity,result:{pagesCreated:1,panelsCreated:4,replacedExisting:false},storyPlanApplied:true,storyPlanResult:planResult});
  }
});
// Recovery has its own artificial schema so each bounded-window assertion is
// independent of the mixed-writer fixtures above. No recurring entrypoint is wired.
dbDescribe('実44の取消済み未返還job recovery',()=>{
  let admin:Pool,pool:Pool,database:DatabaseClient&TransactionRunner;
  const schema='production44_recovery_'+process.pid+'_'+Date.now();
  beforeAll(async()=>{
    expect(schema).toMatch(/^production44_recovery_[0-9]+_[0-9]+$/u);
    admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public -c statement_timeout=30000',max:8});database=testDatabase(pool);
    expect(await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production44-pg18')}))).toHaveLength(44);
  },120_000);
  beforeEach(async()=>{await pool.query('TRUNCATE users, organizations CASCADE');});
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});

  it.each(jobTypes.flatMap(type=>[false,true].map(organization=>({type,organization}))))('$type / organization=$organization の未返還だけを一度精算する',async({type,organization})=>{
    const fixture=await seed({type,organization});
    const service=await recovery();expect(await service.run()).toMatchObject({scanned:1,settled:1,failed:0});
    expect(await service.run()).toMatchObject({scanned:1,skipped:1,settled:0,wrapped:true});
    await restored(fixture);
    expect((await pool.query('SELECT * FROM mobile_push_notification_outbox')).rowCount).toBe(0);
  });

  it('未消費・返還済み・無料・active/failed/completedを精算対象へ渡さない',async()=>{
    const noConsume=await seed({consume:false});const refunded=await seed({refund:true});
    await seed({cost:0,consume:false});await seed({status:'queued'});await seed({status:'processing'});await seed({status:'failed'});await seed({status:'completed'});
    const repository=await createCancelledGenerationSettlementRecoveryRepository(database,'production44_pg18_v1');
    const rows=await repository.scanBatch({afterId:null,limit:100});
    expect(rows.map(row=>row.jobId).sort()).toEqual([noConsume.jobId,refunded.jobId].sort());
    expect(rows.every(row=>!row.needsSettlement)).toBe(true);
    const service=await recovery();expect(await service.run()).toMatchObject({scanned:2,settled:0,skipped:2});
  });

  it.each([false,true])('organization=%s で別scopeのconsume/refundがnet debit判定へ混ざらない',async organization=>{
    const uncharged=await seed({organization,consume:false,status:'queued'});
    const charged=await seed({organization,status:'queued'});
    const foreign=await seed({organization:true,consume:false,status:'queued'});
    // Fault-inject historical inconsistent rows in this isolated fixture only.
    // Rollback restores the guard on failure; attestation below requires it enabled.
    await database.transaction(async client=>{
      await client.query('ALTER TABLE credit_ledger DISABLE TRIGGER generation_job_credit_consume_guard');
      for(const [target,type,amount] of [[uncharged,'consume',-12],[charged,'refund',100]] as const){
        await client.query("INSERT INTO credit_ledger(user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,$3,$4,0,$4,0,100,'foreign scope',$5)",[foreign.userId,foreign.organizationId,type,amount,target.jobId]);
        // Personal ledger under an organization job is foreign even for the actor.
        if(organization)await client.query("INSERT INTO credit_ledger(user_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,$3,0,$3,0,100,'foreign personal scope',$4)",[target.userId,type,amount,target.jobId]);
      }
      await client.query('ALTER TABLE credit_ledger ENABLE TRIGGER generation_job_credit_consume_guard');
    });
    for(const target of [uncharged,charged])await cancel(target.jobId);
    const repository=await createCancelledGenerationSettlementRecoveryRepository(database,'production44_pg18_v1');
    const rows=await repository.scanBatch({afterId:null,limit:100});
    expect(rows.find(row=>row.jobId===uncharged.jobId)?.needsSettlement).toBe(false);
    expect(rows.find(row=>row.jobId===charged.jobId)?.needsSettlement).toBe(true);
    expect(await (await recovery()).run()).toMatchObject({settled:1,skipped:1});
    await restored(charged);
  });

  it('keysetを返還済みとpoisonにも進め一回N件とwrap一回で後続を救済する',async()=>{
    const id=(n:number):string=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
    const poison=await seed({jobId:id(1)});const healthy=await seed({jobId:id(2)});await seed({jobId:id(3),consume:false});
    await pool.query('DELETE FROM credit_balances WHERE user_id=$1',[poison.userId]);
    const service=await recovery(1);
    expect(await service.run()).toMatchObject({scanned:1,failed:1});
    expect(await service.run()).toMatchObject({scanned:1,settled:1});await restored(healthy);
    expect(await service.run()).toMatchObject({scanned:1,skipped:1});
    expect(await service.run()).toMatchObject({scanned:1,failed:1,wrapped:true});
    expect((await pool.query("SELECT * FROM credit_ledger WHERE job_id=$1 AND type='refund'",[poison.jobId])).rowCount).toBe(0);
  });

  it('二つのrunnerと旧refundが並行してもrefund一件と保存残高を維持する',async()=>{
    const fixture=await seed({});const first=await recovery(),second=await recovery();
    const root=join(process.cwd(),'tests/fixtures/production44-pg18/old-runtime/runtime');
    const oldRepositoryModule=await import(pathToFileURL(join(root,'src/repositories/CreditRepository.js')).href) as {PostgresCreditRepository:typeof PostgresCreditRepository};
    const oldServiceModule=await import(pathToFileURL(join(root,'src/services/credit/CreditService.js')).href) as {CreditService:typeof CreditService};
    const oldCredits=new oldServiceModule.CreditService(new oldRepositoryModule.PostgresCreditRepository(database,database));
    await Promise.all([first.run(),second.run(),oldCredits.refundCredits({userId:fixture.userId,amount:12,description:'concurrent old refund',jobId:fixture.jobId})]);
    await restored(fixture);expect((await pool.query('SELECT * FROM mobile_push_notification_outbox')).rowCount).toBe(0);
  });

  it.each([false,true])('organization=%s のbucket不整合はfinalize=trueでもdeferredとなり後続を妨げない',async organization=>{
    const poison=await seed({organization,jobId:'00000000-0000-0000-0000-000000000011'});
    const healthy=await seed({organization,jobId:'00000000-0000-0000-0000-000000000012'});
    await pool.query("UPDATE credit_ledger SET monthly_delta=0,purchased_delta=0 WHERE job_id=$1 AND type='consume'",[poison.jobId]);
    // Existing finalization reports a terminal outcome even when inconsistent
    // buckets prevent a refund. Recovery must verify the remaining debit.
    expect(await new PostgresGenerationJobRepository(database,'production44_pg18_v1').finalizeCancellation(poison.jobId)).toBe(true);
    const service=await recovery(1);
    expect(await service.run()).toMatchObject({scanned:1,settled:0,deferred:1,failed:0});
    expect(await service.run()).toMatchObject({settled:1});await restored(healthy);
    expect(await service.run()).toMatchObject({settled:0,deferred:1,wrapped:true});
    expect((await pool.query("SELECT amount FROM credit_ledger WHERE job_id=$1 AND type='refund'",[poison.jobId])).rowCount).toBe(0);
  });

  it.each([false,true])('organization=%s の旧NULL bucketは既存fallback返還後に残額ゼロを確認する',async organization=>{
    const fixture=await seed({organization});
    await pool.query("UPDATE credit_ledger SET monthly_delta=NULL,purchased_delta=NULL WHERE job_id=$1 AND type='consume'",[fixture.jobId]);
    expect(await (await recovery()).run()).toMatchObject({settled:1,deferred:0});
    const row=await pool.query("SELECT SUM(amount)::int AS net FROM credit_ledger WHERE job_id=$1 AND type IN('consume','refund') AND organization_id IS NOT DISTINCT FROM $2::uuid",[fixture.jobId,fixture.organizationId]);
    expect(row.rows).toEqual([{net:0}]);
  });

  it('返還後の確認SQLが失敗しても成功とせず次行へ進み次周期に二重返還しない',async()=>{
    const first=await seed({jobId:'00000000-0000-0000-0000-000000000021'});
    const second=await seed({jobId:'00000000-0000-0000-0000-000000000022'});
    let fail=true;
    const faultDatabase:DatabaseClient&TransactionRunner={
      transaction:database.transaction,
      query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>{
        if(fail&&sql.includes('AND id = $1::uuid')&&values?.[0]===first.jobId){fail=false;throw new Error('private SQL failure');}
        return database.query<Row>(sql,values);
      },
    };
    const repository=await createCancelledGenerationSettlementRecoveryRepository(faultDatabase,'production44_pg18_v1');
    const service=new CancelledGenerationSettlementRecoveryService(repository,2);
    const result=await service.run();
    expect(result).toMatchObject({scanned:2,settled:1,failed:1});expect(JSON.stringify(result)).not.toContain('private');
    await restored(first);await restored(second);
    expect(await service.run()).toMatchObject({wrapped:true,settled:0,skipped:2,failed:0});
    await restored(first);
  });

  async function recovery(limit=100):Promise<CancelledGenerationSettlementRecoveryService>{
    const repository=await createCancelledGenerationSettlementRecoveryRepository(database,'production44_pg18_v1');
    return new CancelledGenerationSettlementRecoveryService(repository,limit);
  }
  interface RecoveryFixture{jobId:string;userId:string;organizationId:string|null;}
  async function seed(input:{type?:OldJobType;organization?:boolean;status?:'queued'|'processing'|'failed'|'completed';consume?:boolean;refund?:boolean;cost?:number;jobId?:string}):Promise<RecoveryFixture>{
    const fixture={jobId:input.jobId??randomUUID(),userId:randomUUID(),organizationId:input.organization?randomUUID():null};
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1::uuid,$1::text,$2)',[fixture.userId,fixture.userId+'@example.invalid']);
    if(fixture.organizationId!==null){await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'recovery QA',$2)",[fixture.organizationId,fixture.userId]);await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')",[fixture.organizationId,fixture.userId]);}
    await pool.query("INSERT INTO generation_jobs(id,user_id,organization_id,job_type,status,credit_cost,params) VALUES($1,$2,$3,$4,'queued',$5,'{}')",[fixture.jobId,fixture.userId,fixture.organizationId,input.type??'entity_generate',input.cost??12]);
    const consumed=input.consume!==false;
    const balance=consumed&&!input.refund?[0,18]:[10,20];
    if(fixture.organizationId===null)await pool.query("INSERT INTO credit_balances(user_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')",[fixture.userId,...balance]);
    else await pool.query("INSERT INTO organization_credit_balances(organization_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')",[fixture.organizationId,...balance]);
    if(consumed)await pool.query("INSERT INTO credit_ledger(user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,'consume',-12,-10,-2,0,18,'prior debit',$3)",[fixture.userId,fixture.organizationId,fixture.jobId]);
    if(input.refund)await pool.query("INSERT INTO credit_ledger(user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,'refund',12,10,2,10,20,'prior refund',$3)",[fixture.userId,fixture.organizationId,fixture.jobId]);
    if(input.status===undefined)await cancel(fixture.jobId);
    else if(input.status!=='queued')await pool.query("UPDATE generation_jobs SET status=$2,started_at=NOW(),completed_at=CASE WHEN $2 IN('failed','completed') THEN NOW() ELSE NULL END,error_message=CASE WHEN $2='failed' THEN 'prior failure' ELSE NULL END WHERE id=$1",[fixture.jobId,input.status]);
    return fixture;
  }
  async function cancel(jobId:string):Promise<void>{await pool.query("UPDATE generation_jobs SET status='cancelled',cancel_requested_at=NOW(),cancel_requested_by=user_id,cancelled_at=NOW(),completed_at=NOW() WHERE id=$1",[jobId]);}
  async function restored(fixture:RecoveryFixture):Promise<void>{
    const result=fixture.organizationId===null?await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId]):await pool.query('SELECT monthly_credits,purchased_credits FROM organization_credit_balances WHERE organization_id=$1',[fixture.organizationId]);
    expect(result.rows[0]).toEqual({monthly_credits:10,purchased_credits:20});
    expect((await pool.query("SELECT amount,monthly_delta,purchased_delta FROM credit_ledger WHERE job_id=$1 AND type='refund' AND organization_id IS NOT DISTINCT FROM $2::uuid",[fixture.jobId,fixture.organizationId])).rows).toEqual([{amount:12,monthly_delta:10,purchased_delta:2}]);
  }
});

function testDatabase(pool:Pool):DatabaseClient&TransactionRunner{
  return {query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>pool.query<Row>(text,values),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>)=>{
    const client=await pool.connect();try{await client.query('BEGIN');const value=await work({query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>client.query<Row>(text,values)});await client.query('COMMIT');return value;}catch(error:unknown){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}
