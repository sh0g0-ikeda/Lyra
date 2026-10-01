import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type { DatabaseClient,TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEpisodeExportJobRepository } from '../../src/repositories/EpisodeExportJobRepository.js';
import { PostgresPageRepository } from '../../src/repositories/PageRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
const databaseUrl=process.env.DATABASE_URL;
const suite=process.env.APP_ENV==='test'&&databaseUrl!==undefined?describe:describe.skip;
class Database implements DatabaseClient,TransactionRunner {
 constructor(private readonly pool:Pool){}
 query<T extends QueryResultRow=QueryResultRow>(sql:string,values?:readonly unknown[]):Promise<QueryResult<T>> {return this.pool.query<T>(sql,values===undefined?undefined:[...values]);}
 async transaction<T>(work:(client:DatabaseClient)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query('BEGIN');const result=await work({query:<R extends QueryResultRow=QueryResultRow>(sql:string,values?:readonly unknown[])=>c.query<R>(sql,values===undefined?undefined:[...values])});await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
}
suite('画像provenanceの実DB保持とexport境界',()=>{
 let admin:Pool;let pool:Pool;let schema:string;
 beforeAll(async()=>{schema=`image_provenance_${process.pid}_${Date.now()}`;admin=new Pool({connectionString:databaseUrl});await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`});await withPostgresTestMigrationLock(admin,()=>runPendingMigrations(new Database(pool)));},120000);
 afterAll(async()=>{await pool?.end();if(admin&&schema){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
 it('モデルを保存し通常exportは拒否、認可Web snapshotは保持、途中の切替を検出する',async()=>{
  const user=randomUUID(),work=randomUUID(),chapter=randomUUID(),episode=randomUUID(),page=randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)',[user,`test-${user}`,`${user}@example.invalid`]);
  await pool.query('INSERT INTO works(id,user_id,title) VALUES($1,$2,$3)',[work,user,'Fixture']);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)',[chapter,work]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)',[episode,chapter]);
  await pool.query('INSERT INTO pages(id,episode_id,page_number,status) VALUES($1,$2,1,$3)',[page,episode,'generated']);
  const db=new Database(pool),pages=new PostgresPageRepository(db),exports=new PostgresEpisodeExportJobRepository(db,db);
  const image={s3Key:`saved/${user}/pages/${page}_final.png`,cdnUrl:null,generationMode:'standard' as const,generatedAt:'2026-10-01T00:00:00.000Z',imageModel:'gpt-image-2',providerModelId:'gpt-image-2',provider:'openai'};
  await pages.updateGeneratedImageAndState(page,user,{status:'generated',generationMode:'standard',generatedImage:image});
  expect((await pages.findPageByIdAndUserId(page,user))?.generatedImage).toMatchObject({imageModel:'gpt-image-2',provider:'openai'});
  const input={userId:user,organizationId:null,episodeId:episode,pageIds:[page],format:'pdf' as const,filename:'fixture.pdf',requestFingerprint:'a'.repeat(64),idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000)};
  const legacyCompatible=await exports.createOrGet(input);expect(legacyCompatible.job.pageSnapshot[0]?.imageModel).toBe('gpt-image-2');
  expect(await exports.isSourceSnapshotCurrent(legacyCompatible.job)).toBe(true);
  const webImage={...image,imageModel:'hy4-preview',providerModelId:'hy4-preview',provider:'tencent'};
  await pages.updateGeneratedImageAndState(page,user,{status:'generated',generationMode:'standard',generatedImage:webImage});
  expect(await exports.isSourceSnapshotCurrent(legacyCompatible.job)).toBe(false);
  await expect(exports.createOrGet({...input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'IMAGE_WEB_ONLY'});
  const web=await exports.createOrGet({...input,filename:'web.pdf',requestFingerprint:'b'.repeat(64),idempotencyKey:randomUUID(),audience:'authorized_web'});
  expect(web.job.pageSnapshot[0]).toMatchObject({imageModel:'hy4-preview',provider:'tencent'});
  expect(await exports.isSourceSnapshotCurrent(web.job)).toBe(true);
  await pages.updateGeneratedImageAndState(page,user,{status:'generated',generationMode:'standard',generatedImage:{...image,imageModel:'unregistered'}});
  await expect(exports.createOrGet({...input,idempotencyKey:randomUUID(),audience:'authorized_web'})).rejects.toMatchObject({code:'IMAGE_MODEL_UNAVAILABLE'});
  expect(await exports.isSourceSnapshotCurrent({...web.job,userId:randomUUID()})).toBe(false);
  expect(Number((await pool.query('SELECT COUNT(*) AS n FROM episode_export_jobs')).rows[0].n)).toBe(2);
 });
});
