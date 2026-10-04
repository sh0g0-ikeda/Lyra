import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresStorePurchaseRepository } from '../../src/repositories/StorePurchaseRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
const dbDescribe=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
dbDescribe('旧38migrationのStore購入user guard',()=>{
  let admin:Pool;let pool:Pool;let database:DatabaseClient&TransactionRunner;let repository:PostgresStorePurchaseRepository;
  const schema='legacy_store_profile_'+process.pid+'_'+Date.now();
  beforeAll(async()=>{
    expect(schema).toMatch(/^legacy_store_profile_[0-9]+_[0-9]+$/u);admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public -c idle_in_transaction_session_timeout=30000 -c statement_timeout=30000',max:6,connectionTimeoutMillis:5000});database=testDatabase(pool);
    expect(await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,{migrationsDir:join(process.cwd(),'tests/fixtures/production-lineage-2debe')}))).toHaveLength(38);
    repository=new PostgresStorePurchaseRepository(database,database,'legacy_2debe_v1');
  },120_000);
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
  it.each([null,'blocked','processing','pending_external_action','completed'] as const)('旧request %sの権威だけで通常購入と退会を判別する',async(status)=>{
    const userId=await user();
    if(status!==null)await pool.query('INSERT INTO account_deletion_requests(user_id,identity_id,status) VALUES($1,$2,$3)',[userId,userId,status]);
    const result=await repository.transaction(client=>repository.findUserForUpdate(userId,client));
    expect(result).toEqual({id:userId,planCode:'free',accountDeleted:status!==null&&status!=='blocked'});
    expect((await pool.query('SELECT plan_code FROM users WHERE id=$1',[userId])).rows[0]?.plan_code).toBe('free');
    expect((await pool.query('SELECT COUNT(*)::int n FROM credit_ledger WHERE user_id=$1',[userId])).rows[0]?.n).toBe(0);
  });
  it('他userのcompleted requestを通常userの購入判定へ混ぜない',async()=>{
    const requested=await user();const normal=await user();await pool.query("INSERT INTO account_deletion_requests(user_id,identity_id,status) VALUES($1,$2,'completed')",[requested,requested]);
    expect(await repository.transaction(client=>repository.findUserForUpdate(normal,client))).toEqual({id:normal,planCode:'free',accountDeleted:false});
    expect(await repository.transaction(client=>repository.findUserForUpdate(randomUUID(),client))).toBeNull();
  });
  async function user():Promise<string>{const id=randomUUID();await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[id,id,id+'@example.invalid']);return id;}
});
function testDatabase(pool:Pool):DatabaseClient&TransactionRunner{
  return {query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>pool.query<Row>(sql,values),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>)=>{
    const client=await pool.connect();try{await client.query('BEGIN');const result=await work({query:async<Row extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>client.query<Row>(sql,values)});await client.query('COMMIT');return result;}catch(error:unknown){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}
