import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { PostgresWorkBootstrapRepository } from '../../src/repositories/WorkBootstrapRepository.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const url = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && url ? describe : describe.skip;

describePostgres('work bootstrap compatibility', () => {
  let admin: Pool; let pool: Pool; let database: TestDatabase; let bootstrap: PostgresWorkBootstrapRepository; let story: PostgresStoryRepository;
  const schema = `work_bootstrap_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString:url }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString:url, options:`-c search_path=${schema},public`, max:8 }); database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    bootstrap = new PostgresWorkBootstrapRepository(database); story = new PostgresStoryRepository(database, database);
  }, 120_000);
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  async function user(): Promise<string> { const id=randomUUID(); await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[id,`bootstrap-${id}`,`${id}@example.invalid`]); return id; }
  async function organization(actor:string): Promise<string> {
    const id=randomUUID();
    await pool.query('INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,$2,$3)',[id,'Bootstrap test',actor]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner')",[id,actor]);
    return id;
  }
  const input = (title='読み切り', requestId=randomUUID()) => ({ title,mode:'one_shot' as const,requestId,organizationId:null });

  it('同一request_idの並行再送は一作品だけを作り、異なるpayloadは409になる', async () => {
    const actor=await user(); const requestId=randomUUID();
    const results=await Promise.all([bootstrap.create(actor,input('同時作成',requestId)),bootstrap.create(actor,input('同時作成',requestId))]);
    expect(results[0]).toMatchObject({work:{id:results[1].work.id},chapter:{id:results[1].chapter.id},episode:{id:results[1].episode.id}});
    expect(Number((await pool.query('SELECT count(*)::int AS n FROM works WHERE user_id=$1',[actor])).rows[0].n)).toBe(1);
    await expect(bootstrap.create(actor,input('別題',requestId))).rejects.toMatchObject({code:'CONFLICT',statusCode:409});
    await pool.query("UPDATE works SET title='改題後' WHERE id=$1",[results[0].work.id]);
    await expect(bootstrap.create(actor,input('同時作成',requestId))).resolves.toMatchObject({work:{id:results[0].work.id}});
  });

  it('episode insert失敗時はwork、chapter、metadataも残さない', async () => {
    const actor=await user();
    await pool.query(`CREATE FUNCTION fail_bootstrap_episode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional rollback'; END $$`);
    await pool.query(`CREATE TRIGGER fail_bootstrap_episode BEFORE INSERT ON episodes FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_episode()`);
    await expect(bootstrap.create(actor,input())).rejects.toThrow('intentional rollback');
    expect(Number((await pool.query('SELECT count(*)::int AS n FROM works WHERE user_id=$1',[actor])).rows[0].n)).toBe(0);
    expect(Number((await pool.query('SELECT count(*)::int AS n FROM work_creation_metadata WHERE actor_user_id=$1',[actor])).rows[0].n)).toBe(0);
    await pool.query('DROP TRIGGER fail_bootstrap_episode ON episodes');
    await pool.query('DROP FUNCTION fail_bootstrap_episode()');
  });

  it('既存hierarchyの子削除、追加、移動にmetadata FKが干渉しない', async () => {
    const actor=await user(); const created=await bootstrap.create(actor,input('旧Mobile互換'));
    expect(await story.deleteEpisode(created.episode.id,actor)).toBe(true);
    expect((await bootstrap.listMetadata(actor,null,[created.work.id]))[0]).toMatchObject({entryEpisodeId:null,entryChapterId:created.chapter.id});
    const added=await story.createEpisode(created.chapter.id,{order:1,title:'追加話',purpose:null,storyInputMode:'structured',storyFullDraft:null,introduction:null,middle:null,climax:null,endingHook:null,estimatedPages:4,entitiesInvolved:[]},actor);
    const next=await story.createChapter(created.work.id,{order:2,title:'次章',purpose:null,startingState:null,endingState:null,emotionCurve:null,entitiesInvolved:[],keyBeats:[]},actor);
    await story.moveEpisode(added.id,actor,'down',null,true);
    expect((await story.findEpisodeByIdAndUserId(added.id,actor))?.chapterId).toBe(next.id);
  });

  it('metadataは他ユーザーへ漏れず、work削除時にCASCADEされる', async () => {
    const actor=await user(); const foreign=await user(); const requestId=randomUUID(); const created=await bootstrap.create(actor,input('読み切り',requestId));
    expect(await bootstrap.listMetadata(foreign,null,[created.work.id])).toEqual([]);
    await pool.query('DELETE FROM works WHERE id=$1',[created.work.id]);
    expect(Number((await pool.query('SELECT count(*)::int AS n FROM work_creation_metadata WHERE work_id=$1',[created.work.id])).rows[0].n)).toBe(0);
    await expect(bootstrap.create(actor,input('読み切り',requestId))).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('組織作成は監査を一度だけ記録し、閲覧と編集と失効した権限を区別する', async () => {
    const actor=await user(); const org=await organization(actor); const viewer=await user(); const stranger=await user();
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'viewer')",[org,viewer]);
    const request={...input('組織の読み切り'),organizationId:org};
    const created=await bootstrap.create(actor,request);
    await bootstrap.create(actor,request);
    expect((await pool.query("SELECT count(*)::int n FROM organization_audit_logs WHERE organization_id=$1 AND action='work.bootstrap_created'",[org])).rows[0].n).toBe(1);
    expect(await bootstrap.listMetadata(viewer,org,[created.work.id])).toHaveLength(1);
    expect(await bootstrap.listMetadata(stranger,org,[created.work.id])).toEqual([]);
    expect(await bootstrap.listMetadata(actor,null,[created.work.id])).toEqual([]);
    await expect(bootstrap.create(viewer,{...request,requestId:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2",[org,actor]);
    expect(await bootstrap.listMetadata(actor,org,[created.work.id])).toEqual([]);
    await expect(bootstrap.create(actor,request)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('削除を開始した作品の場合に再送で編集対象を返さない', async () => {
    const actor=await user(); const request=input(); const created=await bootstrap.create(actor,request);
    await pool.query('UPDATE works SET deletion_started_at=now() WHERE id=$1',[created.work.id]);
    expect(await bootstrap.listMetadata(actor,null,[created.work.id])).toEqual([]);
    await expect(bootstrap.create(actor,request)).rejects.toMatchObject({code:'CONFLICT'});
  });
  it('同じrequest IDを別scopeで使った後に組織を削除しても既存削除を阻害しない', async () => {
    const actor=await user(); const org=await organization(actor); const request=input();
    await bootstrap.create(actor,request);
    await bootstrap.create(actor,{...request,organizationId:org});
    await expect(pool.query('DELETE FROM organizations WHERE id=$1',[org])).resolves.toMatchObject({rowCount:1});
    expect((await pool.query('SELECT count(*)::int n FROM work_bootstrap_request_ledger WHERE actor_user_id=$1',[actor])).rows[0].n).toBe(2);
    expect((await bootstrap.create(actor,request)).work.organizationId).toBe(null);
  });
});
class TestDatabase implements DatabaseClient, TransactionRunner { constructor(private readonly pool:Pool) {} query<T extends QueryResultRow=QueryResultRow>(text:string,values?:readonly unknown[]):Promise<QueryResult<T>> { return this.pool.query<T>(text,values?[...values]:undefined); } async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T> { const client=await this.pool.connect(); try { await client.query('BEGIN'); const result=await work({query:<R extends QueryResultRow=QueryResultRow>(text:string,values?:readonly unknown[])=>client.query<R>(text,values?[...values]:undefined)}); await client.query('COMMIT'); return result; } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } }
