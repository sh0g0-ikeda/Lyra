import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import type { WorkDeletionAsset, WorkDeletionRecord, WorkDeletionRepository, WorkDeletionStatus, WorkDeletionPrefix, WorkDeletionPrefixPage } from '../services/work/WorkDeletionService.js';

interface RequestRow extends QueryResultRow {
  id: string; work_id: string; owner_user_id: string; organization_id: string | null;
  status: WorkDeletionStatus; processing_token: string | null; blocker_code: string | null;
}
interface WorkRow extends QueryResultRow { id: string; user_id: string; organization_id: string | null }
interface ResourceRow extends QueryResultRow { kind: string; resource_id: string }
interface KeyRow extends QueryResultRow { s3_key: string; kind: 'object' | 'fenced_state' }
const CLAIM_SECONDS = 120;

/** Storage ownership is established before the work is hidden. Database guards
 * serialize every descendant writer with the work lock; all external effects
 * happen after this transaction and before the final fenced graph cascade. */
export class PostgresWorkDeletionRepository implements WorkDeletionRepository {
  private readonly database:DatabaseClient & TransactionRunner;
  public constructor(database:DatabaseClient & TransactionRunner, profile:'canonical'|'legacy_2debe_v1'|'production44_expanded_pg18_v1'='canonical') {
    const adapt=(client:DatabaseClient):DatabaseClient=>({query:(sql,values)=>client.query(profile==='legacy_2debe_v1'?sql.replace(/\bepisode_export_jobs\b/gu,'export_jobs'):sql,values)});
    this.database={...adapt(database),transaction:work=>database.transaction(client=>work(adapt(client)))};
  }
  public async request(userId: string, workId: string, organizationId: string | null): Promise<WorkDeletionRecord> {
    return this.database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(782341902145::bigint)');
      await this.lockActorScope(client, userId, organizationId);
      const existing = await client.query<RequestRow>(
        'SELECT * FROM work_deletion_requests WHERE work_id=$1::uuid', [workId]);
      if (existing.rows[0]) {
        this.assertScope(existing.rows[0], userId, organizationId);
        return mapRequest(existing.rows[0]);
      }
      const works = await client.query<WorkRow>(
        `SELECT id,user_id,organization_id FROM works WHERE id=$1::uuid
         AND (($3::uuid IS NULL AND user_id=$2::uuid AND organization_id IS NULL)
           OR ($3::uuid IS NOT NULL AND organization_id=$3::uuid)) FOR UPDATE`, [workId,userId,organizationId]);
      const work=works.rows[0];
      if (!work) throw new NotFoundError('Work not found');
      // A simultaneous DELETE may have committed its request while this one waited.
      const raced=await client.query<RequestRow>('SELECT * FROM work_deletion_requests WHERE work_id=$1::uuid',[workId]);
      if(raced.rows[0]) return mapRequest(raced.rows[0]);
      await this.assertNoUnsettledWrites(client, workId);
      const moved=await client.query(`SELECT 1 FROM work_resource_ownership a JOIN work_resource_ownership b
        ON a.kind=b.kind AND a.resource_id=b.resource_id AND a.work_id<>b.work_id WHERE a.work_id=$1::uuid LIMIT 1`,[workId]);
      if(moved.rows.length)throw new ConflictError('Historical resource ownership spans multiple works; support review is required');
      const id=randomUUID();
      const inserted=await client.query<RequestRow>(
        `INSERT INTO work_deletion_requests(id,work_id,owner_user_id,organization_id,requested_by)
         VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) RETURNING *`,[id,workId,work.user_id,organizationId,userId]);
      await client.query(
        `INSERT INTO work_deletion_resources(request_id,kind,resource_id)
         SELECT $1::uuid,kind,resource_id FROM (
           SELECT 'episode' AS kind,e.id AS resource_id FROM episodes e JOIN chapters c ON c.id=e.chapter_id WHERE c.work_id=$2::uuid
           UNION ALL SELECT 'page',p.id FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id WHERE c.work_id=$2::uuid
           UNION ALL SELECT 'entity',id FROM entities WHERE work_id=$2::uuid
           UNION ALL SELECT 'job',j.id FROM generation_jobs j WHERE lyra_resource_work_id('generation_jobs',to_jsonb(j))=$2::uuid
           UNION ALL SELECT 'export',j.id FROM episode_export_jobs j WHERE lyra_resource_work_id('episode_export_jobs',to_jsonb(j))=$2::uuid
           UNION ALL SELECT kind,resource_id FROM work_resource_ownership WHERE work_id=$2::uuid
           UNION ALL SELECT CASE WHEN j.job_type='page_generate' THEN 'page' ELSE 'entity' END,
             lyra_work_resource_uuid(CASE WHEN j.job_type='page_generate' THEN j.params->>'page_id' ELSE j.params->>'entity_id' END)
             FROM generation_jobs j WHERE lyra_resource_work_id('generation_jobs',to_jsonb(j))=$2::uuid
               AND j.job_type IN ('page_generate','entity_generate','entity_import_analysis')
         ) resource WHERE resource_id IS NOT NULL ON CONFLICT DO NOTHING`,[id,workId]);
      await this.createPrefixes(client,id,work);
      const keys=await this.inventory(client,id);
      await this.validateOwnership(client,id,work,keys);
      await this.assertNoSharedReferences(client,id,keys);
      for (const key of keys) await client.query(
        'INSERT INTO work_deletion_assets(request_id,s3_key,kind) VALUES($1::uuid,$2,$3) ON CONFLICT DO NOTHING',[id,key.s3_key,key.kind]);
      await client.query('UPDATE works SET deletion_started_at=clock_timestamp() WHERE id=$1::uuid',[workId]);
      return mapRequest(inserted.rows[0]!);
    });
  }
  public async find(userId:string,id:string,organizationId:string|null):Promise<WorkDeletionRecord>{
    return this.database.transaction(async client=>{
      await this.lockActorScope(client,userId,organizationId);
      const result=await client.query<RequestRow>('SELECT * FROM work_deletion_requests WHERE id=$1::uuid',[id]);
      if(!result.rows[0]) throw new NotFoundError('Work deletion not found');
      this.assertScope(result.rows[0],userId,organizationId);
      return mapRequest(result.rows[0]);
    });
  }
  public async list(userId:string,organizationId:string|null):Promise<WorkDeletionRecord[]>{
    return this.database.transaction(async client=>{
      await this.lockActorScope(client,userId,organizationId);
      const result=await client.query<RequestRow>(
        `SELECT * FROM work_deletion_requests WHERE status<>'completed' AND organization_id IS NOT DISTINCT FROM $2::uuid
         AND ($2::uuid IS NOT NULL OR owner_user_id=$1::uuid) ORDER BY created_at DESC,id LIMIT 50`,[userId,organizationId]);
      return result.rows.map(mapRequest);
    });
  }
  public async nextPrefix(request:WorkDeletionRecord):Promise<WorkDeletionPrefix|null>{
    await this.assertClaim(request);
    const rows=await this.database.query<{prefix:string;key_marker:string|null;version_marker:string|null}>(
      'SELECT prefix,key_marker,version_marker FROM work_deletion_prefixes WHERE request_id=$1::uuid AND NOT scan_complete ORDER BY prefix LIMIT 1',[request.id]);
    const row=rows.rows[0];return row===undefined?null:{prefix:row.prefix,cursor:row.key_marker===null?null:{key:row.key_marker,version:row.version_marker!}};
  }
  public async checkpointPrefix(request:WorkDeletionRecord,prefix:WorkDeletionPrefix,page:WorkDeletionPrefixPage):Promise<void>{
    await this.database.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(782341902145::bigint)');
      const claim=await client.query(`SELECT id FROM work_deletion_requests WHERE id=$1::uuid AND processing_token=$2::uuid
        AND status='processing' AND lease_expires_at>now() FOR UPDATE`,[request.id,request.processingToken]);
      if(claim.rows.length!==1)throw new ConflictError('Work deletion claim is stale');
      const cursor=await client.query(`SELECT 1 FROM work_deletion_prefixes WHERE request_id=$1::uuid AND prefix=$2 AND NOT scan_complete
        AND key_marker IS NOT DISTINCT FROM $3::text AND version_marker IS NOT DISTINCT FROM $4::text FOR UPDATE`,[request.id,prefix.prefix,prefix.cursor?.key??null,prefix.cursor?.version??null]);
      if(cursor.rows.length!==1)throw new ConflictError('Work inventory checkpoint is stale');
      if(page.keys.length>200||page.keys.some(key=>!key.startsWith(prefix.prefix)))throw new ConflictError('Work inventory prefix mismatch');
      const work=await client.query<WorkRow>('SELECT id,user_id,organization_id FROM works WHERE id=$1::uuid',[request.workId]);
      if(!work.rows[0])throw new ConflictError('Work inventory no longer available');
      const discovered=prefix.prefix==='saved/'||prefix.prefix==='session/'?await this.selectOwnedDiscoveredKeys(client,request.id,page.keys):page.keys;
      const keys=discovered.map(s3_key=>({s3_key,kind:'object' as const}));
      await this.validateOwnership(client,request.id,work.rows[0],keys);
      await this.assertNoSharedReferences(client,request.id,keys);
      await client.query(`INSERT INTO work_deletion_assets(request_id,s3_key,kind) SELECT $1::uuid,key,'object' FROM unnest($2::text[]) key ON CONFLICT DO NOTHING`,[request.id,discovered]);
      await client.query(`UPDATE work_deletion_prefixes SET key_marker=$3,version_marker=$4,scan_complete=$5 WHERE request_id=$1::uuid AND prefix=$2`,[request.id,prefix.prefix,page.next?.key??null,page.next?.version??null,page.next===null]);
    });
  }
  private async createPrefixes(client:DatabaseClient,requestId:string,work:WorkRow):Promise<void>{
    await client.query(`WITH resources AS (SELECT kind,resource_id FROM work_deletion_resources WHERE request_id=$1::uuid),
    prefixes AS (
      SELECT root AS prefix FROM unnest(ARRAY['saved/','session/']) root
      UNION SELECT 'exports/'||COALESCE($3::text,$2::text)||'/episodes/'||x.episode_id::text||'/'||x.id::text||'.'
        FROM episode_export_jobs x JOIN resources r ON r.kind='export' AND r.resource_id=x.id
    ) INSERT INTO work_deletion_prefixes(request_id,prefix) SELECT $1::uuid,prefix FROM prefixes ON CONFLICT DO NOTHING`,[requestId,work.user_id,work.organization_id]);
  }
  private async selectOwnedDiscoveredKeys(client:DatabaseClient,requestId:string,keys:string[]):Promise<string[]>{
    const resources=await client.query<ResourceRow>("SELECT kind,resource_id FROM work_deletion_resources WHERE request_id=$1::uuid AND kind IN ('page','entity')",[requestId]);
    const pages=new Set(resources.rows.filter(row=>row.kind==='page').map(row=>row.resource_id));
    const entities=new Set(resources.rows.filter(row=>row.kind==='entity').map(row=>row.resource_id));
    // UUID namespaces establish resource ownership even if the confirming actor
    // left the organization or no audit event survived a former process crash.
    const selected:string[]=[];
    const unrelated:Array<{kind:string;id:string;actor:string}>=[];
    for(const key of keys){
      const parts=key.split('/');if(!['saved','session'].includes(parts[0]??''))continue;
      let kind:string|undefined;let id:string|undefined;
      if(parts[2]==='entities'){kind='entity';id=parts[3];}
      if(parts[2]==='pages'){kind='page';id=parts[0]==='saved'?(parts[3]??'').slice(0,36):parts[3];}
      if(kind===undefined||id===undefined)continue;
      if((kind==='entity'?entities:pages).has(id)){selected.push(key);continue;}
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id))unrelated.push({kind,id,actor:parts[1]??''});
    }
    if(unrelated.length){
      const actors=await client.query<{id:string}>(`SELECT owner_user_id AS id FROM work_deletion_requests WHERE id=$1::uuid
        UNION SELECT m.user_id FROM organization_members m JOIN work_deletion_requests r ON r.organization_id=m.organization_id WHERE r.id=$1::uuid
        UNION SELECT j.user_id FROM generation_jobs j JOIN work_deletion_resources r ON r.kind='job' AND r.resource_id=j.id WHERE r.request_id=$1::uuid`,[requestId]);
      const actorIds=new Set(actors.rows.map(row=>row.id));
      const ambiguous=unrelated.filter(resource=>actorIds.has(resource.actor));
      if(ambiguous.length){
        const known=await client.query<{kind:string;id:string}>(`SELECT 'page' AS kind,id FROM pages WHERE id=ANY($1::uuid[])
          UNION SELECT 'entity',id FROM entities WHERE id=ANY($1::uuid[])
          UNION SELECT kind,resource_id AS id FROM work_deletion_resources WHERE resource_id=ANY($1::uuid[]) AND kind IN ('page','entity')
          UNION SELECT kind,resource_id AS id FROM work_resource_ownership WHERE resource_id=ANY($1::uuid[])`,[ambiguous.map(resource=>resource.id)]);
        const proven=new Set(known.rows.map(row=>row.kind+':'+row.id));
        if(ambiguous.some(resource=>!proven.has(resource.kind+':'+resource.id)))throw new ConflictError('Historical storage ownership is unresolved; support review is required');
      }
    }
    return selected;

  }
  public async claimNext(token:string):Promise<WorkDeletionRecord|null>{
    const result=await this.database.query<RequestRow>(
      `WITH candidate AS (
         SELECT id FROM work_deletion_requests WHERE
           (status IN ('pending','pending_external_action') AND COALESCE(next_retry_at,created_at)<=now())
           OR (status='processing' AND lease_expires_at<now())
         ORDER BY COALESCE(next_retry_at,created_at),id FOR UPDATE SKIP LOCKED LIMIT 1
       ) UPDATE work_deletion_requests r SET status='processing',processing_token=$1::uuid,
         lease_expires_at=now()+make_interval(secs=>$2::int),updated_at=now()
         FROM candidate WHERE r.id=candidate.id RETURNING r.*`,[token,CLAIM_SECONDS]);
    return result.rows[0] ? mapRequest(result.rows[0]):null;
  }
  public async assertClaim(request:WorkDeletionRecord):Promise<void>{
    const result=await this.database.query(
      `UPDATE work_deletion_requests SET lease_expires_at=now()+make_interval(secs=>$3::int),updated_at=now()
       WHERE id=$1::uuid AND processing_token=$2::uuid AND status='processing' AND lease_expires_at>now() RETURNING id`,
      [request.id,request.processingToken,CLAIM_SECONDS]);
    if(result.rowCount!==1) throw new ConflictError('Work deletion claim is stale');
  }
  public async listAssets(request:WorkDeletionRecord):Promise<WorkDeletionAsset[]>{
    await this.assertClaim(request);
    const result=await this.database.query<KeyRow & {deleted:boolean}>(
      'SELECT s3_key,kind,deleted_at IS NOT NULL AS deleted FROM work_deletion_assets WHERE request_id=$1::uuid ORDER BY s3_key',[request.id]);
    return result.rows.map(row=>({key:row.s3_key,kind:row.kind,deleted:row.deleted}));
  }
  public async markAssetDeleted(request:WorkDeletionRecord,key:string):Promise<void>{
    const result=await this.database.query(
      `UPDATE work_deletion_assets a SET deleted_at=COALESCE(deleted_at,now()) FROM work_deletion_requests r
       WHERE a.request_id=r.id AND r.id=$1::uuid AND r.processing_token=$2::uuid AND r.status='processing'
         AND r.lease_expires_at>now() AND a.s3_key=$3 RETURNING a.s3_key`,[request.id,request.processingToken,key]);
    if(result.rowCount!==1) throw new ConflictError('Work deletion checkpoint is stale');
  }
  public async release(request:WorkDeletionRecord,blockerCode:string|null):Promise<void>{
    const result=await this.database.query(
      `UPDATE work_deletion_requests SET status=CASE WHEN $3::text IS NULL THEN 'pending' ELSE 'pending_external_action' END,
        processing_token=NULL,lease_expires_at=NULL,blocker_code=$3,retry_count=retry_count+CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
        next_retry_at=now()+make_interval(secs=>CASE WHEN $3::text IS NULL THEN 1 ELSE LEAST(3600,30*(retry_count+1)) END),updated_at=now()
       WHERE id=$1::uuid AND processing_token=$2::uuid AND status='processing' AND lease_expires_at>now() RETURNING id`,
      [request.id,request.processingToken,blockerCode]);
    if(result.rowCount!==1) throw new ConflictError('Work deletion claim is stale');
  }
  public async complete(request:WorkDeletionRecord):Promise<void>{
    await this.database.transaction(async client=>{
      const claims=await client.query<RequestRow>(
        `SELECT * FROM work_deletion_requests WHERE id=$1::uuid AND processing_token=$2::uuid
         AND status='processing' AND lease_expires_at>now() FOR UPDATE`,[request.id,request.processingToken]);
      if(!claims.rows[0]) throw new ConflictError('Work deletion claim is stale');
      await client.query('SELECT id FROM works WHERE id=$1::uuid FOR UPDATE',[request.workId]);
      await this.assertNoUnsettledWrites(client,request.workId);
      const incomplete=await client.query('SELECT 1 FROM work_deletion_prefixes WHERE request_id=$1::uuid AND NOT scan_complete LIMIT 1',[request.id]);
      if(incomplete.rows.length)throw new ConflictError('Work inventory is incomplete');
      const missing=await client.query(
        'SELECT 1 FROM work_deletion_assets WHERE request_id=$1::uuid AND deleted_at IS NULL LIMIT 1',[request.id]);
      if(missing.rows.length) throw new ConflictError('Work assets have not been erased');
      const current=await this.inventory(client,request.id);
      const outstanding=await client.query<{s3_key:string}>('SELECT s3_key FROM work_deletion_assets WHERE request_id=$1::uuid AND deleted_at IS NOT NULL',[request.id]);
      const deleted=new Set(outstanding.rows.map(row=>row.s3_key));
      if(current.some(key=>!deleted.has(key.s3_key))) throw new ConflictError('Work asset inventory changed');
      const unfenced=await client.query(
        `SELECT 1 FROM state_reference_copy_attempts a JOIN work_deletion_resources r
         ON r.kind='entity' AND r.resource_id=a.entity_id WHERE r.request_id=$1::uuid
         AND (a.state<>'effects_fenced' OR a.marker_receipt IS NULL OR a.history_erased_at IS NULL) LIMIT 1`,[request.id]);
      if(unfenced.rows.length) throw new ConflictError('Work state references have not been fenced');
      await client.query("SELECT set_config('lyra.work_deletion_request',$1,true),set_config('lyra.work_deletion_token',$2,true)",[request.id,request.processingToken]);
      await client.query(`UPDATE state_reference_copy_attempts a SET actor_user_id=NULL,owner_user_id=NULL,organization_id=NULL,
        entity_id=NULL,state_id=NULL,job_id=NULL,candidate_ref_id=NULL,candidate_s3_key=NULL,expected_state_revision=NULL,
        descriptor=NULL,digest=NULL,mime_type=NULL,size_bytes=NULL,source_revision=NULL,image_receipt=NULL,
        deletion_processing_token=NULL,scrubbed_at=now(),updated_at=now()
        FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='entity' AND r.resource_id=a.entity_id
          AND a.state='effects_fenced' AND a.scrubbed_at IS NULL`,[request.id]);
      // Job/credit identities remain for settlement and old history DTOs.
      await client.query(
        `UPDATE generation_jobs j SET result=NULL,error_message=NULL,openai_request_id=NULL,
          params=jsonb_strip_nulls(jsonb_build_object('page_id',j.params->'page_id','episode_id',j.params->'episode_id','entity_id',j.params->'entity_id','work_id',to_jsonb($2::text)))
         FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='job' AND r.resource_id=j.id`,[request.id,request.workId]);
      // Retain accepted quote receipts; remove content snapshots without changing charged credits.
      await client.query(
        `UPDATE generation_quotes SET request='{}'::jsonb,plan=plan-ARRAY['snapshot','jobParams']
         WHERE lyra_work_resource_uuid(plan->>'workId')=$1::uuid`,[request.workId]);
      await client.query('DELETE FROM works WHERE id=$1::uuid',[request.workId]);
      // Keep only one-way key tombstones for future cross-work rebind rejection.
      await client.query('UPDATE work_deletion_assets SET s3_key=NULL WHERE request_id=$1::uuid',[request.id]);
      await client.query('DELETE FROM work_deletion_prefixes WHERE request_id=$1::uuid',[request.id]);
      await client.query(
        `UPDATE work_deletion_requests SET status='completed',completed_at=now(),processing_token=NULL,
          lease_expires_at=NULL,blocker_code=NULL,next_retry_at=NULL,updated_at=now() WHERE id=$1::uuid`,[request.id]);
    });
  }
  private async lockActorScope(client:DatabaseClient,userId:string,organizationId:string|null):Promise<void>{
    if(organizationId===null) {
      const user=await client.query('SELECT id FROM users WHERE id=$1::uuid AND account_deletion_started_at IS NULL FOR SHARE',[userId]);
      if(!user.rows.length) throw new NotFoundError('Account not found');
      return;
    }
    const member=await client.query(
      `SELECT user_id FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid
       AND status='active' AND role IN ('owner','admin','editor') FOR SHARE`,[organizationId,userId]);
    if(!member.rows.length) throw new NotFoundError('Work not found');
  }
  private assertScope(row:RequestRow,userId:string,organizationId:string|null):void{
    if(row.organization_id!==organizationId || (organizationId===null && row.owner_user_id!==userId)) throw new NotFoundError('Work deletion not found');
  }
  private async assertNoUnsettledWrites(client:DatabaseClient,workId:string):Promise<void>{
    const result=await client.query<{active:boolean;uncertain:boolean}>(
      `SELECT
        EXISTS(SELECT 1 FROM generation_jobs j WHERE lyra_resource_work_id('generation_jobs',to_jsonb(j))=$1::uuid AND status IN ('queued','processing'))
        OR EXISTS(SELECT 1 FROM episode_export_jobs j WHERE lyra_resource_work_id('episode_export_jobs',to_jsonb(j))=$1::uuid AND status IN ('queued','processing')) AS active,
        EXISTS(SELECT 1 FROM generation_jobs j WHERE lyra_resource_work_id('generation_jobs',to_jsonb(j))=$1::uuid AND job_type IN ('page_generate','entity_generate','entity_import_analysis') AND (retry_count>0 OR (status<>'completed' AND (commit_started_at IS NOT NULL OR result ? 'import_copy_intent'))))
        OR EXISTS(SELECT 1 FROM episode_export_jobs j WHERE lyra_resource_work_id('episode_export_jobs',to_jsonb(j))=$1::uuid AND (COALESCE((to_jsonb(j)->>'attempt_count')::int,1)>1 OR (started_at IS NOT NULL AND status<>'completed')))
        OR EXISTS(SELECT 1 FROM entity_reference_upload_tokens t JOIN entities e ON e.id=t.entity_id WHERE e.work_id=$1::uuid)
        OR EXISTS(SELECT 1 FROM work_storage_operations WHERE work_id=$1::uuid AND status<>'settled')
        OR EXISTS(SELECT 1 FROM generation_jobs j WHERE lyra_resource_work_id('generation_jobs',to_jsonb(j))=$1::uuid
          AND j.status IN ('failed','cancelled','canceled') AND j.credit_cost>0 AND
          COALESCE((SELECT SUM(l.amount) FROM credit_ledger l WHERE l.job_id=j.id AND l.type IN ('consume','refund')
            AND l.organization_id IS NOT DISTINCT FROM j.organization_id AND (j.organization_id IS NOT NULL OR l.user_id=j.user_id)),-j.credit_cost)<0)
        OR EXISTS(SELECT 1 FROM generation_jobs j JOIN works w ON w.id=$1::uuid
          WHERE j.organization_id IS NOT DISTINCT FROM w.organization_id AND (w.organization_id IS NOT NULL OR j.user_id=w.user_id)
            AND lyra_resource_work_id('generation_jobs',to_jsonb(j)) IS NULL AND j.job_type IN ('page_generate','entity_generate','entity_import_analysis')
            AND (j.result ? 's3_key' OR j.result ? 'candidates' OR j.result ? 'state_reference_copies' OR j.result ? 'import_copy_intent' OR j.commit_started_at IS NOT NULL))
        AS uncertain`,[workId]);
    if(result.rows[0]?.active) throw new ConflictError('Generation or export is active. Finish or cancel it before deleting this work.');
    if(result.rows[0]?.uncertain) throw new ConflictError('A previous storage write is unresolved. Contact support before permanently deleting this work.');
  }
  private async inventory(client:DatabaseClient,requestId:string):Promise<KeyRow[]>{
    const result=await client.query<KeyRow>(INVENTORY_SQL,[requestId]);
    return result.rows.filter(row=>row.s3_key!==null);
  }
  private async validateOwnership(client:DatabaseClient,requestId:string,work:WorkRow,keys:KeyRow[]):Promise<void>{
    const resources=await client.query<ResourceRow>('SELECT kind,resource_id FROM work_deletion_resources WHERE request_id=$1::uuid',[requestId]);
    const pages=new Set(resources.rows.filter(r=>r.kind==='page').map(r=>r.resource_id));
    const entities=new Set(resources.rows.filter(r=>r.kind==='entity').map(r=>r.resource_id));
    const exports=new Set(resources.rows.filter(r=>r.kind==='export').map(r=>r.resource_id));
    const owners=await client.query<{id:string}>(
      `SELECT $2::uuid AS id UNION SELECT j.user_id FROM generation_jobs j JOIN work_deletion_resources r ON r.kind='job' AND r.resource_id=j.id WHERE r.request_id=$1::uuid
       UNION SELECT user_id FROM entities WHERE work_id=$3::uuid
       UNION SELECT user_id FROM organization_members WHERE organization_id=$4::uuid`,[requestId,work.user_id,work.id,work.organization_id]);
    const ownerIds=new Set(owners.rows.map(row=>row.id));
    for(const item of keys){
      const key=item.s3_key;
      if(!key || key.length>1024 || /[\\\s\x00-\x1f]/u.test(key) || key.split('/').some(p=>p==='..'||p==='.'||p==='')) throw new ConflictError('Work asset ownership could not be verified');
      const p=key.split('/');
      if(item.kind==='fenced_state'){
        const journal=await client.query('SELECT 1 FROM state_reference_copy_attempts WHERE s3_key=$1 AND entity_id=ANY($2::uuid[]) AND organization_id IS NOT DISTINCT FROM $3::uuid',[key,[...entities],work.organization_id]);
        if(journal.rows.length===1) continue;
      }
      if(p[0]==='exports' && p[1]===(work.organization_id??work.user_id) && p[2]==='episodes' && exports.has((p[4]??'').replace(/\.(pdf|zip)$/u,''))) continue;
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(p[1]??'') && ['saved','session'].includes(p[0]??'')){
        if(p[2]==='pages' && ((p[0]==='session'&&p.length===5&&pages.has(p[3]??'')&&/^[a-zA-Z0-9_-]+\.(png|jpeg|jpg|webp)$/u.test(p[4]??'')) || (p[0]==='saved'&&p.length===4&&/_final\.(png|jpeg|jpg|webp)$/u.test(p[3]??'')&&pages.has((p[3]??'').replace(/_final\.(png|jpeg|jpg|webp)$/u,''))))) continue;
        if(p[2]==='entities' && entities.has(p[3]??'') && /^(?:states\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)?[a-zA-Z0-9_-]+\.(png|jpeg|jpg|webp)$/u.test(p.slice(4).join('/'))) continue;
      }
      if(p[0]==='tmp' && ownerIds.has(p[1]??'') && p[2]==='entities' && p[3]==='imports'){
        const upload=await client.query(
          `SELECT 1 FROM entity_reference_upload_tokens t WHERE t.s3_key=$1 AND t.entity_id=ANY($2::uuid[])
           UNION SELECT 1 FROM generation_jobs j JOIN work_deletion_resources r ON r.resource_id=j.id AND r.kind='job'
             WHERE r.request_id=$3::uuid AND j.result->>'import_copy_intent'=$1`,[key,[...entities],requestId]);
        if(upload.rows.length) continue;
      }
      throw new ConflictError('Work asset ownership could not be verified');
    }
  }
  private async assertNoSharedReferences(client:DatabaseClient,requestId:string,keys:KeyRow[]):Promise<void>{
    if(keys.length===0)return;
    const shared=await client.query(
      `SELECT 1 FROM unnest($2::text[]) AS key(value) WHERE
         EXISTS(SELECT 1 FROM pages p WHERE p.generated_image->>'s3_key'=key.value AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='page' AND r.resource_id=p.id))
         OR EXISTS(SELECT 1 FROM reference_sets s WHERE position(key.value in s.reference_images::text)>0 AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='entity' AND r.resource_id=s.entity_id))
         OR EXISTS(SELECT 1 FROM entity_states s WHERE s.reference_image->>'s3_key'=key.value AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='entity' AND r.resource_id=s.entity_id))
         OR EXISTS(SELECT 1 FROM generation_jobs j WHERE (position(key.value in j.params::text)>0 OR position(key.value in j.result::text)>0)
           AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='job' AND r.resource_id=j.id))
         OR EXISTS(SELECT 1 FROM episode_export_jobs x WHERE position(key.value in to_jsonb(x)::text)>0 AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='export' AND r.resource_id=x.id))
         OR EXISTS(SELECT 1 FROM generation_quotes q WHERE position(key.value in (q.plan::text||q.request::text))>0
           AND lyra_work_resource_uuid(q.plan->>'workId') IS DISTINCT FROM (SELECT work_id FROM work_deletion_requests WHERE id=$1::uuid))
         OR EXISTS(SELECT 1 FROM state_reference_copy_attempts a WHERE a.candidate_s3_key=key.value
           AND NOT EXISTS(SELECT 1 FROM work_deletion_resources r WHERE r.request_id=$1::uuid AND r.kind='entity' AND r.resource_id=a.entity_id))
       LIMIT 1`,[requestId,keys.map(key=>key.s3_key)]);
    if(shared.rows.length)throw new ConflictError('An image is referenced by another work. Contact support before permanently deleting this work.');
  }
}
function mapRequest(row:RequestRow):WorkDeletionRecord{
  return {id:row.id,workId:row.work_id,ownerUserId:row.owner_user_id,organizationId:row.organization_id,status:row.status,processingToken:row.processing_token,blockerCode:row.blocker_code};
}
const INVENTORY_SQL=`
WITH owned_entities AS (SELECT resource_id AS id FROM work_deletion_resources WHERE request_id=$1::uuid AND kind='entity'),
owned_jobs AS (SELECT j.* FROM generation_jobs j JOIN work_deletion_resources r ON r.kind='job' AND r.resource_id=j.id WHERE r.request_id=$1::uuid),
keys AS (
 SELECT p.generated_image->>'s3_key' AS s3_key,'object' AS kind FROM pages p JOIN work_deletion_resources r ON r.kind='page' AND r.resource_id=p.id WHERE r.request_id=$1::uuid
 UNION ALL SELECT image->>'s3_key','object' FROM reference_sets s JOIN owned_entities e ON e.id=s.entity_id CROSS JOIN LATERAL jsonb_array_elements(s.reference_images) image
 UNION ALL SELECT s.reference_image->>'s3_key',CASE WHEN s.reference_image->>'s3_key' LIKE 'state-reference-v2/%' THEN 'fenced_state' ELSE 'object' END FROM entity_states s JOIN owned_entities e ON e.id=s.entity_id
 UNION ALL SELECT j.result->>'s3_key','object' FROM owned_jobs j
 UNION ALL SELECT image->>'s3_key','object' FROM owned_jobs j CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.result->'candidates')='array' THEN j.result->'candidates' ELSE '[]'::jsonb END) image
 UNION ALL SELECT image->>'s3_key','object' FROM owned_jobs j CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.result->'state_reference_copies')='array' THEN j.result->'state_reference_copies' ELSE '[]'::jsonb END) image
 UNION ALL SELECT j.result->>'import_copy_intent','object' FROM owned_jobs j
 UNION ALL SELECT t.s3_key,'object' FROM entity_reference_upload_tokens t JOIN owned_entities e ON e.id=t.entity_id
 UNION ALL SELECT x.artifact_s3_key,'object' FROM episode_export_jobs x JOIN work_deletion_resources r ON r.kind='export' AND r.resource_id=x.id WHERE r.request_id=$1::uuid AND x.artifact_deleted_at IS NULL
 UNION ALL SELECT a.s3_key,'fenced_state' FROM state_reference_copy_attempts a JOIN owned_entities e ON e.id=a.entity_id WHERE a.scrubbed_at IS NULL
 UNION ALL SELECT a.candidate_s3_key,'object' FROM state_reference_copy_attempts a JOIN owned_entities e ON e.id=a.entity_id WHERE a.scrubbed_at IS NULL
) SELECT DISTINCT s3_key,kind FROM keys WHERE s3_key IS NOT NULL AND s3_key<>'' ORDER BY s3_key`;
