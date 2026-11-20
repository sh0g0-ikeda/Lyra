import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresCharacterAutofillRepository } from '../../src/repositories/CharacterAutofillRepository.js';
import type { CharacterAutofillCandidate } from '../../src/services/story/CharacterAutofillFields.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl ? describe : describe.skip;

// Design: the repository owns the final version/authorization check and serializes
// a work roster so concurrent retries cannot create duplicate entities or states.
describePostgres('character autofill persistence', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: PostgresCharacterAutofillRepository;
  const schema = `character_autofill_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 });
    const database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
    repository = new PostgresCharacterAutofillRepository(database);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  async function fixture(): Promise<{ user: string; work: string; episode: string }> {
    const user = randomUUID();
    const work = randomUUID();
    const chapter = randomUUID();
    const episode = randomUUID();
    await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [
      user, `autofill-${user}`, `${user}@example.invalid`,
    ]);
    await pool.query("INSERT INTO works (id,user_id,title) VALUES ($1,$2,'work')", [work, user]);
    await pool.query('INSERT INTO chapters (id,work_id,"order") VALUES ($1,$2,1)', [chapter, work]);
    await pool.query('INSERT INTO episodes (id,chapter_id,"order",story_input_mode,story_full_draft) VALUES ($1,$2,1,\'full\',\'ミオとノアが走る。\')', [episode, chapter]);
    return { user, work, episode };
  }

  it('同時再実行でも既存本体を上書きせず、新規キャラと引用単位の状態を一度だけ追加する', async () => {
    const ids = await fixture();
    const existingId = randomUUID();
    await pool.query(
      `INSERT INTO entities (id,work_id,user_id,entity_type,name,free_description,structured_fields)
       VALUES ($1,$2,$3,'character','ミオ','手入力の正本', '{"character_identity":{"aliases":["Mio"]}}')`,
      [existingId, ids.work, ids.user],
    );
    await pool.query("INSERT INTO reference_sets (entity_id,status) VALUES ($1,'empty')", [existingId]);
    const candidates: CharacterAutofillCandidate[] = [
      {
        name: 'Mio', entityType: 'character', freeDescription: 'AIが作った説明', structuredFields: {},
        changes: [{ name: '負傷', description: '左頬に赤い傷', quote: 'ミオの左頬に赤い傷があり、右目が青く光る。' }],
      },
      {
        name: 'ノア', entityType: 'nonhuman', freeDescription: '青い翼を持つ',
        structuredFields: { distinctive_features: '青い翼' },
        changes: [{ name: '発光', description: '翼が光る', quote: 'ノアの翼が光る。' }],
      },
      {
        name: '影の人', entityType: null, freeDescription: null, structuredFields: {}, changes: [],
      },
    ];

    const results = await Promise.all([
      repository.saveCandidates({ userId: ids.user, episodeId: ids.episode, version: 1, organizationId: null, candidates }),
      repository.saveCandidates({ userId: ids.user, episodeId: ids.episode, version: 1, organizationId: null, candidates }),
    ]);

    expect(results.map((result) => result.skipped_names)).toEqual([['影の人'], ['影の人']]);
    expect(results.flatMap((result) => result.characters).filter((item) => item.name === 'ノア' && item.created)).toHaveLength(1);
    expect(results.flatMap((result) => result.characters).filter((item) => item.name === 'Mio' && item.created)).toHaveLength(0);
    const savedEntities = await pool.query<{ id: string; name: string; free_description: string | null }>(
      'SELECT id,name,free_description FROM entities WHERE work_id=$1 ORDER BY name', [ids.work],
    );
    expect(savedEntities.rows).toHaveLength(2);
    expect(savedEntities.rows.find((row) => row.id === existingId)?.free_description).toBe('手入力の正本');
    const states = await pool.query<{ entity_id: string; name: string; description: string; extra_note: string }>(
      'SELECT entity_id,name,description,extra_note FROM entity_states WHERE entity_id = ANY($1::uuid[]) ORDER BY entity_id',
      [savedEntities.rows.map((row) => row.id)],
    );
    expect(states.rows).toHaveLength(2);
    expect(states.rows.map((row) => row.extra_note).sort()).toEqual(['ノアの翼が光る。', 'ミオの左頬に赤い傷があり、右目が青く光る。']);

    const retry = await repository.saveCandidates({
      userId: ids.user, episodeId: ids.episode, version: 1, organizationId: null,
      candidates: [{
        name: 'ミオ', entityType: 'character', freeDescription: null, structuredFields: {},
        changes: [
          { name: '頬の異変', description: '頬に赤い傷', quote: '左頬に赤い傷' },
          { name: '目の変化', description: '右目が青く光る', quote: 'ミオの左頬に赤い傷があり、右目が青く光る。' },
        ],
      }],
    });
    expect(retry.characters).toEqual([{ entity_id: existingId, name: 'ミオ', created: false, states_added: 1 }]);
    const retriedStates = await pool.query<{ name: string; extra_note: string }>(
      'SELECT name,extra_note FROM entity_states WHERE entity_id=$1', [existingId],
    );
    expect(retriedStates.rows).toHaveLength(2);
    expect(retriedStates.rows).toEqual(expect.arrayContaining([
      { name: '負傷', extra_note: 'ミオの左頬に赤い傷があり、右目が青く光る。' },
      { name: '目の変化', extra_note: 'ミオの左頬に赤い傷があり、右目が青く光る。' },
    ]));
  });

  it('同名が複数ある曖昧候補と種別不明の新規候補は書き込まず名前を報告する', async () => {
    const ids = await fixture();
    const ambiguousIds = [randomUUID(), randomUUID()];
    for (const id of ambiguousIds) {
      await pool.query(
        "INSERT INTO entities (id,work_id,user_id,entity_type,name) VALUES ($1,$2,$3,'character','レン')",
        [id, ids.work, ids.user],
      );
      await pool.query("INSERT INTO reference_sets (entity_id,status) VALUES ($1,'empty')", [id]);
    }
    const result = await repository.saveCandidates({
      userId: ids.user,
      episodeId: ids.episode,
      version: 1,
      organizationId: null,
      candidates: [
        { name: 'レン', entityType: 'character', freeDescription: null, structuredFields: {}, changes: [
          { name: '変化', description: '髪が光る', quote: 'レンの髪が光る。' },
        ] },
        { name: '正体不明', entityType: null, freeDescription: null, structuredFields: {}, changes: [] },
      ],
    });
    expect(result).toEqual({ version: 1, characters: [], skipped_names: ['レン', '正体不明'] });
    expect((await pool.query('SELECT id FROM entity_states WHERE entity_id = ANY($1::uuid[])', [ambiguousIds])).rows).toEqual([]);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM entities WHERE work_id=$1', [ids.work])).rows[0])
      .toEqual({ count: 2 });
  });

  it('組織作品は保存時点のedit_workロールをロックして再確認する', async () => {
    const ids = await fixture();
    const organizationId = randomUUID();
    await pool.query(
      "INSERT INTO organizations (id,name,created_by_user_id,status) VALUES ($1,'org',$2,'active')",
      [organizationId, ids.user],
    );
    await pool.query(
      "INSERT INTO organization_members (organization_id,user_id,role,status) VALUES ($1,$2,'editor','active')",
      [organizationId, ids.user],
    );
    await pool.query('UPDATE works SET organization_id=$1 WHERE id=$2', [organizationId, ids.work]);
    const input = {
      userId: ids.user,
      episodeId: ids.episode,
      version: 1,
      organizationId,
      candidates: [{
        name: 'ミオ', entityType: 'character' as const, freeDescription: null,
        structuredFields: {}, changes: [],
      }],
    };

    await expect(repository.saveCandidates(input)).resolves.toMatchObject({
      characters: [{ name: 'ミオ', created: true }],
    });
    await pool.query(
      "UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2",
      [organizationId, ids.user],
    );
    await expect(repository.saveCandidates(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM entities WHERE work_id=$1', [ids.work])).rows[0])
      .toEqual({ count: 1 });
  });

  it('保存トランザクション内でepisode versionが変わっていれば一件も書かない', async () => {
    const ids = await fixture();
    await pool.query('UPDATE episodes SET version=2 WHERE id=$1', [ids.episode]);
    await expect(repository.saveCandidates({
      userId: ids.user,
      episodeId: ids.episode,
      version: 1,
      organizationId: null,
      candidates: [{
        name: 'ミオ', entityType: 'character', freeDescription: null,
        structuredFields: {}, changes: [],
      }],
    })).rejects.toMatchObject({ code: 'RESOURCE_STALE' });
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM entities WHERE work_id=$1', [ids.work])).rows[0])
      .toEqual({ count: 0 });
  });
});

class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}

  public query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
          client.query<R>(text, values === undefined ? undefined : [...values]),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
