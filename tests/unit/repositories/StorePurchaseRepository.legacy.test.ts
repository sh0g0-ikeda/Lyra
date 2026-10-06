import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStorePurchaseRepository } from '../../../src/repositories/StorePurchaseRepository.js';

/** Spec11 first legacy phase: 旧027 request statusを購入txの同じlock clientで読む。
 * blocked/無しは通常購入を維持、processing/pending_external_action/completedを拒否。
 * 価格・ledger・idempotency・canonical既定値は変更せず、runtime接続は別gate。 */
class Client implements DatabaseClient,TransactionRunner{
  public queries:string[]=[];
  public constructor(private readonly legacy:boolean,private readonly deleted:boolean){}
  public async query<Row extends QueryResultRow=QueryResultRow>(sql:string):Promise<QueryResult<Row>>{
    this.queries.push(sql);
    if(this.legacy&&/account_deletion_started_at|account_deleted_at/u.test(sql))throw new Error('Legacy users has no deletion timestamp columns');
    return {command:'SELECT',rowCount:1,oid:0,fields:[],rows:[{id:'user-1',plan_code:'free',legacy_account_deleted:this.deleted,account_deletion_started_at:null,account_deleted_at:this.deleted?new Date():null}] as unknown as Row[]};
  }
  public async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>{return work(this);}
}
describe('StorePurchase旧status guard',()=>{
  it.each([false,true])('legacyの退会投影%sを新timestampなしで購入txへ渡す',async(deleted)=>{
    const client=new Client(true,deleted);const repository=new PostgresStorePurchaseRepository(client,client,'legacy_2debe_v1');
    const user=await repository.transaction(tx=>repository.findUserForUpdate('user-1',tx));
    expect(user).toEqual({id:'user-1',planCode:'free',accountDeleted:deleted});
    expect(client.queries[0]).toContain('FOR UPDATE');
  });
  it('profile省略はcanonical timestamp投影を維持する',async()=>{
    const client=new Client(false,true);const repository=new PostgresStorePurchaseRepository(client,client);
    expect(await repository.findUserForUpdate('user-1',client)).toEqual({id:'user-1',planCode:'free',accountDeleted:true});
    expect(client.queries[0]).toContain('account_deletion_started_at');expect(client.queries[0]).not.toContain('legacy_account_deleted');
    expect(client.queries[0]).toBe(['','      SELECT','        id,','        plan_code,','        account_deletion_started_at,','        account_deleted_at','      FROM users','      WHERE id = $1','      FOR UPDATE','      '].join('\n'));

  });
});
