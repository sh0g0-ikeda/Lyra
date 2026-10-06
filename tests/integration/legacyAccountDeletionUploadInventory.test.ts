import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { LegacyAccountDeletionServiceAdapter } from '../../src/legacy/account/LegacyAccountDeletionServiceAdapter.js';
import { assertLegacyPersonalWriteAllowed } from '../../src/repositories/LegacyAccountDeletionWriteFence.js';
import {
  createSyntheticPostgresDatabase,
  type SyntheticPostgresDatabase,
} from './postgresTestDatabase.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
/** Spec 5/8/11: existing upload records fence deletion; temporary keys are not
 * consent-bearing saved assets. This is not proof of expired remote PUT quiescence. */
describePostgres('legacy deletion upload inventory on dedicated old38 database', () => {
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  let repository: PostgresLegacyAccountDeletionRepository;
  let synthetic: SyntheticPostgresDatabase;

  beforeAll(async () => {
    synthetic = await createSyntheticPostgresDatabase({
      databaseUrl: process.env.DATABASE_URL!,
      prefix: 'delupload',
      max: 8,
      statementTimeoutMs: 15_000,
    });
    pool = synthetic.pool;
    database = synthetic.database;
    expect(await runPendingMigrations(database, { migrationsDir: join(process.cwd(), 'tests/fixtures/production-lineage-2debe') })).toHaveLength(38);
    repository = new PostgresLegacyAccountDeletionRepository(database, database);
  }, 120_000);

  afterAll(async () => {
    await synthetic?.close();
  }, 30_000);

  it.each([false, true])('consumed=%sでも有効なpersonal URLがある場合は同意済みclaimを拒否する', async (consumed) => {
    const userId = await insertUser(pool);
    await insertUpload(bindQuery(pool), userId, { consumed });
    expect((await repository.claimRequest(claimInput(userId))).kind).toBe('blocked');
    expect(await repository.getRequest(userId)).toBeNull();
  });

  it.each(['expired', 'boundary'] as const)('%s tokenはtemporary inventoryに残り既存asset同意を増やさない', async (expiry) => {
    const userId = await insertUser(pool);
    const key = await insertUpload(bindQuery(pool), userId, { expiry });
    const flight = await repository.getFlight(userId);
    expect(flight).toMatchObject({ personalAssetKeys: [], personalTemporaryUploadKeys: [key], activePersonalUploadCount: 0 });
    expect((await repository.claimRequest({ ...claimInput(userId), acknowledgePersonalAssets: false })).kind).toBe('claimed');
    expect((await pool.query('SELECT s3_key FROM entity_reference_upload_tokens WHERE user_id=$1', [userId])).rows).toEqual([{ s3_key: key }]);
  });

  it('organization uploadはpersonal blockerとtemporary inventoryから除外する', async () => {
    const userId = await insertUser(pool);
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Upload org',$2)", [organizationId, userId]);
    await insertUpload(bindQuery(pool), userId, { organizationId });
    expect(await repository.getFlight(userId)).toMatchObject({ personalTemporaryUploadKeys: [], activePersonalUploadCount: 0 });
    expect((await repository.claimRequest(claimInput(userId))).kind).toBe('claimed');
  });

  it('署名失敗後の期限切れtokenも同意assetにせずexact keyをscheduleして記録を保持する', async () => {
    const userId = await insertUser(pool);
    const key = await insertUpload(bindQuery(pool), userId, { expiry: 'expired' });
    const scheduled: string[] = [];
    const providers = recordingProviders(scheduled);
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);
    expect(await service.getDeletionPreview(userId)).toMatchObject({ personalAssetCount: 0, activePersonalJobCount: 0 });
    expect(await service.requestDeletion({ ...claimInput(userId), confirmation: 'DELETE', acknowledgePersonalAssets: false })).toEqual({ status: 'completed', blockers: [] });
    expect(scheduled).toEqual([key]);
    expect((await repository.getRequest(userId))?.scheduledAssetKeys).toEqual([key]);
    expect((await pool.query('SELECT s3_key FROM entity_reference_upload_tokens WHERE user_id=$1', [userId])).rows).toEqual([{ s3_key: key }]);
  });

  it('既存saved assetだけがpersonal assets同意とpreview数に含まれる', async () => {
    const userId = await insertUser(pool);
    await insertSavedAsset(pool, userId);
    await insertUpload(bindQuery(pool), userId, { expiry: 'expired' });
    const providers = recordingProviders([]);
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);
    expect(await service.getDeletionPreview(userId)).toMatchObject({ personalAssetCount: 1 });
    expect(await service.requestDeletion({ ...claimInput(userId), confirmation: 'DELETE', acknowledgePersonalAssets: false })).toMatchObject({ status: 'blocked', blockers: [{ code: 'PERSONAL_ASSETS', asset_count: 1 }] });
  });

  it.each(['active upload', 'unscheduled temporary', 'unscheduled saved'] as const)('%sが匿名化直前にある場合はusers・works・requestを全て保持する', async (kind) => {
    const userId = await insertUser(pool);
    const token = randomUUID();
    expect((await repository.claimRequest({ ...claimInput(userId), processingToken: token })).kind).toBe('claimed');
    const workId = await insertSavedAsset(pool, userId);
    const savedKey = `saved/${userId}/page.png`;
    if (kind !== 'unscheduled saved') await repository.markAssetScheduled(userId, token, savedKey);
    if (kind !== 'unscheduled saved') {
      const key = await insertUpload(bindQuery(pool), userId, { expiry: kind === 'active upload' ? 'active' : 'expired' });
      if (kind === 'active upload') await repository.markAssetScheduled(userId, token, key);
    }
    const before = (await pool.query('SELECT * FROM account_deletion_requests WHERE user_id=$1', [userId])).rows[0];
    let failure: unknown;
    try { await repository.anonymizePersonalData(userId, token); } catch (error: unknown) { failure = error; }
    expect(failure).toMatchObject({ code: 'CONFLICT' });
    expect((await pool.query('SELECT supabase_id FROM users WHERE id=$1', [userId])).rows[0]?.supabase_id).toBe(`upload-${userId}`);
    expect((await pool.query('SELECT id FROM works WHERE id=$1', [workId])).rowCount).toBe(1);
    expect((await pool.query('SELECT * FROM account_deletion_requests WHERE user_id=$1', [userId])).rows[0]).toEqual(before);
  });

  it('期限切れtemporaryとsaved assetがschedule済みの場合だけ匿名化しstale tokenは拒否する', async () => {
    const userId = await insertUser(pool);
    const token = randomUUID();
    const workId = await insertSavedAsset(pool, userId);
    const temporary = await insertUpload(bindQuery(pool), userId, { expiry: 'expired' });
    expect((await repository.claimRequest({ ...claimInput(userId), processingToken: token })).kind).toBe('claimed');
    for (const key of [temporary, `saved/${userId}/page.png`]) await repository.markAssetScheduled(userId, token, key);
    expect(await repository.anonymizePersonalData(userId, randomUUID())).toBe(false);
    expect(await repository.anonymizePersonalData(userId, token)).toBe(true);
    expect((await pool.query('SELECT id FROM works WHERE id=$1', [workId])).rowCount).toBe(0);
    expect((await repository.getRequest(userId))?.scheduledAssetKeys.sort()).toEqual([temporary, `saved/${userId}/page.png`].sort());
  });

  it.each(['upload first', 'claim first'] as const)('%sの場合は実user lock待機後にfresh uploadまたは退会状態を再検査する', async (order) => {
    const userId = await insertUser(pool);
    const first = await pool.connect();
    const second = await pool.connect();
    const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let later: Promise<unknown> | undefined;
    try {
      await first.query('BEGIN');
      await first.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const pending = bindClient(second);
      if (order === 'upload first') {
        await assertLegacyPersonalWriteAllowed(bindQuery(first), { userId, organizationId: null });
        await insertUpload(bindQuery(first), userId);
        later = new PostgresLegacyAccountDeletionRepository(pending, pending).claimRequest(claimInput(userId));
      } else {
        const inline = { ...bindQuery(first), transaction: async <T>(work: (client: DatabaseClient) => Promise<T>) => work(bindQuery(first)) };
        expect((await new PostgresLegacyAccountDeletionRepository(inline, inline).claimRequest(claimInput(userId))).kind).toBe('claimed');
        later = pending.transaction(async client => {
          await assertLegacyPersonalWriteAllowed(client, { userId, organizationId: null });
          await insertUpload(client, userId);
        }).then(() => ({ ok: true }), (error: unknown) => error);
      }
      await waitForBlocked(pool, secondPid);
      await first.query('COMMIT');
      if (order === 'upload first') expect(await later).toMatchObject({ kind: 'blocked' });
      else expect(await later).toMatchObject({ code: 'FORBIDDEN' });
      expect((await pool.query('SELECT count(*)::int AS count FROM entity_reference_upload_tokens WHERE user_id=$1', [userId])).rows[0]?.count).toBe(order === 'upload first' ? 1 : 0);
    } finally {
      await first.query('ROLLBACK');
      await later;
      first.release(); second.release();
    }
  });
});

