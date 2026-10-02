import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import { PostgresEntityRepository } from '../../src/repositories/EntityRepository.js';
import { PostgresWorkRepository } from '../../src/repositories/WorkRepository.js';
import { EntityService } from '../../src/services/entity/EntityService.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { decodeWorkListCursor, encodeWorkListCursor, decodeEntityListCursor, decodePageListCursor } from '../../src/domain/pagination.js';
import { StoryService } from '../../src/services/story/StoryService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf } from './asyncPostgresAssertions.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl ? describe : describe.skip;
// Design: optional CAS is enforced by the write itself, retaining ownership and state locks.
describePostgres('story shipped revision compatibility', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: PostgresStoryRepository;
  let service: StoryService;
  const schema = `story_revision_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    const database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    repository = new PostgresStoryRepository(database, database);
    service = new StoryService(repository, { countByIdsAndWorkIdAndUserId: async () => 0 });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  async function fixture() {
    const user = randomUUID(); const work = randomUUID(); const chapter = randomUUID(); const episode = randomUUID();
    await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [user, `cas-${user}`, `${user}@example.invalid`]);
    await pool.query("INSERT INTO works (id,user_id,title,theme) VALUES ($1,$2,'work','keep theme')", [work,user]);
    await pool.query('INSERT INTO chapters (id,work_id,"order",purpose) VALUES ($1,$2,1,\'keep purpose\')', [chapter,work]);
    await pool.query('INSERT INTO episodes (id,chapter_id,"order",introduction) VALUES ($1,$2,1,\'keep introduction\')', [episode,chapter]);
    return { user,work,chapter,episode };
  }

  it.each(['work','chapter','episode'] as const)('%s 同一revisionの競合保存は一件だけ成功し履歴を増やす', async (kind) => {
    const ids = await fixture();
    const read = () => kind === 'work' ? repository.findWorkByIdAndUserId(ids.work, ids.user) : kind === 'chapter' ? repository.findChapterByIdAndUserId(ids.chapter, ids.user) : repository.findEpisodeByIdAndUserId(ids.episode, ids.user);
    const update = (title: string, revision: string) => kind === 'work' ? service.updateWork(ids.user, ids.work, { title, expectedUpdatedAt: revision }) : kind === 'chapter' ? service.updateChapter(ids.user, ids.chapter, { title, expectedUpdatedAt: revision }) : service.updateEpisode(ids.user, ids.episode, { title, expectedUpdatedAt: revision });
    const before = (await read())!;
    const outcomes = await Promise.allSettled([update('first',before.updatedAt.toISOString()),update('second',before.updatedAt.toISOString())]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: { code: 'RESOURCE_STALE', statusCode: 409 } });
    const after = (await read())!;
    expect(after.version).toBe(before.version + 1);
    expect(after.editHistory).toHaveLength(1);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('開始状態clearを含むstale保存はどのfieldも変えず、legacy省略保存は既存fieldを残す', async () => {
    const ids = await fixture();
    const before = (await repository.findEpisodeByIdAndUserId(ids.episode,ids.user))!;
    await service.updateEpisode(ids.user,ids.episode,{title:'latest',expectedUpdatedAt:before.updatedAt.toISOString()});
    expect(await rejectionOf(service.updateEpisode(ids.user,ids.episode,{title:'stale',startingEntityStates:[],expectedUpdatedAt:before.updatedAt.toISOString()}))).toMatchObject({code:'RESOURCE_STALE'});
    const latest = await service.updateEpisode(ids.user,ids.episode,{title:'legacy'});
    expect(latest).toMatchObject({title:'legacy',introduction:'keep introduction',version:3,startingEntityStates:[]});
    expect(latest.editHistory).toHaveLength(2);
    const cleared = await service.updateEpisode(ids.user,ids.episode,{startingEntityStates:[],expectedUpdatedAt:latest.updatedAt.toISOString()});
    expect(cleared.version).toBe(4);
  });

  it('未来の既存timestampでも連続保存revisionはmillisecond単位で増加し、foreign scopeは404のまま', async () => {
    const ids = await fixture();
    await pool.query("UPDATE works SET updated_at='2099-01-01T00:00:00.123456Z' WHERE id=$1",[ids.work]);
    const before = (await repository.findWorkByIdAndUserId(ids.work,ids.user))!;
    const first = await service.updateWork(ids.user,ids.work,{title:'first',expectedUpdatedAt:before.updatedAt.toISOString()});
    const second = await service.updateWork(ids.user,ids.work,{title:'second',expectedUpdatedAt:first.updatedAt.toISOString()});
    expect(first.updatedAt.getTime()).toBe(before.updatedAt.getTime()+1);
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime()+1);
    expect(second.theme).toBe('keep theme');
    expect(await rejectionOf(service.updateWork(randomUUID(),ids.work,{title:'foreign',expectedUpdatedAt:first.updatedAt.toISOString()}))).toMatchObject({code:'NOT_FOUND'});
    expect(await rejectionOf(service.updateWork(ids.user,ids.work,{title:'foreign org',expectedUpdatedAt:first.updatedAt.toISOString()},randomUUID()))).toMatchObject({code:'NOT_FOUND'});
  });
  it('entityも同一revision競合を拒否しlegacy部分更新とforeign拒否を維持する', async () => {
    const ids = await fixture();
    const database = new TestDatabase(pool);
    const entities = new PostgresEntityRepository(database);
    const entityService = new EntityService(entities,new PostgresWorkRepository(database));
    const entity = await entities.create({workId:ids.work,userId:ids.user,entityType:'character',name:'original',freeDescription:'keep',promptSupplement:null,structuredFields:{},speechProfile:{}});
    await pool.query("UPDATE entities SET updated_at='2099-01-01T00:00:00.123456Z' WHERE id=$1",[entity.id]);
    const before = (await entities.findByIdAndUserId(entity.id,ids.user))!;
    const results = await Promise.allSettled(['one','two'].map(name => entityService.updateEntity(ids.user,entity.id,{name,expectedUpdatedAt:before.updatedAt.toISOString()})));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'RESOURCE_STALE'}});
    const saved = (await entities.findByIdAndUserId(entity.id,ids.user))!;
    expect(saved.updatedAt.getTime()).toBe(before.updatedAt.getTime()+1);
    const legacy = await entityService.updateEntity(ids.user,entity.id,{name:'legacy'});
    expect(legacy.freeDescription).toBe('keep');
    expect(legacy.updatedAt.getTime()).toBe(saved.updatedAt.getTime()+1);
    expect(await rejectionOf(entityService.updateEntity(randomUUID(),entity.id,{name:'foreign',expectedUpdatedAt:legacy.updatedAt.toISOString()}))).toMatchObject({code:'NOT_FOUND'});
    expect(await rejectionOf(entityService.updateEntity(ids.user,entity.id,{name:'foreign org',expectedUpdatedAt:legacy.updatedAt.toISOString()},randomUUID()))).toMatchObject({code:'NOT_FOUND'});
  });

  it('production works cursorは同一timestampをID順で継続しcandidate順とtenant境界を混同しない', async () => {
    const ids = await fixture();
    const other = await fixture();
    const workIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
    for (const [index,id] of workIds.entries()) await pool.query(
      "INSERT INTO works (id,user_id,title,updated_at,created_at) VALUES ($1,$2,'cursor','2098-01-01T00:00:00.000Z',$3)",
      [id,ids.user, ['2097-02-01T00:00:00Z','2097-01-01T00:00:00Z','2097-03-01T00:00:00Z'][index]]);
    await pool.query("UPDATE works SET updated_at='2098-01-01T00:00:00Z' WHERE id=$1",[other.work]);
    const wire = Buffer.from(JSON.stringify({v:1,k:'works',sort:'2098-01-01T00:00:00.000Z',id:workIds[2]})).toString('base64url');
    const first = await repository.findWorksPageByUserId(ids.user,{limit:1,cursor:decodeWorkListCursor(wire)});
    expect(first.works.map(work=>work.id)).toEqual([workIds[1]]);
    const nextWire = encodeWorkListCursor(first.nextCursor!);
    expect(JSON.parse(Buffer.from(nextWire,'base64url').toString())).toEqual({v:1,k:'works',sort:'2098-01-01T00:00:00.000Z',id:workIds[1]});
    const second = await repository.findWorksPageByUserId(ids.user,{limit:1,cursor:decodeWorkListCursor(nextWire)});
    expect(second.works.map(work=>work.id)).toEqual([workIds[0]]);
    const candidate = await repository.findWorksPageByUserId(ids.user,{limit:2,cursor:{updatedAt:new Date('2098-01-01T00:00:00Z'),createdAt:new Date('2097-03-01T00:00:00Z'),id:workIds[2]!}});
    expect(candidate.works.map(work=>work.id)).toEqual([workIds[0],workIds[1]]);
    const foreignScope = await repository.findWorksPageByUserId(ids.user,{limit:100,cursor:decodeWorkListCursor(wire)},randomUUID());
    expect(foreignScope.works).toEqual([]);
    const otherScope = await repository.findWorksPageByUserId(other.user,{limit:100,cursor:decodeWorkListCursor(wire)});
    expect(otherScope.works.every(work=>work.userId===other.user)).toBe(true);
  });

  it('production entities/pages cursorの同順位境界でも別workや別tenantを返さない', async () => {
    const ids = await fixture(); const foreign = await fixture();
    const database = new TestDatabase(pool);
    const entities = new PostgresEntityRepository(database); const pages = new PostgresPageRepository(database);
    const entityIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'];
    for (const id of entityIds) await pool.query("INSERT INTO entities (id,work_id,user_id,entity_type,name,created_at) VALUES ($1,$2,$3,'character','cursor','2098-01-01T00:00:00Z')",[id,ids.work,ids.user]);
    await entities.create({workId:foreign.work,userId:foreign.user,entityType:'character',name:'foreign',freeDescription:null,promptSupplement:null,structuredFields:{},speechProfile:{}});
    const entityWire = Buffer.from(JSON.stringify({v:1,k:'entities',sort:'2098-01-01T00:00:00.000Z',id:entityIds[2]})).toString('base64url');
    const entityCursor = decodeEntityListCursor(entityWire);
    expect((await entities.findPageByWorkIdAndUserId(ids.work,ids.user,{limit:2,cursor:entityCursor})).entities.map(entity=>entity.id)).toEqual([entityIds[1],entityIds[0]]);
    expect((await entities.findPageByWorkIdAndUserId(ids.work,foreign.user,{limit:2,cursor:entityCursor})).entities).toEqual([]);
    expect((await entities.findPageByWorkIdAndUserId(ids.work,ids.user,{limit:2,cursor:entityCursor},randomUUID())).entities).toEqual([]);
    const pageIds = [randomUUID(),randomUUID(),randomUUID()];
    for (const [index,id] of pageIds.entries()) await pool.query('INSERT INTO pages (id,episode_id,page_number) VALUES ($1,$2,$3)',[id,ids.episode,index+1]);
    const pageWire = Buffer.from(JSON.stringify({v:1,k:'pages',sort:1,id:pageIds[0]})).toString('base64url');
    const pageCursor = decodePageListCursor(pageWire);
    expect((await pages.findPagesPageByEpisodeIdAndUserId(ids.episode,ids.user,{limit:2,cursor:pageCursor})).pages.map(page=>page.id)).toEqual(pageIds.slice(1));
    expect((await pages.findPagesPageByEpisodeIdAndUserId(ids.episode,foreign.user,{limit:2,cursor:pageCursor})).pages).toEqual([]);
    expect((await pages.findPagesPageByEpisodeIdAndUserId(ids.episode,ids.user,{limit:2,cursor:pageCursor},randomUUID())).pages).toEqual([]);
  });

  it('cross_chapter省略は境界で止まり明示移動は同一作品の話IDとpageを保持する', async () => {
    const ids=await fixture();const nextChapter=randomUUID(),nextEpisode=randomUUID(),page=randomUUID();
    await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,2)',[nextChapter,ids.work]);
    await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[nextEpisode,nextChapter]);
    await pool.query('INSERT INTO pages(id,episode_id,page_number) VALUES($1,$2,1)',[page,ids.episode]);
    expect((await repository.moveEpisode(ids.episode,ids.user,'down'))?.chapterId).toBe(ids.chapter);
    const moved=await repository.moveEpisode(ids.episode,ids.user,'down',null,true);
    expect(moved).toMatchObject({id:ids.episode,chapterId:nextChapter,order:1,introduction:'keep introduction'});
    expect((await repository.findEpisodeByIdAndUserId(nextEpisode,ids.user))?.order).toBe(2);
    expect((await pool.query('SELECT episode_id FROM pages WHERE id=$1',[page])).rows[0]).toEqual({episode_id:ids.episode});
    expect(await repository.moveEpisode(ids.episode,randomUUID(),'up',null,true)).toBeNull();
    const restored=await repository.moveEpisode(ids.episode,ids.user,'up',null,true);
    expect(restored).toMatchObject({id:ids.episode,chapterId:ids.chapter,order:1});
  });

});

class TestDatabase implements DatabaseClient, TransactionRunner {
  constructor(private readonly pool: Pool) {}
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> { return this.pool.query<T>(text, values ? [...values] : undefined); }
  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({ query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<R>(text, values ? [...values] : undefined) });
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
