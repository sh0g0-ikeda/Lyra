import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresCreditRepository } from '../../src/repositories/CreditRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresOrganizationRepository } from '../../src/repositories/OrganizationRepository.js';
import { CreditService } from '../../src/services/credit/CreditService.js';
import { OrganizationService } from '../../src/services/organization/OrganizationService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
const dbDescribe=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
interface Fixture {userId:string;jobId:string;organizationId:string|null;}
/** Spec credit idempotency and first legacy settlement ownership: immutable
 * 030 trigger may convert an expired monthly refund into purchased credits. */
dbDescribe('旧triggerの期限切れ返還と新版の再精算',()=>{
 let admin:Pool;let pool:Pool;let database:DatabaseClient&TransactionRunner;
 const schema='legacy_expired_refund_'+process.pid+'_'+Date.now();
 beforeAll(async()=>{
  expect(schema).toMatch(/^legacy_expired_refund_[0-9]+_[0-9]+$/u);
  admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public -c idle_in_transaction_session_timeout=30000 -c statement_timeout=30000',max:8,connectionTimeoutMillis:5000});database=testDatabase(pool);
  expect(await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production-lineage-2debe')}))).toHaveLength(38);
 },120_000);
 afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
 it.each([false,true])('%s法人の旧030による返還後に新版が重複返還しても30crと一件台帳を保持する',async(organization)=>{
  const fixture=await createFixture(organization,'cancelled');await lateConsume(fixture);
  const input={amount:12,description:'retry after immutable trigger',jobId:fixture.jobId};
  if(fixture.organizationId===null){const service=new CreditService(new PostgresCreditRepository(database,database));await Promise.all([service.refundCredits({...input,userId:fixture.userId}),service.refundCredits({...input,userId:fixture.userId})]);}
  else{const service=new OrganizationService(new PostgresOrganizationRepository(database,database));await Promise.all([service.refundCredits({...input,organizationId:fixture.organizationId,actorUserId:fixture.userId}),service.refundCredits({...input,organizationId:fixture.organizationId,actorUserId:fixture.userId})]);}
  await assertSettlement(fixture);
 });
 it('失敗済み個人jobの返還後に旧retry形式で取消しても前回返還を重ねない',async()=>{
  const fixture=await createFixture(false,'failed');await lateConsume(fixture);
  const credits=new CreditService(new PostgresCreditRepository(database,database));await credits.refundCredits({userId:fixture.userId,amount:12,description:'expired failed generation',jobId:fixture.jobId});
  const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');expect(await jobs.prepareRetry(fixture.jobId,2)).toBe(true);
  expect((await jobs.requestCancellation(fixture.jobId,fixture.userId))?.status).toBe('cancelled');
  await assertSettlement(fixture);
 });
 it('法人queued取消が期限切れ月次を購入枠へ戻しauditとledgerを一件だけ残す',async()=>{
  const fixture=await createFixture(true,'queued');await lateConsume(fixture);
  const jobs=new PostgresGenerationJobRepository(database,'legacy_2debe_v1');
  expect((await jobs.requestCancellation(fixture.jobId,fixture.userId,fixture.organizationId))?.status).toBe('cancelled');
  expect(await jobs.requestCancellation(fixture.jobId,fixture.userId,fixture.organizationId)).toBeNull();
  await assertSettlement(fixture);
  expect((await pool.query("SELECT COUNT(*)::int n FROM organization_audit_logs WHERE organization_id=$1 AND action='credit.refunded'",[fixture.organizationId])).rows[0]?.n).toBe(1);
 });
 it.each([false,true])('%s法人の期限切れ部分返還を並行再開しても合計消費額を超えず購入枠へ戻る',async(organization)=>{
  const fixture=await createFixture(organization,'failed');await lateConsume(fixture);
  if(fixture.organizationId===null){
   const service=new CreditService(new PostgresCreditRepository(database,database));const input={userId:fixture.userId,amount:12,description:'remaining partial',jobId:fixture.jobId};
   await service.refundCredits({...input,amount:1});await Promise.all([service.refundCredits(input),service.refundCredits(input)]);
  }else{
   const service=new OrganizationService(new PostgresOrganizationRepository(database,database));const input={organizationId:fixture.organizationId,actorUserId:fixture.userId,amount:12,description:'remaining partial',jobId:fixture.jobId};
   await service.refundCredits({...input,amount:1});await Promise.all([service.refundCredits(input),service.refundCredits(input)]);
  }
  await assertSettlement(fixture,2);
  expect((await pool.query("SELECT amount,monthly_delta,purchased_delta FROM credit_ledger WHERE job_id=$1 AND type='refund' ORDER BY amount",[fixture.jobId])).rows).toEqual([{amount:1,monthly_delta:0,purchased_delta:1},{amount:11,monthly_delta:0,purchased_delta:11}]);
 });
 it('法人failedの初回返還で期限切れ月次を購入枠へ戻す',async()=>{
  const fixture=await createFixture(true,'failed');await lateConsume(fixture);
  if(fixture.organizationId===null)throw new Error('Expected organization fixture');
  const service=new OrganizationService(new PostgresOrganizationRepository(database,database));const input={organizationId:fixture.organizationId,actorUserId:fixture.userId,amount:12,description:'failed expired',jobId:fixture.jobId};
  await service.refundCredits(input);await service.refundCredits(input);await assertSettlement(fixture);
 });
 async function createFixture(organization:boolean,status:'failed'|'cancelled'|'queued'):Promise<Fixture>{
  const fixture={userId:randomUUID(),jobId:randomUUID(),organizationId:organization?randomUUID():null};
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[fixture.userId,fixture.userId,fixture.userId+'@example.invalid']);
  if(fixture.organizationId===null)await pool.query("INSERT INTO credit_balances(user_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,0,18,NOW()-INTERVAL '1 day')",[fixture.userId]);
  else{await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'expiry QA',$2)",[fixture.organizationId,fixture.userId]);await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')",[fixture.organizationId,fixture.userId]);await pool.query("INSERT INTO organization_credit_balances(organization_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,0,18,NOW()-INTERVAL '1 day')",[fixture.organizationId]);}
  await pool.query("INSERT INTO generation_jobs(id,user_id,organization_id,job_type,status,generation_mode,credit_cost,params) VALUES($1,$2,$3,'entity_generate',$4,'standard',12,'{}'::jsonb)",[fixture.jobId,fixture.userId,fixture.organizationId,status]);return fixture;
 }
 async function lateConsume(fixture:Fixture):Promise<void>{await pool.query("INSERT INTO credit_ledger(user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,description,job_id) VALUES($1,$2,'consume',-12,-10,-2,0,18,'late old consume',$3)",[fixture.userId,fixture.organizationId,fixture.jobId]);}
 async function assertSettlement(fixture:Fixture,refundCount=1):Promise<void>{
  const balance=fixture.organizationId===null?await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1',[fixture.userId]):await pool.query('SELECT monthly_credits,purchased_credits FROM organization_credit_balances WHERE organization_id=$1',[fixture.organizationId]);
  expect(balance.rows[0]).toEqual({monthly_credits:0,purchased_credits:30});
  expect((await pool.query("SELECT type,SUM(amount)::int amount,COUNT(*)::int n FROM credit_ledger WHERE job_id=$1 GROUP BY type ORDER BY type",[fixture.jobId])).rows).toEqual([{type:'consume',amount:-12,n:1},{type:'refund',amount:12,n:refundCount}]);
  if(fixture.organizationId!==null){
   const audits=await pool.query("SELECT metadata->>'amount' amount,metadata->>'monthly_delta' monthly_delta,metadata->>'purchased_delta' purchased_delta FROM organization_audit_logs WHERE organization_id=$1 AND action='credit.refunded' AND metadata ? 'monthly_delta'",[fixture.organizationId]);
   for(const audit of audits.rows){expect(audit.monthly_delta).toBe('0');expect(Number(audit.purchased_delta)).toBe(Number(audit.amount));}
  }
 }
});
function testDatabase(pool:Pool):DatabaseClient&TransactionRunner{
 return {query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>pool.query<Row>(sql,values),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>)=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await work({query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>client.query<Row>(sql,values)});await client.query('COMMIT');return result;}catch(error:unknown){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
}
