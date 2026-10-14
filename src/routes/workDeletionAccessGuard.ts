import {randomUUID} from 'node:crypto';
import type {MiddlewareHandler} from 'hono';
import {ConflictError,NotFoundError} from '../domain/errors/index.js';
import type {DatabaseClient,TransactionRunner} from '../lib/db.js';
import type {AppEnv} from '../types/app.js';
import {parseOptionalOrganizationId} from './organizationRouteHelpers.js';
const RESOURCE_TABLES:Readonly<Record<string,string>>={
 works:'works',chapters:'chapters',episodes:'episodes',pages:'pages',entities:'entities',
 panels:'panels',frames:'panel_frames',balloons:'balloons',scenes:'scenes',exports:'episode_export_jobs',
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** No body parsing. The durable intent bridges synchronous object writes and
 * their later DB commit. A process crash or ambiguous response blocks erasure. */
export function createWorkDeletionAccessGuard(database:DatabaseClient&TransactionRunner,profile:'canonical'|'legacy_2debe_v1'|'production44_expanded_pg18_v1'='canonical'):MiddlewareHandler<AppEnv>{
 const seen=new WeakSet<object>();
 return async(c,next)=>{
  if(seen.has(c)){await next();return;}seen.add(c);
  const segments=c.req.path.replace(/^\/api\/(web\/)?/u,'').split('/');
  const canonicalTable=RESOURCE_TABLES[segments[0]??''];
  const table=canonicalTable==='episode_export_jobs'&&profile==='legacy_2debe_v1'?'export_jobs':canonicalTable;const id=segments[1];
  if(table===undefined||id===undefined||!UUID.test(id)||(table==='works'&&c.req.method==='DELETE')){await next();return;}
  const user=c.get('user');const organizationId=parseOptionalOrganizationId(c);
  const externalWrite=c.req.method==='POST'&&(
   (table==='pages'&&segments[2]==='confirm')||
   (table==='entities'&&(segments.includes('confirm')||segments.includes('bind')))
  );
  let operation:string|null=null;
  await database.transaction(async client=>{
   const result=await client.query<{id:string;deletion_started_at:Date|null}>(
    `SELECT w.id,w.deletion_started_at FROM works w
     WHERE w.id=(SELECT lyra_resource_work_id($4,to_jsonb(resource)) FROM ${table} resource WHERE resource.id=$1::uuid)
       AND (($3::uuid IS NULL AND w.user_id=$2::uuid AND w.organization_id IS NULL)
       OR ($3::uuid IS NOT NULL AND w.organization_id=$3::uuid AND EXISTS(
         SELECT 1 FROM organization_members m WHERE m.organization_id=w.organization_id AND m.user_id=$2::uuid AND m.status='active')))
     FOR SHARE OF w`,[id,user.id,organizationId,table]);
   const work=result.rows[0];
   if(work===undefined)throw new NotFoundError('Resource not found');
   if(work.deletion_started_at!==null)throw new NotFoundError('Resource not found');
   if(externalWrite){
    operation=randomUUID();
    await client.query('INSERT INTO work_storage_operations(id,work_id) VALUES($1::uuid,$2::uuid)',[operation,work.id]);
   }
  });
  try{
   await next();
   if(operation!==null)await database.query(
    "UPDATE work_storage_operations SET status=$2,updated_at=now() WHERE id=$1::uuid AND status='executing'",
    [operation,c.res.status<400?'settled':'unresolved']);
  }catch(error){
   if(operation!==null)await database.query("UPDATE work_storage_operations SET status='unresolved',updated_at=now() WHERE id=$1::uuid AND status='executing'",[operation]);
   if(isDeletionGuardError(error))throw new ConflictError('Work deletion is pending');
   throw error;
  }
 };
}
export function isDeletionGuardError(error:unknown):boolean{
 return error!==null&&typeof error==='object'&&'constraint'in error&&error.constraint==='work_deletion_write_guard';
}
