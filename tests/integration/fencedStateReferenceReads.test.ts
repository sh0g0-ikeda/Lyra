import { createHash, randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { buildFencedStateReferenceKey } from '../../src/domain/state/FencedStateReferenceKey.js';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import { PostgresFencedStateReferenceRepository, type FencedStateReferenceAttempt } from '../../src/repositories/FencedStateReferenceRepository.js';
import { PostgresEntityRepository } from '../../src/repositories/EntityRepository.js';
import { PostgresEntityStateReferenceRepository, toPersistedDescriptor } from '../../src/repositories/EntityStateReferenceRepository.js';
import { PostgresSceneRepository } from '../../src/repositories/SceneRepository.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { PostgresImageStorageReferenceRepository } from '../../src/repositories/ImageStorageReferenceRepository.js';
import { confirmedFencedStateReferenceAttemptSql, findConfirmedQuotedStateReference } from '../../src/repositories/FencedStateReferenceReadGuard.js';
import { GenerationQuoteService } from '../../src/services/generation/GenerationQuoteService.js';
import { PostgresGenerationQuotePlanResolver } from '../../src/repositories/GenerationQuotePlanResolver.js';
import { QuotedGenerationInputs } from '../../src/services/generation/QuotedGenerationInputs.js';
import { LayoutGuideImageRenderer } from '../../src/services/page/LayoutGuideImageRenderer.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const imageData = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const source = { mimeType: 'image/png' as const, sizeBytes: imageData.length,
  digest: createHash('sha256').update(imageData).digest('hex'), sourceRevision: { eTag: '"source"' } };
type Fixture = ConfirmEntityStateReferenceInput & { workId: string; episodeId: string; pageId: string; panelId: string };

