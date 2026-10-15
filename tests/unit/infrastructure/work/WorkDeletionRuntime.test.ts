import {describe,it,expect,vi} from 'vitest';
import type {DatabaseClient,TransactionRunner} from '../../../../src/lib/db.js';
import {parseEnv} from '../../../../src/lib/env.js';
import {createWorkDeletionRuntime,startWorkDeletionRecovery} from '../../../../src/infrastructure/work/WorkDeletionRuntime.js';
const database:DatabaseClient&TransactionRunner={query:async()=>({command:'SELECT',rowCount:0,oid:0,fields:[],rows:[]}),transaction:async work=>work(database)};
describe('作品削除recovery lifecycle',()=>{
 it('受付flagのdefaultはfalseである',()=>{expect(parseEnv({APP_ENV:'test'}).WORK_DELETION_ENABLED).toBe(false);});
 it('受付OFFでも受理済みrequestのrecoveryを動かし停止時はdrainする',async()=>{
  const runtime=createWorkDeletionRuntime(parseEnv({APP_ENV:'test'}),database);
  const recovery=vi.spyOn(runtime.service,'recoverPendingRequests').mockResolvedValue({attemptedCount:0});
  await startWorkDeletionRecovery(runtime)();expect(recovery).toHaveBeenCalledWith(2);
 });
 it('受付ONで永続storageがない場合は起動を拒否する',()=>{
  expect(()=>createWorkDeletionRuntime(parseEnv({APP_ENV:'test',WORK_DELETION_ENABLED:'true'}),database)).toThrow('durable S3');
 });
});
