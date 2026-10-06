import {describe,expect,it} from 'vitest';
import type {QueryResult,QueryResultRow} from 'pg';
import type {DatabaseClient,TransactionRunner} from '../../../src/lib/db.js';
import type {ReleaseCompatibilityRuntime} from '../../../src/domain/release/ReleaseCompatibilityPolicy.js';
import {checkReleaseCompatibility} from '../../../scripts/checkReleaseCompatibility.js';

const runtime:ReleaseCompatibilityRuntime={generationQuotesEnabled:true,generationEnabled:true,pageGenerationEnabled:true,entityGenerationEnabled:true,entityImportAnalysisEnabled:true,entityReferenceDirectUploadEnabled:true,openAiApiKeyConfigured:true,openAiImageModel:'gpt-image-2',generationQueueConfigured:true,imageStorageConfigured:true,awsRegionConfigured:true,localImageFallbackEnabled:false,webImageDeliveryClientIds:[],stateReferenceCopyV2AdmissionEnabled:false,stateReferenceCopyV2StorageContractAttested:false};
function database(historyCount=0):{db:DatabaseClient&TransactionRunner;sql:string[]}{
  const sql:string[]=[];
  const query=async <T extends QueryResultRow>(text:string):Promise<QueryResult<T>>=>{
    sql.push(text);
    const rows=text.includes('differences')?[{count:historyCount}]:text.includes('SELECT EXISTS (SELECT 1 FROM state_reference_copy_attempts)')?[{present:false}]:[];
    return {rows:rows as unknown as T[],rowCount:rows.length,command:'SELECT',fields:[],oid:0};
  };
  const client:DatabaseClient={query};return {sql,db:{query,transaction:async<T>(work:(db:DatabaseClient)=>Promise<T>):Promise<T>=>work(client)}};
}
describe('現行release inventoryとexpanded profileのread-only preflight',()=>{
  it('048を含む現行canonical inventoryでも履歴一致と全invariantを読取専用で検査できる',async()=>{
    const d=database();
    const report=await checkReleaseCompatibility(d.db,{profile:'new-mobile',mobileClientIds:[],runtime});
    expect(report).toMatchObject({ok:true,journalPresent:false,violations:[],remoteStoragePolicyVerified:false});
    expect(d.sql).toEqual(expect.arrayContaining([expect.stringContaining('REPEATABLE READ'),expect.stringContaining('READ ONLY')]));
    expect(d.sql.every(sql=>/^\s*(SELECT|WITH|SET)\b/u.test(sql))).toBe(true);
    expect(d.sql.some(sql=>sql.includes('state_reference_copy_attempts'))).toBe(true);
  });
  it('canonical履歴欠落は新しいshapeに触る前に匿名countで拒否する',async()=>{
    const d=database(1);
    const report=await checkReleaseCompatibility(d.db,{profile:'backend-only',mobileClientIds:[],runtime});
    expect(report).toMatchObject({ok:false,journalPresent:null,violations:[{category:'database',code:'SCHEMA_HISTORY_MISMATCH',count:1}]});
    expect(d.sql.some(sql=>sql.includes('state_reference_copy_attempts'))).toBe(false);
  });
  it('expanded指定だけでは空や未知catalogを許可せずbusiness shapeへ進まない',async()=>{
    const d=database();
    const report=await checkReleaseCompatibility(d.db,{profile:'backend-only',mobileClientIds:[],runtime},{schemaProfile:'production44_expanded_pg18_v1'});
    expect(report).toMatchObject({ok:false,journalPresent:null,violations:[{category:'database',code:'SCHEMA_UNSUPPORTED',count:1}]});
    expect(d.sql.some(sql=>sql.includes('FROM state_reference_copy_attempts'))).toBe(false);
    expect(d.sql.every(sql=>/^\s*(SELECT|WITH|SET)\b/u.test(sql))).toBe(true);
  });
  it('未拡張44と人工legacy38をrelease可能なprofileとして扱わずDBに触れない',async()=>{
    for(const schemaProfile of ['production44_pg18_v1','legacy_2debe_v1'] as const){
      const d=database();const report=await checkReleaseCompatibility(d.db,{profile:'backend-only',mobileClientIds:[],runtime},{schemaProfile});
      expect(report).toMatchObject({ok:false,journalPresent:null,violations:[{category:'database',code:'SCHEMA_PROFILE_UNSUPPORTED',count:1}]});expect(d.sql).toEqual([]);
    }
  });
  it('現行schemaが通ってもnew-mobileのquote必須条件は維持する',async()=>{
    const d=database();const report=await checkReleaseCompatibility(d.db,{profile:'new-mobile',mobileClientIds:[],runtime:{...runtime,generationQuotesEnabled:false}});
    expect(report.ok).toBe(false);expect(report.violations.map(x=>x.code)).toContain('MOBILE_QUOTES_REQUIRED');
  });
});