function bindQuery(client: Pool | PoolClient): DatabaseClient {
  return { query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<Row>(text, values === undefined ? undefined : [...values]) };
}
function bindClient(client: PoolClient): DatabaseClient & TransactionRunner {
  return { ...bindQuery(client), transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
    await client.query('BEGIN');
    try { const result = await work(bindQuery(client)); await client.query('COMMIT'); return result; }
    catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
  } };
}
async function insertUser(pool: Pool): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,supabase_id,email,plan_code) VALUES($1,$2,$3,'free')", [id, `upload-${id}`, `${id}@example.test`]);
  return id;
}
async function insertUpload(client: DatabaseClient, userId: string, options: { consumed?: boolean; expiry?: 'active' | 'expired' | 'boundary'; organizationId?: string } = {}): Promise<string> {
  const id = randomUUID(); const key = `tmp/${userId}/entities/imports/${id}.png`;
  await client.query(`INSERT INTO entity_reference_upload_tokens(id,token_hash,user_id,organization_id,purpose,mime_type,size_bytes,s3_key,created_at,expires_at,consumed_at)
    VALUES($1,$2,$3,$4,'entity_reference_import','image/png',100,$5,NOW()-INTERVAL '10 minutes',
      CASE $6 WHEN 'expired' THEN NOW()-INTERVAL '1 minute' WHEN 'boundary' THEN NOW() ELSE NOW()+INTERVAL '5 minutes' END,
      CASE WHEN $7 THEN NOW()-INTERVAL '2 minutes' ELSE NULL END)`,
  [id, id.replaceAll('-', '').repeat(2), userId, options.organizationId ?? null, key, options.expiry ?? 'active', options.consumed ?? false]);
  return key;
}
async function insertSavedAsset(pool: Pool, userId: string): Promise<string> {
  const work = randomUUID(), chapter = randomUUID(), episode = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Saved')", [work, userId]);
  await pool.query("INSERT INTO chapters(id,work_id,title,\"order\") VALUES($1,$2,'Chapter',1)", [chapter, work]);
  await pool.query("INSERT INTO episodes(id,chapter_id,title,\"order\") VALUES($1,$2,'Episode',1)", [episode, chapter]);
  await pool.query("INSERT INTO pages(episode_id,page_number,generated_image) VALUES($1,1,$2)", [episode, JSON.stringify({ s3_key: `saved/${userId}/page.png` })]);
  return work;
}
function claimInput(userId: string) {
  return { userId, identityId: `upload-${userId}`, processingToken: randomUUID(), acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true };
}
function recordingProviders(scheduled: string[]) {
  return {
    cancelPersonalSubscription: async (): Promise<void> => undefined,
    reconcilePersonalSubscriptionCancellation: async (): Promise<'unknown'> => 'unknown',
    scheduleDeletion: async (key: string): Promise<void> => { scheduled.push(key); },
    reconcileDeletionSchedule: async (): Promise<'unknown'> => 'unknown',
    disableIdentity: async (): Promise<void> => undefined,
    reconcileIdentityDisabled: async (): Promise<'unknown'> => 'unknown',
    deleteIdentity: async (): Promise<void> => undefined,
    reconcileIdentityDeleted: async (): Promise<'unknown'> => 'unknown',
  };
}
async function waitForBlocked(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await pool.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0]?.blocked === true) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected controlled user-lock wait');
}
