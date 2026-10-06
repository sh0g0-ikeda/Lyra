import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const dbDescribe=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
const jobTypes=['page_generate','entity_generate','episode_story_autofill','episode_page_skeleton'] as const;
type OldJobType=typeof jobTypes[number];
interface Fixture {userId:string;pageId:string;episodeId:string;jobId:string;tokenId:string;}
const planResult:EpisodePagePlanApplyResult={updatedPageCount:1,updatedPanelCount:4,updatedAssignmentCount:0,filledFieldCount:4,compilerUsed:true,compilerProvider:'openai',compilerModel:'test-model',compilerPromptVersion:'test-version',compilerError:null};
const provenance={imageModel:'gpt-image-2',provider:'openai' as const,providerModelId:'gpt-image-2'};

dbDescribe('旧38migrationの生成終端・retry互換profile',()=>{
  let admin:Pool;let pool:Pool;let database:DatabaseClient&TransactionRunner;
  const schema='legacy_terminal_'+process.pid+'_'+Date.now();
  beforeAll(async()=>{
    expect(schema).toMatch(/^legacy_terminal_[0-9]+_[0-9]+$/u);
    admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public -c idle_in_transaction_session_timeout=30000 -c statement_timeout=30000',max:8,connectionTimeoutMillis:5000});
    database=testDatabase(pool);
    const migrations=await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production-lineage-2debe')}));
    expect(migrations).toHaveLength(38);
  },120_000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});

  it.each(jobTypes)('%sの完了を旧triggerで一回だけ通知し既存job形式で読める',async(jobType)=>{
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

  it.each(jobTypes)('%sの失敗が旧schemaで成立しduplicate settlementを増やさない',async(jobType)=>{
    const fixture=await createFixture(jobType);
    expect(await fail(jobType,fixture)).toBe(true);expect(await fail(jobType,fixture)).toBe(false);
    expect((await readJob(fixture)).status).toBe('failed');expect(await countOutbox(fixture)).toBe(1);expect(await countDelivery(fixture)).toBe(1);
  });

  it.each(['pending','processing','sent','dead'] as const)('旧%s通知とleaseをretry後も変更せずcompletedへ移行する',async(status)=>{
    const fixture=await createFixture('entity_generate');const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
    expect(await jobs.markFailed(fixture.jobId,'synthetic QA failure')).toBe(true);
    const lease=randomUUID();await pool.query('UPDATE mobile_push_notification_deliveries SET status=$2,lease_token=$3,locked_at=NOW() WHERE outbox_id IN(SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1)',[fixture.jobId,status,lease]);
    expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(true);expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(false);
    expect((await readJob(fixture)).retry_count).toBe(1);await beginProcessing(fixture);
    expect(await complete('entity_generate',fixture)).toBe(true);
    expect(await countOutbox(fixture)).toBe(1);expect(await countDelivery(fixture)).toBe(1);
    expect((await pool.query('SELECT status,lease_token FROM mobile_push_notification_deliveries WHERE outbox_id IN(SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1)',[fixture.jobId])).rows[0]).toMatchObject({status,lease_token:lease});
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
    expect(await new PostgresEntityGenerationExecutionRepository(database,'legacy_2debe_v1').failEntityGeneration({jobId:fixture.jobId,userId:randomUUID(),errorMessage:'foreign'})).toBe(false);
    expect((await readJob(fixture)).status).toBe('queued');expect(await countOutbox(fixture)).toBe(0);
  });

  it('quote付きjobは旧retry経路へ混入させない',async()=>{
    const fixture=await createFixture('entity_generate');const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
    await pool.query("UPDATE generation_jobs SET params=params||jsonb_build_object('quote_id',$2::text) WHERE id=$1",[fixture.jobId,randomUUID()]);
    expect(await jobs.markFailed(fixture.jobId,'QA')).toBe(true);
    expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(false);expect((await readJob(fixture)).retry_count).toBe(0);
  });

  it('有償queued取消と重複refundで元の月次・購入残高へ一度だけ戻る',async()=>{
    const fixture=await createFixture('entity_generate',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'QA charge',jobId:fixture.jobId});
    const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
    expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
    expect(await jobs.requestCancellation(fixture.jobId,fixture.userId)).toBeNull();
    expect((await readJob(fixture)).status).toBe('cancelled');
    await credits.refundCredits({userId:fixture.userId,amount:12,description:'duplicate QA refund',jobId:fixture.jobId});
    await assertRestoredCredits(fixture);expect(await countOutbox(fixture)).toBe(0);
  });

  it('取消後に届いたconsumeを旧030triggerで同一tx返還し新refundが二重返還しない',async()=>{
    const fixture=await createFixture('entity_generate',12);const credits=await fundedCredits(fixture);
    const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
    expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'late QA charge',jobId:fixture.jobId});
    await credits.refundCredits({userId:fixture.userId,amount:12,description:'duplicate late QA refund',jobId:fixture.jobId});
    await assertRestoredCredits(fixture);expect(await countOutbox(fixture)).toBe(0);
  });

  it('有償processing取消のfinalize再実行で画像と返還済残高を守る',async()=>{
    const fixture=await createFixture('page_generate',12);const credits=await fundedCredits(fixture);
    await credits.consumeCredits({userId:fixture.userId,cost:12,description:'QA processing charge',jobId:fixture.jobId});
    await pool.query("UPDATE generation_jobs SET status='processing',started_at=NOW() WHERE id=$1",[fixture.jobId]);
    const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
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
    if(jobType==='page_generate')return new PostgresPageGenerationExecutionRepository(database,'legacy_2debe_v1').failPageGeneration(input);
    if(jobType==='entity_generate')return new PostgresEntityGenerationExecutionRepository(database,'legacy_2debe_v1').failEntityGeneration(input);
    if(jobType==='episode_story_autofill')return new PostgresEpisodeStoryAutofillExecutionRepository(database,'legacy_2debe_v1').failEpisodeStoryAutofill(input);
    return new PostgresEpisodePageSkeletonExecutionRepository(database,'legacy_2debe_v1').failEpisodePageSkeleton(input);
  }
  async function complete(jobType:OldJobType,fixture:Fixture):Promise<boolean>{
    const identity={jobId:fixture.jobId,userId:fixture.userId};
    if(jobType==='page_generate')return new PostgresPageGenerationExecutionRepository(database,'legacy_2debe_v1').completePageGeneration({...identity,...provenance,pageId:fixture.pageId,generationMode:'standard',requestKind:'initial',s3Key:'test/pages/result.png',cdnUrl:'https://example.invalid/result.png',generatedAt:new Date().toISOString(),costUsd:null,openaiRequestId:null,promptMetadata:{draftPrompt:'QA',compilerBrief:'QA',compiledPrompt:'QA',compiledPromptUsed:false,promptCompilerProvider:'none',compilerModel:null,compilerPromptVersion:null,compilerError:null}});
    if(jobType==='entity_generate')return new PostgresEntityGenerationExecutionRepository(database,'legacy_2debe_v1').completeEntityGeneration({...identity,...provenance,structuredFields:{name:'QA character'},candidates:[{refId:'qa',s3Key:'test/entity.png',cdnUrl:'https://example.invalid/entity.png'}],compiledBrief:'QA',compiledPrompt:'QA',openaiRequestId:null,costUsd:null,compiledPromptUsed:false,promptCompilerProvider:'none',compilerModel:null,compilerPromptVersion:null,compilerError:null,imageParams:{quality:'medium',size:'1024x1024'},createdAt:new Date().toISOString()});
    if(jobType==='episode_story_autofill')return new PostgresEpisodeStoryAutofillExecutionRepository(database,'legacy_2debe_v1').completeEpisodeStoryAutofill({...identity,result:planResult});
    return new PostgresEpisodePageSkeletonExecutionRepository(database,'legacy_2debe_v1').completeEpisodePageSkeleton({...identity,result:{pagesCreated:1,panelsCreated:4,replacedExisting:false},storyPlanApplied:true,storyPlanResult:planResult});
  }
});
function testDatabase(pool:Pool):DatabaseClient&TransactionRunner{
  return {query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>pool.query<Row>(text,values),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>)=>{
    const client=await pool.connect();try{await client.query('BEGIN');const value=await work({query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>client.query<Row>(text,values)});await client.query('COMMIT');return value;}catch(error:unknown){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}
