import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Pool, type QueryResultRow} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {DatabaseClient,TransactionRunner} from '../../src/lib/db.js';
import type {ReleaseCompatibilityRuntime} from '../../src/domain/release/ReleaseCompatibilityPolicy.js';
import {runPendingMigrations,runProduction44Expansion} from '../../src/lib/migrations.js';
import {checkReleaseCompatibility} from '../../scripts/checkReleaseCompatibility.js';
import {withPostgresTestMigrationLock} from './postgresTestMigrationLock.js';
const url=process.env.DATABASE_URL;
function syntheticTarget():boolean {
  if(process.env.APP_ENV!=='test'||url===undefined)return false;
  try{const target=new URL(url);return ['postgres:','postgresql:'].includes(target.protocol)&&['127.0.0.1','localhost','::1'].includes(target.hostname)&&target.pathname==='/lyra_test'&&target.search===''&&target.hash===''&&(['15432','15433','15435','15436'].includes(target.port)||(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&['5432','5433'].includes(target.port)));}catch{return false;}
}
const native=syntheticTarget()?describe:describe.skip;
const runtime:ReleaseCompatibilityRuntime={generationQuotesEnabled:true,generationEnabled:true,pageGenerationEnabled:true,entityGenerationEnabled:true,entityImportAnalysisEnabled:true,entityReferenceDirectUploadEnabled:true,openAiApiKeyConfigured:true,openAiImageModel:'gpt-image-2',generationQueueConfigured:true,imageStorageConfigured:true,awsRegionConfigured:true,localImageFallbackEnabled:false,webImageDeliveryClientIds:[],stateReferenceCopyV2AdmissionEnabled:false,stateReferenceCopyV2StorageContractAttested:false};
for(const profile of ['canonical','production44_expanded_pg18_v1'] as const){
  native('release preflight native '+profile,()=>{
    let admin:Pool,pool:Pool,database:DatabaseClient&TransactionRunner;
    const schema='release_native_'+randomUUID().replaceAll('-','');const statements:string[]=[];
    beforeAll(async()=>{
      admin=new Pool({connectionString:url,max:1});await admin.query('CREATE SCHEMA '+schema);
      pool=new Pool({connectionString:url,options:'-c search_path='+schema+',public',max:4});
      database={query:pool.query.bind(pool),transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>=>{
        const client=await pool.connect();try{await client.query('BEGIN');const result=await work({query:async<Row extends QueryResultRow>(sql:string,args?:readonly unknown[])=>{statements.push(sql);return client.query<Row>(sql,args===undefined?undefined:[...args]);}});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }};
      await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(database,profile==='canonical'?undefined:{migrationsDir:join(process.cwd(),'tests/fixtures/production44-pg18')}));
      if(profile!=='canonical')expect(await runProduction44Expansion(pool)).toHaveLength(8);
      statements.length=0;
    },120_000);
    afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
    it('exact current schemaを認定し同じread-only transactionでinvariantと既存mobile policyを確認する',async()=>{
      const before=Number((await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n);
      const report=await checkReleaseCompatibility(database,{profile:'new-mobile',mobileClientIds:[],runtime},{schemaProfile:profile});
      expect(report).toMatchObject({ok:true,journalPresent:false,remoteStoragePolicyVerified:false,violations:[]});
      expect(report.checkedCount).toBeGreaterThan(10);
      expect(Number((await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n)).toBe(before);
      expect(before).toBe(profile==='canonical'?48:52);
      expect(statements.every(sql=>/^\s*(SELECT|WITH|SET)\b/u.test(sql))).toBe(true);
      expect(statements).toEqual(expect.arrayContaining([expect.stringContaining('REPEATABLE READ, READ ONLY')]));
    });
    it('schema認定成功でもquote OFFのnew-mobileは拒否してpolicyを緩めない',async()=>{
      const report=await checkReleaseCompatibility(database,{profile:'new-mobile',mobileClientIds:[],runtime:{...runtime,generationQuotesEnabled:false}},{schemaProfile:profile});
      expect(report.ok).toBe(false);expect(report.violations.map(v=>v.code)).toContain('MOBILE_QUOTES_REQUIRED');
    });
    it('048履歴欠落は後続business shapeに触れず識別子なしで拒否する',async()=>{
      await pool.query("DELETE FROM schema_migrations WHERE filename='048_advance_entity_state_revision_for_legacy_writers.sql'");statements.length=0;
      try{
        const report=await checkReleaseCompatibility(database,{profile:'backend-only',mobileClientIds:[],runtime},{schemaProfile:profile});
        expect(report).toMatchObject({ok:false,journalPresent:null});
        expect(report.violations.map(v=>v.code)).toContain(profile==='canonical'?'SCHEMA_HISTORY_MISMATCH':'SCHEMA_UNSUPPORTED');
        expect(JSON.stringify(report)).not.toContain('048_advance');
        expect(statements.some(sql=>sql.includes('FROM state_reference_copy_attempts'))).toBe(false);
      }finally{await pool.query("INSERT INTO schema_migrations(filename) VALUES('048_advance_entity_state_revision_for_legacy_writers.sql')");}
    });
    if(profile!=='canonical')it('known52履歴でも追加未知catalogを拒否しbusiness SQLを実行しない',async()=>{
      await pool.query('ALTER TABLE entity_states ADD COLUMN unknown_release_probe text');statements.length=0;
      try{
        const report=await checkReleaseCompatibility(database,{profile:'backend-only',mobileClientIds:[],runtime},{schemaProfile:profile});
        expect(report).toMatchObject({ok:false,journalPresent:null,violations:[{category:'database',code:'SCHEMA_UNSUPPORTED',count:1}]});
        expect(statements.some(sql=>sql.includes('FROM state_reference_copy_attempts'))).toBe(false);
      }finally{await pool.query('ALTER TABLE entity_states DROP COLUMN unknown_release_probe');}
    });
  });
}
