import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  CANONICAL_RUNTIME_MIGRATIONS,
  attestRuntimeSchema,
  prepareAttestedRuntimeSchema,
  startAttestedRuntime,
  type RuntimeSchemaCatalog,
} from '../../../src/lib/runtimeSchemaAttestation.js';
import { assertAttestedRuntimeCapabilities } from '../../../src/lib/runtimeGuards.js';

function fixture(expanded=true, revision=true):RuntimeSchemaCatalog {
  const catalog=JSON.parse(readFileSync(join(process.cwd(),expanded?'tests/fixtures/security-recovery-pg18/expanded-catalog.json':'tests/fixtures/production44-expanded-pg18/catalog.json'),'utf8')) as RuntimeSchemaCatalog;
  if(!expanded){
    catalog.migrationFilenames=CANONICAL_RUNTIME_MIGRATIONS.filter(file=>revision||!file.startsWith('048'));
    catalog.columns=catalog.columns.filter(col=>col.relation!=='pages'||!['story_source_scene_ids','story_page_purpose','story_continuity_note'].includes(col.name));
    if(!revision){catalog.triggers=catalog.triggers.filter(row=>row.name!=='entity_states_monotonic_revision');catalog.functions=catalog.functions?.filter(row=>row.name!=='lyra_advance_entity_state_revision');catalog.namespaceArtifacts=catalog.namespaceArtifacts.filter(row=>row.name!=='lyra_advance_entity_state_revision()');}
  }
  return catalog;
}
function database(catalog:RuntimeSchemaCatalog):TransactionRunner&{queries:string[]} {
  const queries:string[]=[];
  const client:DatabaseClient={query:async<T extends QueryResultRow>(sql:string):Promise<QueryResult<T>>=>{
    queries.push(sql); let rows:unknown[];
    if(sql==='SET TRANSACTION READ ONLY')rows=[];
    else if(sql.includes("current_setting('server_version_num')"))rows=[{serverVersionNum:'180003'}];
    else if(sql.includes('FROM pg_class relation'))rows=catalog.relations;
    else if(sql.includes('FROM information_schema.columns'))rows=catalog.columns;
    else if(sql.includes('FROM pg_constraint schema_constraint'))rows=catalog.constraints;
    else if(sql.includes('FROM pg_index schema_index'))rows=catalog.indexes;
    else if(sql.includes('FROM pg_trigger schema_trigger'))rows=catalog.triggers;
    else if(sql.includes('SELECT artifact.kind'))rows=catalog.namespaceArtifacts;
    else if(sql.includes('procedure.prosrc'))rows=catalog.functions??[];
    else if(sql.includes('SELECT filename FROM schema_migrations'))rows=catalog.migrationFilenames.map(filename=>({filename}));
    else throw new Error('Unexpected writer SQL');
    return{rows:rows as T[],rowCount:rows.length,command:'SELECT',fields:[],oid:0};
  }};
  return{queries,transaction:work=>work(client)};
}
describe('canonical047/048 と expanded53 の immutable startup proof',()=>{
  it.each([false,true])('canonical revision=%s を区別し049未適用の起動を拒否する',async revision=>{
    const proof=await attestRuntimeSchema(database(fixture(false,revision)));
    expect(proof.repositoryProfile).toBe('canonical');
    expect(proof.capabilities.entityStateMonotonicRevision).toBe(revision);
    expect(()=>assertAttestedRuntimeCapabilities(proof,{})).toThrow('049');
    const assertState=()=>assertAttestedRuntimeCapabilities(proof,{ENTITY_STATE_REFERENCE_GENERATION_ENABLED:true});
    expect(assertState).toThrow('049');
  });
  it('verified canonical048でも049拒否後はproduction workerをimportしない',async()=>{
    const proof=await attestRuntimeSchema(database(fixture(false,true)));
    const workerImport=vi.fn();
    const start=vi.fn(async runtime=>{
      assertAttestedRuntimeCapabilities(runtime,{});
      await workerImport();
    });
    await expect(startAttestedRuntime({attest:async()=>proof,start})).rejects.toThrow('049');
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(proof);
    expect(workerImport).not.toHaveBeenCalled();
  });
  it('expanded exact53だけを同一の凍結proofとしてstartへ渡しAUTOがtrueでもbridgeを呼ばない',async()=>{
    const runMigrations=vi.fn();
    const {runtime}=await prepareAttestedRuntimeSchema({database:database(fixture()),autoRunMigrations:true,runMigrations});
    expect(runtime.repositoryProfile).toBe('production44_expanded_pg18_v1');
    expect(Object.isFrozen(runtime)).toBe(true);expect(Object.isFrozen(runtime.capabilities)).toBe(true);
    const start=vi.fn();await startAttestedRuntime({attest:async()=>runtime,start});
    expect(start).toHaveBeenCalledTimes(1);expect(start).toHaveBeenCalledWith(runtime);expect(runMigrations).not.toHaveBeenCalled();
    await expect(startAttestedRuntime({attest:async()=>Object.freeze({...runtime}),start})).rejects.toThrow('UNVERIFIED');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it.each(['base44','partial','unknown'])('%sはprovider/listener/timerを開始せずmigrationも呼ばない',async kind=>{
    const catalog=fixture();
    if(kind==='base44')Object.assign(catalog,JSON.parse(readFileSync(join(process.cwd(),'tests/fixtures/production44-pg18/catalog.json'),'utf8')));
    else if(kind==='partial')catalog.triggers.pop();else catalog.migrationFilenames.push('999_unknown.sql');
    const db=database(catalog),start=vi.fn(),runMigrations=vi.fn();
    await expect(startAttestedRuntime({attest:async()=>(await prepareAttestedRuntimeSchema({database:db,autoRunMigrations:true,runMigrations})).runtime,start})).rejects.toThrow('SCHEMA_UNSUPPORTED');
    expect(start).not.toHaveBeenCalled();expect(runMigrations).not.toHaveBeenCalled();
    expect(db.queries[0]).toBe('SET TRANSACTION READ ONLY');
  });
});
