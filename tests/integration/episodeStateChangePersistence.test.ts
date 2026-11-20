import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import type { EpisodePagePlanContext } from '../../src/domain/types/page.js';
import { PostgresEpisodeStateChangeRepository } from '../../src/repositories/EpisodeStateChangeRepository.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../src/repositories/EpisodePlanPersistenceRepository.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl ? describe : describe.skip;

describePostgres('episode state-change persistence', () => {
  let admin: Pool;
  let pool: Pool;
  let database: TestDatabase;
  const schema = `episode_state_change_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA ${schema} CASCADE`); await admin?.end(); });

  it('原文literalのdraftだけを一度保存し、同一引用内の別deltaを統合しない', async () => {
    const ids = await fixture(pool);
    const context = pageContext(ids);
    const changes = [
      { entityId: ids.entity, candidateStateId: null, startsAtPanelId: ids.panel, suggestedName: '負傷', suggestedDescription: '左頬に赤い傷', sourceSceneId: null, sourceField: 'story_full_draft' as const, sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。', reason: 'missing_reference' as const },
      { entityId: ids.entity, candidateStateId: null, startsAtPanelId: ids.panel, suggestedName: '発光', suggestedDescription: '右目が青く光る', sourceSceneId: null, sourceField: 'story_full_draft' as const, sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。', reason: 'missing_reference' as const },
    ];
    const first = await database.transaction(async (client) => new PostgresEpisodeStateChangeRepository(client, context).persist(changes));
    const retry = await database.transaction(async (client) => new PostgresEpisodeStateChangeRepository(client, context).persist(changes));
    expect(first.map((item) => item.created)).toEqual([true, true]);
    expect(retry.map((item) => item.created)).toEqual([false, false]);
    expect((await pool.query('SELECT name,description,reference_image,scene_id FROM entity_states WHERE entity_id=$1 ORDER BY name', [ids.entity])).rows)
      .toEqual([{ name: '発光', description: '右目が青く光る', reference_image: null, scene_id: null }, { name: '負傷', description: '左頬に赤い傷', reference_image: null, scene_id: null }]);
    expect((await pool.query('SELECT free_description FROM entities WHERE id=$1', [ids.entity])).rows[0]).toEqual({ free_description: '手入力の正本' });
  });

  it('foreign entity/panelと挿入後エラーを拒否し、transactionをロールバックする', async () => {
    const ids = await fixture(pool);
    const context = pageContext(ids);
    const foreign = { entityId: randomUUID(), candidateStateId: null, startsAtPanelId: ids.panel, suggestedName: '負傷', suggestedDescription: '左頬に赤い傷', sourceSceneId: null, sourceField: 'story_full_draft' as const, sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。', reason: 'missing_reference' as const };
    await expect(database.transaction(async (client) => new PostgresEpisodeStateChangeRepository(client, context).persist([foreign]))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(database.transaction(async (client) => {
      await new PostgresEpisodeStateChangeRepository(client, context).persist([{ ...foreign, entityId: ids.entity }]);
      throw new Error('after insert');
    })).rejects.toThrow('after insert');
    expect((await pool.query('SELECT id FROM entity_states WHERE entity_id=$1', [ids.entity])).rows).toEqual([]);
  });

  it('contextに混入した別work entityはSQL境界でdraftを作らない', async () => {
    const ids = await fixture(pool);
    const foreignWork = randomUUID();
    const foreignEntity = randomUUID();
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'foreign')", [foreignWork, ids.user]);
    await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name) VALUES($1,$2,$3,'character','別人')", [foreignEntity, foreignWork, ids.user]);
    const context = pageContext(ids);
    context.entities = [{ ...context.entities[0]!, id: foreignEntity }];
    const change = { entityId: foreignEntity, candidateStateId: null, startsAtPanelId: ids.panel, suggestedName: '負傷', suggestedDescription: '左頬に赤い傷', sourceSceneId: null, sourceField: 'story_full_draft' as const, sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。', reason: 'missing_reference' as const };
    await expect(database.transaction(async (client) => new PostgresEpisodeStateChangeRepository(client, context).persist([change]))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await pool.query('SELECT id FROM entity_states WHERE entity_id=$1', [foreignEntity])).rows).toEqual([]);
  });

  it('withLockedEpisodePlan内のdraft・page更新・commit markerは後続失敗で全てrollbackする', async () => {
    const ids = await fixture(pool);
    const jobId = randomUUID();
    await pool.query(`INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params) VALUES($1,$2,'episode_story_autofill','queued',0,$3::jsonb)`, [jobId, ids.user, JSON.stringify({ episode_id: ids.episode, language: 'ja' })]);
    const job = await new PostgresEpisodeStoryAutofillExecutionRepository(database, 'canonical').claimQueuedEpisodeStoryAutofillJob(jobId);
    if (job === null) throw new Error('job claim failed');
    const persistence = new PostgresEpisodePlanPersistenceRepository(database, 'canonical');
    const change = { entityId: ids.entity, candidateStateId: null, startsAtPanelId: ids.panel, suggestedName: '負傷', suggestedDescription: '左頬に赤い傷', sourceSceneId: null, sourceField: 'story_full_draft' as const, sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。', reason: 'missing_reference' as const };
    await expect(persistence.withLockedEpisodePlan({ episodeId: ids.episode, userId: ids.user, organizationId: null, storyAutofillAttempt: job }, async (_context, resources) => {
      await resources.persistStateChanges?.([change]);
      await resources.pageRepository.updatePageSettings(ids.page, ids.user, { dialogueMode: 'mixed' });
      throw new Error('after state draft');
    })).rejects.toThrow('after state draft');
    expect((await pool.query('SELECT id FROM entity_states WHERE entity_id=$1', [ids.entity])).rows).toEqual([]);
    expect((await pool.query('SELECT dialogue_mode FROM pages WHERE id=$1', [ids.page])).rows[0]).toEqual({ dialogue_mode: 'image_baked' });
    expect((await pool.query('SELECT status,commit_started_at FROM generation_jobs WHERE id=$1', [jobId])).rows[0]).toEqual({ status: 'processing', commit_started_at: null });
  });
});

async function fixture(pool: Pool): Promise<{ user: string; work: string; episode: string; entity: string; page: string; panel: string }> {
  const [user, work, chapter, episode, entity, page, panel] = Array.from({ length: 7 }, () => randomUUID());
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [user, user, `${user}@example.invalid`]);
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'w')", [work, user]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapter, work]);
  await pool.query("INSERT INTO episodes(id,chapter_id,\"order\",story_input_mode,story_full_draft) VALUES($1,$2,1,'full',$3)", [episode, chapter, 'ミオの左頬に赤い傷があり、右目が青く光る。']);
  await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name,free_description) VALUES($1,$2,$3,'character','ミオ','手入力の正本')", [entity, work, user]);
  await pool.query('INSERT INTO pages(id,episode_id,page_number) VALUES($1,$2,1)', [page, episode]);
  await pool.query('INSERT INTO panels(id,page_id,"order") VALUES($1,$2,1)', [panel, page]);
  return { user, work, episode, entity, page, panel };
}

function pageContext(ids: Awaited<ReturnType<typeof fixture>>): EpisodePagePlanContext {
  return { episodeId: ids.episode, workId: ids.work, chapter: { id: 'chapter', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] }, episode: { title: null, purpose: null, storyFullDraft: 'ミオの左頬に赤い傷があり、右目が青く光る。', introduction: null, middle: null, climax: null, endingHook: null, estimatedPages: 1 }, scenes: [], entities: [{ id: ids.entity, name: 'ミオ', entityType: 'character', freeDescription: '手入力の正本', promptSupplement: null, structuredFields: {} }], pages: [{ pageId: 'page', pageNumber: 1, frameCount: 1, layoutConfig: {}, status: 'designing', dialogueMode: 'image_baked', pageDialogueToggle: true, panels: [{ id: ids.panel, order: 1, panelRole: 'action', panelSize: 'standard', situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: true, dialogue: [], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] }] }] };
}

class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
}
