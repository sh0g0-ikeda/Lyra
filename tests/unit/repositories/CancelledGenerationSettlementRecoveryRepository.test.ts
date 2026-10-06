import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';
import { createCancelledGenerationSettlementRecoveryRepository } from '../../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

function database(valid = true, remaining: boolean | null | Error = false, expanded = false): DatabaseClient & TransactionRunner & {queries:string[]} {
  const catalog=JSON.parse(readFileSync(join(process.cwd(),expanded?'tests/fixtures/production44-expanded-pg18/catalog.json':'tests/fixtures/production44-pg18/catalog.json'),'utf8')) as RuntimeSchemaCatalog;
  if(!valid)catalog.triggers=[];
  const queries:string[]=[];
  const client:DatabaseClient={query:async<R extends QueryResultRow>(sql:string):Promise<QueryResult<R>>=>{
    queries.push(sql);let rows:unknown[];
    if(sql==='SET TRANSACTION READ ONLY')rows=[];
    else if(sql.includes('FROM pg_class relation'))rows=catalog.relations;
    else if(sql.includes('FROM information_schema.columns'))rows=catalog.columns;
    else if(sql.includes('FROM pg_constraint schema_constraint'))rows=catalog.constraints;
    else if(sql.includes('FROM pg_index schema_index'))rows=catalog.indexes;
    else if(sql.includes('FROM pg_trigger schema_trigger'))rows=catalog.triggers;
    else if(sql.includes('SELECT artifact.kind'))rows=catalog.namespaceArtifacts;
    else if(sql.includes('procedure.prosrc'))rows=catalog.functions??[];
    else if(sql.includes('SELECT filename FROM schema_migrations'))rows=catalog.migrationFilenames.map(filename=>({filename}));
    else if(sql.includes('AND id = $1::uuid')){
      if(remaining instanceof Error)throw remaining;
      rows=remaining===null?[]:[{id:'00000000-0000-0000-0000-000000000001',needs_settlement:remaining}];
    }
    else if(sql.includes('WITH candidates AS MATERIALIZED'))rows=[];
    else throw new Error('Unexpected query');
    return {rows:rows as R[],rowCount:rows.length,command:'SELECT',oid:0,fields:[]};
  }};
  return {...client,queries,transaction:async<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>=>work(client)};
}
describe('実44のみをexact検証してから返還候補を走査する',()=>{
  afterEach(()=>vi.restoreAllMocks());
it('expanded profileは52 exact catalogだけを認めbase44との誤組合せを拒否する',async()=>{
  const repo=await createCancelledGenerationSettlementRecoveryRepository(database(true,false,true),'production44_expanded_pg18_v1');
  expect(repo.profile).toBe('production44_expanded_pg18_v1');
  await expect(createCancelledGenerationSettlementRecoveryRepository(database(),'production44_expanded_pg18_v1')).rejects.toThrow('SCHEMA_UNSUPPORTED');
  await expect(createCancelledGenerationSettlementRecoveryRepository(database(true,false,true),'production44_pg18_v1')).rejects.toThrow('SCHEMA_UNSUPPORTED');
});
  it.each([undefined,'canonical','legacy_2debe_v1','unknown',{},true])('profile %sはSQL前に拒否する',async profile=>{
    const db=database();await expect(createCancelledGenerationSettlementRecoveryRepository(db,profile)).rejects.toThrow();expect(db.queries).toHaveLength(0);
  });
  it('実44という文字列でもcatalog不一致ならscanせず拒否する',async()=>{
    const db=database(false);await expect(createCancelledGenerationSettlementRecoveryRepository(db,'production44_pg18_v1')).rejects.toThrow('SCHEMA_UNSUPPORTED');
    expect(db.queries.some(sql=>sql.includes('WITH candidates AS MATERIALIZED'))).toBe(false);
  });
  it('検証後のscanはlimitとcursorを検証し候補を限定してledgerを読む',async()=>{
    const db=database();const repository=await createCancelledGenerationSettlementRecoveryRepository(db,'production44_pg18_v1');db.queries.length=0;
    await expect(repository.scanBatch({afterId:'invalid',limit:1})).rejects.toThrow();
    await expect(repository.scanBatch({afterId:null,limit:101})).rejects.toThrow();expect(db.queries).toHaveLength(0);
    expect(await repository.scanBatch({afterId:null,limit:2})).toEqual([]);expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toContain('WITH candidates AS MATERIALIZED');
  });
  it.each([true,false,null])('finalizeがtrueでもremaining=%sの確認結果だけで精算済みを返す',async remaining=>{
    const finalize=vi.spyOn(PostgresGenerationJobRepository.prototype,'finalizeCancellation').mockResolvedValue(true);
    const db=database(true,remaining);const repository=await createCancelledGenerationSettlementRecoveryRepository(db,'production44_pg18_v1');db.queries.length=0;
    expect(Object.isFrozen(repository)).toBe(true);
    expect(await repository.settleAndVerify('00000000-0000-0000-0000-000000000001')).toBe(remaining===false);
    expect(finalize).toHaveBeenCalledOnce();expect(db.queries).toHaveLength(1);
  });
  it('finalize拒否なら成功とせず再読取も行わない',async()=>{
    vi.spyOn(PostgresGenerationJobRepository.prototype,'finalizeCancellation').mockResolvedValue(false);
    const db=database();const repository=await createCancelledGenerationSettlementRecoveryRepository(db,'production44_pg18_v1');db.queries.length=0;
    expect(await repository.settleAndVerify('00000000-0000-0000-0000-000000000001')).toBe(false);expect(db.queries).toHaveLength(0);
  });
  it('post-read SQL失敗を成功へ変換しない',async()=>{
    vi.spyOn(PostgresGenerationJobRepository.prototype,'finalizeCancellation').mockResolvedValue(true);
    const db=database(true,new Error('private SQL failure'));const repository=await createCancelledGenerationSettlementRecoveryRepository(db,'production44_pg18_v1');
    await expect(repository.settleAndVerify('00000000-0000-0000-0000-000000000001')).rejects.toThrow('private SQL failure');
  });
});
