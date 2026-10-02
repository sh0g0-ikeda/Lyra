import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { checkStateReleasePreflight } from '../../scripts/checkStateReleasePreflight.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf } from './asyncPostgresAssertions.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL !== undefined
  ? describe : describe.skip;

// Design: replay exact immutable 001-039 files in an isolated schema, populate
// legacy rows, then rehearse bounded lock failure and additive 040/041 retry.
// This is synthetic compatibility evidence, never a production-size claim.
describePostgres('state release migration rehearsal', () => {
  it('既存1万件を保持し、ロック失敗を全rollbackしてから040/041を再適用できる', async () => {
    const schema = `state_release_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    const boundedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c lock_timeout=150ms`,
    });
    const legacyDir = await mkdtemp(join(tmpdir(), 'lyra-schema039-'));
    const stateDir = await mkdtemp(join(tmpdir(), 'lyra-schema041-'));
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await withPostgresTestMigrationLock(admin, async () => {
      for (const filename of await readdir(join(process.cwd(), 'migrations'))) {
        if (/^\d{3}_.+\.sql$/u.test(filename) && Number(filename.slice(0, 3)) <= 39) {
          await copyFile(join(process.cwd(), 'migrations', filename), join(legacyDir, filename));
        }
        if (/^\d{3}_.+\.sql$/u.test(filename) && Number(filename.slice(0, 3)) <= 41) {
          await copyFile(join(process.cwd(), 'migrations', filename), join(stateDir, filename));
        }
      }
      await runPendingMigrations(new TestDatabase(pool), { migrationsDir: legacyDir });
      const userId = randomUUID();
      const workId = randomUUID();
      const chapterId = randomUUID();
      const entityId = randomUUID();
      await pool.query(`INSERT INTO users (id, supabase_id, email) VALUES ($1, $2, $3)`, [userId, userId, `${userId}@example.invalid`]);
      await pool.query(`INSERT INTO works (id, user_id, title) VALUES ($1, $2, 'Legacy')`, [workId, userId]);
      await pool.query(`INSERT INTO chapters (id, work_id, "order") VALUES ($1, $2, 1)`, [chapterId, workId]);
      await pool.query(`INSERT INTO entities (id, work_id, user_id, name) VALUES ($1, $2, $3, 'Legacy')`, [entityId, workId, userId]);
      await pool.query(`INSERT INTO episodes (chapter_id, "order", title) SELECT $1, n, 'Legacy ' || n FROM generate_series(1,10000) n`, [chapterId]);
      await pool.query(`INSERT INTO entity_states (entity_id, costume_note, extra_note) SELECT $1, 'costume ' || n, 'legacy ' || n FROM generate_series(1,10000) n`, [entityId]);
      await pool.query(`INSERT INTO credit_balances (user_id, purchased_credits) VALUES ($1, 30)`, [userId]);
      await pool.query(`INSERT INTO credit_ledger (user_id, type, amount, monthly_after, purchased_after, monthly_delta, purchased_delta)
        VALUES ($1, 'signup_bonus', 30, 0, 30, 0, 30)`, [userId]);
      const before = await fingerprint(pool);
      expect((await checkStateReleasePreflight(new TestDatabase(pool), 39)).ok).toBe(true);

      // A denied/abandoned deletion request has not started work and must not
      // prevent releases. Claimed and externally pending deletion must drain.
      await pool.query(`INSERT INTO account_deletion_requests (user_id, identity_id, status)
        VALUES ($1, $2, 'blocked')`, [userId, userId]);
      expect((await checkStateReleasePreflight(new TestDatabase(pool), 39)).ok).toBe(true);
      await pool.query('UPDATE users SET account_deletion_started_at = NOW() WHERE id = $1', [userId]);
      for (const status of ['processing', 'pending_external_action']) {
        await pool.query(`UPDATE account_deletion_requests SET status = $2,
          processing_token = $3, processing_started_at = NOW() WHERE user_id = $1`,
        [userId, status, randomUUID()]);
        const activeReport = await checkStateReleasePreflight(new TestDatabase(pool), 39);
        expect(activeReport.ok).toBe(false);
        expect(activeReport.violations).toEqual([{
          name: 'release.active_deletions', sampleIds: [userId],
        }]);
      }
      await pool.query('DELETE FROM account_deletion_requests WHERE user_id = $1', [userId]);
      await pool.query('UPDATE users SET account_deletion_started_at = NULL WHERE id = $1', [userId]);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE entity_states IN ACCESS SHARE MODE');
        expect(await rejectionOf(runPendingMigrations(new TestDatabase(boundedPool), { migrationsDir: stateDir }))).toMatchObject({ code: '55P03' });
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      expect((await checkStateReleasePreflight(new TestDatabase(pool), 39)).ok).toBe(true);
      expect(await fingerprint(pool)).toEqual(before);
      const applied = await runPendingMigrations(new TestDatabase(pool), { migrationsDir: stateDir });
      expect(applied).toEqual(['040_add_entity_state_variants.sql', '041_add_episode_starting_entity_states.sql']);
      expect(await fingerprint(pool)).toEqual(before);
      expect((await checkStateReleasePreflight(new TestDatabase(pool), 41)).ok).toBe(true);
      expect(await runPendingMigrations(new TestDatabase(pool), { migrationsDir: stateDir })).toEqual([]);
      expect((await pool.query(`SELECT COUNT(*)::int AS count FROM episodes WHERE starting_entity_states = '[]'::jsonb`)).rows[0]?.count).toBe(10000);
      expect((await pool.query(`SELECT COUNT(*)::int AS count FROM entity_states WHERE name IS NULL AND description IS NULL AND reference_image IS NULL`)).rows[0]?.count).toBe(10000);

      // Old API SQL continues to work against the expanded schema; it must not
      // erase new state data merely because an older client omits that field.
      await pool.query(`INSERT INTO entity_states (entity_id, costume_note) VALUES ($1, 'old writer')`, [entityId]);
      await pool.query(`UPDATE episodes SET starting_entity_states = '[{"entity_id":"${entityId}","state_id":null}]'::jsonb WHERE "order" = 1`);
      await pool.query(`UPDATE episodes SET title = 'old writer' WHERE "order" = 1`);
      expect((await pool.query(`SELECT starting_entity_states FROM episodes WHERE "order" = 1`)).rows[0]?.starting_entity_states).toHaveLength(1);
      expect(await rejectionOf(pool.query(`INSERT INTO entity_states (entity_id, name, description) VALUES ($1, '', 'invalid')`, [entityId]))).toMatchObject({ code: '23514' });
      });
    } finally {
      await pool.end();
      await boundedPool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
      await rm(legacyDir, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 120_000);
});

async function fingerprint(pool: Pool): Promise<unknown> {
  const result = await pool.query(`SELECT
    (SELECT md5(string_agg((to_jsonb(s) - ARRAY['name','description','reference_image','updated_at'])::text, '' ORDER BY id)) FROM entity_states s) AS states,
    (SELECT md5(string_agg((to_jsonb(e) - 'starting_entity_states')::text, '' ORDER BY id)) FROM episodes e) AS episodes,
    (SELECT md5(string_agg(to_jsonb(c)::text, '' ORDER BY user_id)) FROM credit_balances c) AS balances,
    (SELECT md5(string_agg(to_jsonb(l)::text, '' ORDER BY id)) FROM credit_ledger l) AS ledger,
    (SELECT relfilenode::text FROM pg_class WHERE oid = 'entity_states'::regclass) AS states_heap,
    (SELECT relfilenode::text FROM pg_class WHERE oid = 'episodes'::regclass) AS episodes_heap`);
  return result.rows[0];
}

class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(operation: (db: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation({ query: <R extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<R>> => client.query<R>(sql, values === undefined ? undefined : [...values]) });
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
