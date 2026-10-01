import {randomUUID} from 'node:crypto';
import {Pool,type QueryResult,type QueryResultRow} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {DatabaseClient,TransactionRunner} from '../../src/lib/db.js';
import {runPendingMigrations} from '../../src/lib/migrations.js';
import {TransactionalUserProvisioningService} from '../../src/services/auth/TransactionalUserProvisioningService.js';
import type {ProvisionedUser} from '../../src/services/auth/UserProvisioningService.js';
import {auditIdentitySubjects} from '../../src/services/auth/IdentitySubjectAudit.js';
import {withPostgresTestMigrationLock} from './postgresTestMigrationLock.js';
const dbDescribe=process.env.APP_ENV==='test'&&process.env.DATABASE_URL?describe:describe.skip;
dbDescribe('atomic subject-based user provisioning',()=>{
 let admin:Pool,pool:Pool,database:DatabaseClient&TransactionRunner;
 const schema=`auth_provisioning_${process.pid}_${Date.now()}`;
 beforeAll(async()=>{admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:12});database=testDatabase(pool);await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database));},120000);
 afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
 it('concurrent first logins create one user, one balance and one signup grant',async()=>{const sub=randomUUID(),email=`${sub}@example.invalid`;const service=new TransactionalUserProvisioningService(database);const results=await Promise.all([service.provisionFromSupabaseClaims({sub,email}),service.provisionFromSupabaseClaims({sub,email:email.toUpperCase()})]);expect(results[0].user.id).toBe(results[1].user.id);expect(results.filter(x=>x.isNewUser)).toHaveLength(1);expect((await pool.query("SELECT count(*)::int n,sum(amount)::int amount FROM credit_ledger WHERE user_id=$1 AND type='signup_bonus'",[results[0].user.id])).rows[0]).toEqual({n:1,amount:30});expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1',[results[0].user.id])).rows[0].purchased_credits).toBe(30);});

 it.each([undefined, 'federated'] as const)(
  'subject検索とemail検索の間に同一subjectがcommitされた場合は同じユーザーを返す（provider: %s）',
  async (identityProvider) => {
   const sub = randomUUID();
   const email = `${sub}@example.invalid`;
   const service = new TransactionalUserProvisioningService(database);
   const committed: ProvisionedUser[] = [];
   const interleaved = afterFirstSubjectMiss(database, sub, async () => {
    committed.push(await service.provisionFromSupabaseClaims({ sub, email, identityProvider }));
   });

   const result = await new TransactionalUserProvisioningService(interleaved)
    .provisionFromSupabaseClaims({ sub, email: email.toUpperCase(), identityProvider });

   expect(committed).toHaveLength(1);
   expect(committed[0].isNewUser).toBe(true);
   expect(result).toEqual({ user: committed[0].user, isNewUser: false });
   await expectSingleSignup(database, sub, email, result.user.id);
  },
 );

 it.each([undefined, 'federated'] as const)(
  'subject検索後に同じemailの別subjectがcommitされた場合は連携要求のまま拒否する（provider: %s）',
  async (identityProvider) => {
   const sub = randomUUID();
   const otherSub = randomUUID();
   const email = `${sub}@example.invalid`;
   const service = new TransactionalUserProvisioningService(database);
   const committed: ProvisionedUser[] = [];
   const interleaved = afterFirstSubjectMiss(database, sub, async () => {
    committed.push(await service.provisionFromSupabaseClaims({ sub: otherSub, email }));
   });

   await expect(new TransactionalUserProvisioningService(interleaved)
    .provisionFromSupabaseClaims({ sub, email: email.toUpperCase(), identityProvider }))
    .rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED', statusCode: 409 });

   expect(committed).toHaveLength(1);
   expect(committed[0].isNewUser).toBe(true);
   await expectSingleSignup(database, otherSub, email, committed[0].user.id);
   expect((await database.query('SELECT id FROM users WHERE supabase_id = $1', [sub])).rows).toEqual([]);
  },
 );
 it('a signup ledger failure rolls back the new user instead of permanently losing the bonus',async()=>{const sub=randomUUID(),email=`${sub}@example.invalid`;const failing:DatabaseClient&TransactionRunner={query:database.query,transaction:async(fn)=>database.transaction(async(client)=>fn({query:async(sql,args)=>{if(sql.includes('INSERT INTO credit_ledger'))throw new Error('Injected ledger failure');return client.query(sql,args);}}))};await expect(new TransactionalUserProvisioningService(failing).provisionFromSupabaseClaims({sub,email})).rejects.toThrow('Injected ledger failure');expect((await pool.query('SELECT count(*)::int n FROM users WHERE supabase_id=$1',[sub])).rows[0].n).toBe(0);const retried=await new TransactionalUserProvisioningService(database).provisionFromSupabaseClaims({sub,email});expect(retried.isNewUser).toBe(true);expect((await pool.query('SELECT purchased_credits FROM credit_balances WHERE user_id=$1',[retried.user.id])).rows[0].purchased_credits).toBe(30);});
 it('native and federated email collisions never rewrite an existing subject or create a second bonus',async()=>{const native=randomUUID(),email=`${native}@example.invalid`;const service=new TransactionalUserProvisioningService(database);const first=await service.provisionFromSupabaseClaims({sub:native,email});for(const claims of [{sub:randomUUID(),email},{sub:randomUUID(),email,identityProvider:'federated' as const}])await expect(service.provisionFromSupabaseClaims(claims)).rejects.toMatchObject({code:'ACCOUNT_LINK_REQUIRED'});expect((await pool.query('SELECT supabase_id FROM users WHERE id=$1',[first.user.id])).rows[0].supabase_id).toBe(native);expect((await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE user_id=$1 AND type='signup_bonus'",[first.user.id])).rows[0].n).toBe(1);});

 it('subject audit uses a real read-only transaction and never remaps matching email',async()=>{
  const rows=(await pool.query<{supabase_id:string;email:string}>('SELECT supabase_id,email FROM users ORDER BY id')).rows;
  const before=JSON.stringify(rows);let transactionClient:DatabaseClient|undefined;
  const readOnlyDatabase:DatabaseClient&TransactionRunner={query:database.query,transaction:async work=>database.transaction(async client=>{transactionClient=client;return work(client);})};
  const report=await auditIdentitySubjects(readOnlyDatabase,async()=>{
   expect((await transactionClient!.query<{transaction_read_only:string}>('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
   return {identities:rows.map((row,index)=>({subject:index===0?'different-subject':row.supabase_id,email:row.email,enabled:true})),limitReached:false};
  });
  expect(report).toMatchObject({missing_subjects:1,ready_for_subject_only_login:false});
  expect(JSON.stringify(report)).not.toContain(rows[0].email);
  expect(JSON.stringify((await pool.query('SELECT supabase_id,email FROM users ORDER BY id')).rows)).toBe(before);
 });
});

// Keep the first transaction's empty subject result while a second real
// transaction commits. Its next READ COMMITTED query must see the new email row.
function afterFirstSubjectMiss(
 database: DatabaseClient & TransactionRunner,
 subject: string,
 afterMiss: () => Promise<void>,
): DatabaseClient & TransactionRunner {
 let intercepted = false;
 return {
  query: database.query,
  transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> =>
   database.transaction(async (client) => work({
    query: async <Row extends QueryResultRow = QueryResultRow>(
     sql: string,
     values?: readonly unknown[],
    ): Promise<QueryResult<Row>> => {
     const result = await client.query<Row>(sql, values);
     if (!intercepted && sql.includes('WHERE supabase_id = $1') && values?.[0] === subject) {
      expect(result.rows).toEqual([]);
      intercepted = true;
      await afterMiss();
     }
     return result;
    },
   })),
 };
}

async function expectSingleSignup(
 database: DatabaseClient,
 subject: string,
 email: string,
 userId: string,
): Promise<void> {
 expect((await database.query(
  'SELECT id, supabase_id, email FROM users WHERE supabase_id = $1 OR lower(email) = lower($2)',
  [subject, email],
 )).rows).toEqual([{ id: userId, supabase_id: subject, email }]);
 expect((await database.query(
  'SELECT purchased_credits FROM credit_balances WHERE user_id = $1', [userId],
 )).rows).toEqual([{ purchased_credits: 30 }]);
 expect((await database.query(
  "SELECT amount FROM credit_ledger WHERE user_id = $1 AND type = 'signup_bonus'", [userId],
 )).rows).toEqual([{ amount: 30 }]);
}

function testDatabase(pool:Pool):DatabaseClient&TransactionRunner{return {query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>pool.query<Row>(text,values),transaction:async<T>(fn:(db:DatabaseClient)=>Promise<T>)=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await fn({query:async<Row extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>c.query<Row>(text,values)});await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};}