// Real SQL/read consumers and accepted quotes; all image bytes are in memory.
// Mutated record projections exercise malformed evidence without bypassing any
// database constraint or weakening the journal's immutable write protection.
describePostgres('fenced state reference read and retention integration', () => {
  let admin: Pool; let pool: Pool; let database: TestDatabase;
  let journal: PostgresFencedStateReferenceRepository;
  const schema = `fenced_reads_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 8 });
    database = new TestDatabase(pool); journal = new PostgresFencedStateReferenceRepository(database);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  async function fixture(organization = false): Promise<Fixture> {
    const userId=randomUUID(), workId=randomUUID(), entityId=randomUUID(), stateId=randomUUID(), jobId=randomUUID();
    const chapterId=randomUUID(), episodeId=randomUUID(), pageId=randomUUID(), panelId=randomUUID();
    const organizationId=organization ? randomUUID() : null;
    await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId,userId,`${userId}@example.invalid`]);
    await pool.query('INSERT INTO credit_balances (user_id,purchased_credits) VALUES ($1,30)', [userId]);
    if (organizationId) {
      await pool.query("INSERT INTO organizations (id,name,created_by_user_id,status) VALUES ($1,'Read fixture',$2,'active')",[organizationId,userId]);
      await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())",[organizationId,userId]);
      await pool.query('INSERT INTO organization_credit_balances (organization_id,purchased_credits) VALUES ($1,30)',[organizationId]);
    }
    await pool.query("INSERT INTO works (id,user_id,organization_id,title) VALUES ($1,$2,$3,'Read fixture')", [workId,userId,organizationId]);
    await pool.query("INSERT INTO entities (id,work_id,user_id,name,entity_type) VALUES ($1,$2,$3,'Character','character')",[entityId,workId,userId]);
    await pool.query("INSERT INTO reference_sets (entity_id,primary_ref_id,reference_images,status) VALUES ($1,'base',$2::jsonb,'ready')",[entityId,JSON.stringify([{ref_id:'base',s3_key:`saved/${userId}/entities/${entityId}/base.png`,cdn_url:'https://example.invalid/base.png'}])]);
    await pool.query("INSERT INTO entity_states (id,entity_id,name,description,created_at,updated_at) VALUES ($1,$2,'injured','A cheek scar','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')",[stateId,entityId]);
    await pool.query('INSERT INTO chapters (id,work_id,"order") VALUES ($1,$2,1)',[chapterId,workId]);
    await pool.query('INSERT INTO episodes (id,chapter_id,"order") VALUES ($1,$2,1)',[episodeId,chapterId]);
    await pool.query(`INSERT INTO pages (id,episode_id,page_number,status,layout_config) VALUES ($1,$2,1,'editing','{"type":"template","template_id":"splash_1"}')`,[pageId,episodeId]);
    await pool.query("INSERT INTO panels (id,page_id,\"order\",situation_text,entities) VALUES ($1,$2,1,'Original accepted scene',$3::jsonb)",[panelId,pageId,JSON.stringify([{entity_id:entityId,state_id:stateId,role:'primary',expression:'calm',action:'standing_firm',position:'center'}])]);
    await pool.query(`INSERT INTO panel_frames (page_id,panel_id,vertices,reading_order) VALUES ($1,$2,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]',1)`,[pageId,panelId]);
    const input: Fixture = {userId,organizationId,entityId,stateId,jobId,workId,episodeId,pageId,panelId,
      candidateS3Key:`session/${userId}/entities/${entityId}/${jobId}.png`, expectedStateRevision:'2026-09-30T00:00:00.000Z',
      descriptor:{refId:`${jobId}-1`,s3Key:`saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}.png`,storageOwnerUserId:userId,
        imageModel:'gpt-image-2',baseRefId:'base',createdAt:'2026-09-30T00:00:01.000Z',
        inputFingerprint:computeStateReferenceFingerprint({entityId,stateId,name:'injured',description:'A cheek scar',baseRefId:'base'})}};
    await pool.query(`INSERT INTO generation_jobs (id,user_id,organization_id,job_type,status,credit_cost,params,result,completed_at)
      VALUES ($1,$2,$3,'entity_generate','completed',1,$4::jsonb,$5::jsonb,'2026-09-30T00:00:01Z')`,
    [jobId,userId,organizationId,JSON.stringify({target:'entity_state',entity_id:entityId,entity_state_id:stateId,base_primary_ref_id:'base',state_revision:input.expectedStateRevision,
      state_input_fingerprint:input.descriptor.inputFingerprint,image_model:'gpt-image-2'}),JSON.stringify({candidates:[{ref_id:input.descriptor.refId,s3_key:input.candidateS3Key}]})]);
    return input;
  }
  async function admit(f: Fixture): Promise<FencedStateReferenceAttempt> {
    const attempt=(await journal.admit(f,source)).attempt; if (!attempt) throw new Error('Missing attempt'); return attempt;
  }
  async function confirm(f: Fixture): Promise<FencedStateReferenceAttempt> {
    const attempt=await admit(f); await journal.authorizeDispatch(attempt);
    await journal.confirmObservedImage(attempt,{kind:'image',...receiptIdentity(attempt),digest:source.digest,mimeType:source.mimeType,sizeBytes:source.sizeBytes});
    return attempt;
  }
  function receiptIdentity(attempt: FencedStateReferenceAttempt) {
    return {protocol:attempt.intent.protocol,attemptToken:attempt.intent.attemptToken,s3Key:attempt.intent.s3Key,eTag:'"image"'};
  }
  async function resolved(f: Fixture, actor=f.userId) {
    return (await new PostgresEntityRepository(database).findResolvedReferenceImagesByAssignmentsAndUserId(
      [{entityId:f.entityId,stateId:f.stateId}],f.workId,actor,f.organizationId))[0];
  }
  async function setDescriptor(f: Fixture, descriptor: unknown) {
    await pool.query('UPDATE entity_states SET reference_image=$2::jsonb WHERE id=$1',[f.stateId,descriptor === null ? null : JSON.stringify(descriptor)]);
  }
  async function readKey(f: Fixture, key: string, actor=f.userId, organizationId=f.organizationId) {
    return findConfirmedQuotedStateReference(database,{s3Key:key,entityId:f.entityId,actorUserId:actor,organizationId,
      stateId:f.stateId,refId:f.descriptor.refId,imageModel:f.descriptor.imageModel});
  }
  async function acceptedJob(f: Fixture, actor=f.userId) {
    const service=new GenerationQuoteService({database,enabled:true,resolver:new PostgresGenerationQuotePlanResolver({imageModel:'gpt-image-2',generationEnabled:true,stateGenerationEnabled:true,importEnabled:true})});
    const quote=await service.issue(actor,{operation:'page_generate',targetId:f.pageId},f.organizationId);
    const accepted=await service.accept(actor,quote.quote.id,quote.quoteToken,randomUUID(),f.organizationId);
    const job=await new PostgresGenerationJobRepository(database).findByIdAndUserId(accepted.quote.acceptedJobId!,actor,f.organizationId);
    if (!job) throw new Error('Missing accepted job'); return job;
  }

  it('requires exact confirmed evidence for presentation, generation and episode readiness', async () => {
    const f=await fixture(); const attempt=await admit(f);
    await setDescriptor(f,toPersistedDescriptor(attempt.input.descriptor));
    expect((await resolved(f))?.s3Key).toBeNull();
    expect((await new PostgresSceneRepository(database).findEntityStatesByEntityIdAndUserId(f.entityId,f.userId))[0]?.referenceImage).toBeNull();
    expect((await new PostgresPageRepository(database).findEpisodePlanningContextByIdAndUserId(f.episodeId,f.userId))?.stateLibrary?.[0]).toMatchObject({referenceImage:null,referenceReady:false});
    expect((await new PostgresEntityStateReferenceRepository(database).findContextByIdAndUserId(f.entityId,f.stateId,f.userId))?.referenceImage).toBeNull();
    const story=new PostgresStoryRepository(database,database); const states=[{entityId:f.entityId,stateId:f.stateId}];
    expect(await story.validateEpisodeStartingEntityStates(f.episodeId,f.userId,states)).toBe(false);
    await expect(story.updateEpisode(f.episodeId,f.userId,{startingEntityStates:states})).rejects.toMatchObject({code:'CONFLICT'});
    await setDescriptor(f,null);
    await journal.authorizeDispatch(attempt);
    await journal.confirmObservedImage(attempt,{kind:'image',...receiptIdentity(attempt),digest:source.digest,mimeType:source.mimeType,sizeBytes:source.sizeBytes});
    expect((await resolved(f))?.s3Key).toBe(attempt.intent.s3Key);
    const exactScope={s3Key:attempt.intent.s3Key,entityId:f.entityId,actorUserId:f.userId,organizationId:f.organizationId,
      stateId:f.stateId,refId:f.descriptor.refId,imageModel:f.descriptor.imageModel};
    for (const mismatch of [{stateId:randomUUID()},{refId:'other-ref'},{imageModel:'other-model'},{entityId:randomUUID()},{actorUserId:randomUUID()}]) {
      expect(await findConfirmedQuotedStateReference(database,{...exactScope,...mismatch})).toBeNull();
    }
    expect((await new PostgresPageRepository(database).findEpisodePlanningContextByIdAndUserId(f.episodeId,f.userId))?.stateLibrary?.[0]).toMatchObject({referenceReady:true});
    expect((await new PostgresSceneRepository(database).updateEntityState(f.entityId,f.stateId,f.userId,{}))?.referenceImage).toEqual(toPersistedDescriptor(attempt.input.descriptor));
    expect(await story.validateEpisodeStartingEntityStates(f.episodeId,f.userId,states)).toBe(true);
    await expect(story.updateEpisode(f.episodeId,f.userId,{startingEntityStates:states})).resolves.toMatchObject({startingEntityStates:states});
    await setDescriptor(f,{...toPersistedDescriptor(attempt.input.descriptor),image_model:'different-model'});
    expect((await resolved(f))?.s3Key).toBeNull();
  });

  it('does not promote canonical-looking keys without a journal, and preserves legacy descriptors', async () => {
    const f=await fixture();
    await setDescriptor(f,toPersistedDescriptor({...f.descriptor,s3Key:buildFencedStateReferenceKey({ownerUserId:f.userId,entityId:f.entityId,attemptToken:randomUUID(),mimeType:'image/png'})}));
    expect((await resolved(f))?.s3Key).toBeNull();
    await setDescriptor(f,toPersistedDescriptor(f.descriptor));
    expect((await resolved(f))?.s3Key).toBe(f.descriptor.s3Key);
    const job=await acceptedJob(f); const loads:string[]=[];
    await new QuotedGenerationInputs(database,'gpt-image-2',{loadByS3Key:async(key)=>{loads.push(key);return {imageData,mimeType:'image/png'};}},new LayoutGuideImageRenderer()).page(job);
    expect(loads).toEqual([f.descriptor.s3Key]);
  });

  it('rejects malformed journal projections, receipts, scope bindings and every non-confirmed state', async () => {
    const f=await fixture(); const attempt=await confirm(f);
    const row=(await pool.query('SELECT * FROM state_reference_copy_attempts WHERE attempt_token=$1',[attempt.intent.attemptToken])).rows[0]!;
    const mutations:Record<string,unknown>[]=[{},...['unresolved','fencing','effects_fenced'].map(state=>({state})),
      {image_receipt:null},{dispatch_started_at:null},{scrubbed_at:new Date().toISOString()},
      {owner_user_id:randomUUID()},{entity_id:randomUUID()},{job_id:null},{source_revision:{eTag:'bad'}},
      {image_receipt:{...row.image_receipt,kind:'marker'}},{image_receipt:{...row.image_receipt,digest:'f'.repeat(64)}},
      {image_receipt:{...row.image_receipt,eTag:'unquoted'}},{image_receipt:{...row.image_receipt,unknown:true}},
      {descriptor:{...row.descriptor,storage_owner_user_id:randomUUID()}},{descriptor:{...row.descriptor,image_model:123}}];
    for (const [index,mutation] of mutations.entries()) {
      const result=await pool.query(`SELECT ${confirmedFencedStateReferenceAttemptSql('candidate')} AS valid
        FROM jsonb_populate_record(NULL::state_reference_copy_attempts,$1::jsonb) candidate`,[JSON.stringify({...row,...mutation})]);
      expect(result.rows[0]?.valid,JSON.stringify(mutation)).toBe(index===0);
    }
  });

  it('uses accepted historical snapshot after state/draft replacement and validates loaded receipt bytes', async () => {
    const f=await fixture(); const attempt=await confirm(f); const job=await acceptedJob(f);
    await pool.query("UPDATE entity_states SET name='new state',description='new draft',reference_image=NULL WHERE id=$1",[f.stateId]);
    await pool.query("UPDATE panels SET situation_text='Unapproved replacement' WHERE id=$1",[f.panelId]);
    const loads:string[]=[]; let bytes=imageData;
    const inputs=new QuotedGenerationInputs(database,'gpt-image-2',{loadByS3Key:async(key)=>{loads.push(key);return {imageData:bytes,mimeType:'image/png'};}},new LayoutGuideImageRenderer());
    const result=await inputs.page(job);
    expect(result.prompt.draftPrompt).toContain('Original accepted scene');
    expect(result.prompt.draftPrompt).not.toContain('Unapproved replacement');
    expect(loads).toEqual([attempt.intent.s3Key]);
    bytes=Buffer.from('different image');
    await expect(inputs.page(job)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
  });

  it('denies accepted quote reads after fencing before attempting storage', async () => {
    const f=await fixture(); const attempt=await confirm(f); const job=await acceptedJob(f);
    let fence:FencedStateReferenceAttempt|null=null;
    const raceDatabase:DatabaseClient & TransactionRunner={transaction:database.transaction.bind(database),
      query:async <T extends QueryResultRow>(sql:string,values?:readonly unknown[]):Promise<QueryResult<T>>=>{
        const result=await database.query<T>(sql,values);
        if(sql.includes('SELECT (account_deletion_started_at IS NULL')) {
          const token=randomUUID(); await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1',[f.userId]);
          await pool.query(`INSERT INTO account_deletion_requests (user_id,identity_id,identity_key,status,processing_token,processing_started_at)
            VALUES ($1,$2,$3,'processing',$4,NOW())`,[f.userId,f.userId,f.userId.replaceAll('-','')+'x'.repeat(11),token]);
          fence=await journal.claimFencing(attempt,{reason:'account_deletion',processingToken:token});
        }
        return result;
      }};
    let reads=0;
    await expect(new QuotedGenerationInputs(raceDatabase,'gpt-image-2',{loadByS3Key:async()=>{reads++;return {imageData,mimeType:'image/png'};}},new LayoutGuideImageRenderer()).page(job)).rejects.toThrow('Quoted state reference is no longer confirmed');
    expect(await readKey(f,attempt.intent.s3Key)).toBeNull();
    expect((await resolved(f))?.s3Key).toBeNull();
    if(fence===null) throw new Error('Expected fencing race');
    await journal.completeFencing(fence,{kind:'marker',...receiptIdentity(attempt),eTag:'"marker"',historyErased:true});
    expect(await readKey(f,attempt.intent.s3Key)).toBeNull(); expect(reads).toBe(0);
  });

  it('keeps organization assets readable to active members after storage-owner anonymization', async () => {
    const f=await fixture(true); const attempt=await confirm(f); const member=randomUUID();
    await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)',[member,member,`${member}@example.invalid`]);
    await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())",[f.organizationId,member]);
    const job=await acceptedJob(f,member);
    await pool.query("UPDATE users SET account_deletion_started_at=NOW(),account_deleted_at=NOW(),email=$2 WHERE id=$1",[f.userId,`${f.userId}@deleted.invalid`]);
    expect((await resolved(f,member))?.s3Key).toBe(attempt.intent.s3Key);
    expect(await readKey(f,attempt.intent.s3Key,member)).toMatchObject({ownerUserId:f.userId});
    expect(await readKey(f,attempt.intent.s3Key,member,null)).toBeNull();
    expect(await readKey(f,attempt.intent.s3Key,randomUUID())).toBeNull();
    const inputs=new QuotedGenerationInputs(database,'gpt-image-2',{loadByS3Key:async()=>({imageData,mimeType:'image/png'})},new LayoutGuideImageRenderer());
    expect((await inputs.page(job)).inputImages.some(image=>image.role==='entity_reference')).toBe(true);
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2",[f.organizationId,member]);
    expect(await readKey(f,attempt.intent.s3Key,member)).toBeNull();
    await expect(inputs.page(job)).rejects.toMatchObject({code:'NOT_FOUND'});
  });

  it('retains journal image/marker keys and jobs beyond TTL until terminal ownership scrub', async () => {
    const f=await fixture(); const attempt=await admit(f);
    await pool.query("UPDATE generation_jobs SET result=NULL,expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[f.jobId]);
    const jobs=new PostgresGenerationJobRepository(database); const inventory=new PostgresImageStorageReferenceRepository(database);
    expect((await jobs.pruneExpiredTerminalJobs({dryRun:false,maxDeletes:100})).deletedCount).toBe(0);
    const keys=await inventory.findProtectedImageS3Keys({protectRecentCandidateHours:1});
    expect(keys.has(attempt.intent.s3Key)).toBe(true); expect(keys.has(f.candidateS3Key)).toBe(true);
    const fence=await journal.claimFencing(attempt,{reason:'unconfirmed_recovery'});
    await journal.completeFencing(fence,{kind:'marker',...receiptIdentity(attempt),eTag:'"marker"',historyErased:true});
    expect((await jobs.pruneExpiredTerminalJobs({dryRun:false,maxDeletes:100})).deletedCount).toBe(0);
    await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1',[f.userId]);
    await pool.query(`UPDATE state_reference_copy_attempts SET scrubbed_at=NOW(),actor_user_id=NULL,owner_user_id=NULL,organization_id=NULL,
      entity_id=NULL,state_id=NULL,job_id=NULL,candidate_ref_id=NULL,candidate_s3_key=NULL,expected_state_revision=NULL,descriptor=NULL,
      digest=NULL,mime_type=NULL,size_bytes=NULL,source_revision=NULL,image_receipt=NULL,deletion_processing_token=NULL WHERE attempt_token=$1`,[attempt.intent.attemptToken]);
    expect((await jobs.pruneExpiredTerminalJobs({dryRun:false,maxDeletes:100})).candidateIds).toContain(f.jobId);
    expect((await inventory.findProtectedImageS3Keys({protectRecentCandidateHours:1})).has(attempt.intent.s3Key)).toBe(true);
  });
});

class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql,values ? [...values] : undefined);
  }
  public async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const result=await work({query:<R extends QueryResultRow>(sql:string,values?:readonly unknown[])=>client.query<R>(sql,values ? [...values] : undefined)});
      await client.query('COMMIT'); return result;
    } catch(error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  }
}
