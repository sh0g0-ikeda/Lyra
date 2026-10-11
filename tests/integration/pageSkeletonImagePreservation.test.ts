import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresStoryRepository } from '../../src/repositories/StoryRepository.js';
import type { PageSkeletonPageDraft } from '../../src/domain/types/storyAi.js';
import { createSyntheticPostgresDatabase, type SyntheticPostgresDatabase } from './postgresTestDatabase.js';

const suite = process.env.APP_ENV === 'test' && process.env.DATABASE_URL !== undefined ? describe : describe.skip;

suite('page skeleton generated image preservation', () => {
  let database: SyntheticPostgresDatabase;

  beforeAll(async () => {
    database = await createSyntheticPostgresDatabase({ databaseUrl: process.env.DATABASE_URL!, prefix: 'delupload', max: 8 });
    await runPendingMigrations(database.database);
  }, 120_000);
  afterAll(async () => { await database?.close(); }, 30_000);

  it('safe overwrite keeps page ID, image, and balloons while rebuilding panels and frames', async () => {
    const fixture = await insertFixture();
    const repository = new PostgresStoryRepository(database.database, database.database);
    await expect(repository.createPageSkeleton(fixture.episodeId, fixture.userId, plan(1), {
      overwriteExisting: true, preserveGeneratedImages: true,
    })).resolves.toMatchObject({ pagesCreated: 1, panelsCreated: 1, replacedExisting: true });

    expect((await database.pool.query('SELECT id, generated_image, status FROM pages WHERE id=$1', [fixture.pageId])).rows[0]).toMatchObject({
      id: fixture.pageId, generated_image: fixture.image, status: 'designing',
    });
    expect((await database.pool.query('SELECT count(*)::int AS count FROM panels WHERE page_id=$1', [fixture.pageId])).rows[0]?.count).toBe(1);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM panel_frames WHERE page_id=$1', [fixture.pageId])).rows[0]?.count).toBe(1);
    expect((await database.pool.query('SELECT text FROM balloons WHERE page_id=$1', [fixture.pageId])).rows[0]?.text).toBe('saved balloon');
    expect(await repository.rollbackFreshPageSkeleton(fixture.episodeId, fixture.userId, 1)).toBe(false);
  });

  it('safe overwrite rejects a plan that omits an existing page and active page generation', async () => {
    const fixture = await insertFixture();
    const repository = new PostgresStoryRepository(database.database, database.database);
    await database.pool.query('INSERT INTO pages(episode_id,page_number) VALUES($1,2)', [fixture.episodeId]);
    await expect(repository.createPageSkeleton(fixture.episodeId, fixture.userId, plan(1), {
      overwriteExisting: true, preserveGeneratedImages: true,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    await database.pool.query('DELETE FROM pages WHERE episode_id=$1 AND page_number=2', [fixture.episodeId]);
    await database.pool.query(
      "INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params) VALUES($1,$2,'page_generate','queued',0,$3::jsonb)",
      [randomUUID(), fixture.userId, JSON.stringify({ page_id: fixture.pageId })],
    );
    await expect(repository.createPageSkeleton(fixture.episodeId, fixture.userId, plan(1), {
      overwriteExisting: true, preserveGeneratedImages: true,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('legacy overwrite without the preserve flag retains delete-and-recreate behavior', async () => {
    const fixture = await insertFixture();
    const repository = new PostgresStoryRepository(database.database, database.database);
    await repository.createPageSkeleton(fixture.episodeId, fixture.userId, plan(1), { overwriteExisting: true });
    const row = (await database.pool.query<{ id: string; generated_image: unknown }>('SELECT id, generated_image FROM pages WHERE episode_id=$1', [fixture.episodeId])).rows[0];
    expect(row?.id).not.toBe(fixture.pageId);
    expect(row?.generated_image).toBeNull();
  });

  async function insertFixture(): Promise<{ userId: string; episodeId: string; pageId: string; image: object }> {
    const userId = randomUUID(); const workId = randomUUID(); const chapterId = randomUUID(); const episodeId = randomUUID(); const pageId = randomUUID();
    const image = { s3_key: `saved/${pageId}.png`, generation_mode: 'standard' };
    await database.pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, userId, `${userId}@example.invalid`]);
    await database.pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'preserve')", [workId, userId]);
    await database.pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
    await database.pool.query('INSERT INTO episodes(id,chapter_id,"order",estimated_pages,page_skeleton_generated) VALUES($1,$2,1,1,TRUE)', [episodeId, chapterId]);
    await database.pool.query('INSERT INTO pages(id,episode_id,page_number,generated_image,status) VALUES($1,$2,1,$3::jsonb,\'generated\')', [pageId, episodeId, JSON.stringify(image)]);
    await database.pool.query('INSERT INTO panels(page_id,"order") VALUES($1,1)', [pageId]);
    await database.pool.query("INSERT INTO balloons(page_id,text,position) VALUES($1,'saved balloon','{}'::jsonb)", [pageId]);
    return { userId, episodeId, pageId, image };
  }
});

function plan(pageNumber: number): PageSkeletonPageDraft[] {
  return [{ pageNumber, purpose: 'updated', suggestedPanelCount: 1, suggestedLayout: 'splash_1', panels: [
    { order: 1, panelRole: 'establish', suggestedSize: 'splash', situationHint: 'new', suggestedEntities: [], suggestedDialogueHint: null },
  ] }];
}
