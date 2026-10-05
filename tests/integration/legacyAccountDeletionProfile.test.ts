import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { LegacyAccountDeletionServiceAdapter } from '../../src/legacy/account/LegacyAccountDeletionServiceAdapter.js';
import type { LegacyAccountDeletionClaimResult } from '../../src/legacy/account/LegacyAccountDeletionTypes.js';
import { assertLegacyPersonalWriteAllowed } from '../../src/repositories/LegacyAccountDeletionWriteFence.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');
const OLD_REPOSITORY_PATH = 'C:/Users/shogo/Lyra/.tmp/codex-completion-20261002/legacy-repository-profile-57d4e8d/old-2debe-r2/src/repositories/AccountDeletionRepository.ts';
const OLD_REPOSITORY_SHA256 = '3abb9b80e5d6bd653917cecf5968f72a7aa35adac504abcbbbc4d6072e493d60';

interface OldRequest {
  status: 'blocked' | 'processing' | 'pending_external_action' | 'completed';
  scheduledAssetKeys: string[];
  cancelledSubscriptionIds: string[];
}
interface OldRepository {
  getRequest(userId: string): Promise<OldRequest | null>;
  claimRequest(input: { userId: string; identityId: string; processingToken: string }): Promise<OldRequest | null>;
  markAssetKeyScheduled(userId: string, key: string): Promise<void>;
  markSubscriptionCancelled(userId: string, subscriptionId: string): Promise<void>;
}
type OldRepositoryConstructor = new (
  client: DatabaseClient,
  transactionRunner: TransactionRunner,
) => OldRepository;

/**
 * Exact-old interop acceptance for the migration-0 foundation. The candidate
 * shares fresh claim exclusion with the old UPDATE predicate, but it does not
 * claim that an old stale owner or an old generation writer is fenced.
 */
describePostgres('legacy 2debe account deletion compatibility', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  let repository: PostgresLegacyAccountDeletionRepository;
  let OldRepositoryClass: OldRepositoryConstructor;
  const schema = `legacy_account_deletion_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    const oldSource = readFileSync(OLD_REPOSITORY_PATH);
    expect(createHash('sha256').update(oldSource).digest('hex')).toBe(OLD_REPOSITORY_SHA256);
    const oldModule = await import(/* @vite-ignore */ pathToFileURL(OLD_REPOSITORY_PATH).href) as {
      PostgresAccountDeletionRepository: OldRepositoryConstructor;
    };
    OldRepositoryClass = oldModule.PostgresAccountDeletionRepository;
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c statement_timeout=30000`,
      max: 12,
    });
    database = testDatabase(pool);
    const applied = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: LEGACY_MIGRATIONS,
    }));
    expect(applied).toHaveLength(38);
    repository = new PostgresLegacyAccountDeletionRepository(database, database);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });


  // Spec 5/11: local completion records existing checkpoints; it does not prove
  // physical object deletion or add durable external intent/recovery.
  it.each(['data_anonymized_at', 'identity_disabled_at', 'identity_deleted_at'] as const)('%sが欠ける場合は完了せずrequest全列とowner/checkpointsを保持する', async missing => {
    const fixture = await completionFixture(missing);
    expect(await repository.markCompleted(fixture.userId, fixture.token)).toBe(false);
    expect(await completionRow(fixture.userId)).toEqual(fixture.before);
  });

  it('3markerと正ownerが揃う場合は完了してownerだけを解放し再実行で完了日時を変えない', async () => {
    const fixture = await completionFixture();
    expect(await repository.markCompleted(fixture.userId, fixture.token)).toBe(true);
    const completed = await completionRow(fixture.userId);
    expect(completed).toEqual({
      ...fixture.before, status: 'completed', blocker_codes: [], last_failure_code: null,
      processing_token: null, processing_started_at: null,
      completed_at: expect.any(Date), updated_at: expect.any(Date),
    });
    expect(await repository.markCompleted(fixture.userId, fixture.token)).toBe(false);
    expect(await completionRow(fixture.userId)).toEqual(completed);
  });

  it('3markerが揃ってもstale ownerの場合はrequest全列を保持する', async () => {
    const fixture = await completionFixture();
    expect(await repository.markCompleted(fixture.userId, randomUUID())).toBe(false);
    expect(await completionRow(fixture.userId)).toEqual(fixture.before);
  });

  it.each(['blocked', 'pending_external_action'] as const)('3markerとtokenが一致してもstatus=%sの場合はrequest全列を保持する', async status => {
    const fixture = await completionFixture();
    await pool.query('UPDATE account_deletion_requests SET status=$2 WHERE user_id=$1', [fixture.userId, status]);
    const before = await completionRow(fixture.userId);
    expect(await repository.markCompleted(fixture.userId, fixture.token)).toBe(false);
    expect(await completionRow(fixture.userId)).toEqual(before);
  });

  async function completionRow(userId: string): Promise<QueryResultRow> {
    return (await pool.query('SELECT * FROM account_deletion_requests WHERE user_id=$1', [userId])).rows[0]!;
  }

  async function completionFixture(missing?: 'data_anonymized_at' | 'identity_disabled_at' | 'identity_deleted_at'): Promise<{ userId: string; token: string; before: QueryResultRow }> {
    const userId = await insertUser(pool), token = randomUUID();
    expect((await repository.claimRequest(claimInput(userId, token))).kind).toBe('claimed');
    await pool.query(
      `UPDATE account_deletion_requests SET
       data_anonymized_at = CASE WHEN $2 THEN NULL ELSE NOW()-INTERVAL '3 minutes' END,
       identity_disabled_at = CASE WHEN $3 THEN NULL ELSE NOW()-INTERVAL '2 minutes' END,
       identity_deleted_at = CASE WHEN $4 THEN NULL ELSE NOW()-INTERVAL '1 minute' END,
       cancelled_subscription_ids = ARRAY['sub-preserved'],
       scheduled_asset_keys = ARRAY['saved/preserved.png'],
       blocker_codes = ARRAY['preserved-blocker'], last_failure_code = 'PRESERVED_FAILURE'
       WHERE user_id=$1`,
      [userId, missing === 'data_anonymized_at', missing === 'identity_disabled_at', missing === 'identity_deleted_at'],
    );
    return { userId, token, before: await completionRow(userId) };
  }

  it('Spec 5/11 候補user lock後のexact-old INSERTと競合してもFK循環deadlockなく一ownerになる', async () => {
    const userId = await insertUser(pool);
    const candidateClient = await pool.connect();
    const oldClient = await pool.connect();
    const oldPid = await backendPid(oldClient), candidatePid = await backendPid(candidateClient);
    const userLocked = latch(); const resume = latch();
    let oldInsertCompleted = false;
    const candidateDb = pinnedDatabase(candidateClient, async text => {
      if (text.startsWith('SELECT id FROM users')) { userLocked.open(); await resume.promise; }
    });
    const oldDb = pinnedDatabase(oldClient, async text => {
      if (text.includes('INSERT INTO account_deletion_requests')) oldInsertCompleted = true;
    });
    const candidateToken = randomUUID(), oldToken = randomUUID();
    const candidate = settle(new PostgresLegacyAccountDeletionRepository(candidateDb, candidateDb).claimRequest(claimInput(userId, candidateToken)));
    let old: ReturnType<typeof settle<OldRequest | null>> | undefined;
    try {
      await userLocked.promise;
      old = settle(new OldRepositoryClass(oldDb, oldDb).claimRequest({ userId, identityId: `identity-${userId}`, processingToken: oldToken }));
      await waitUntil(async () => oldInsertCompleted || await isBlockedBy(pool, oldPid, candidatePid));
      const insertCompletedBeforeResume = oldInsertCompleted;
      resume.open();
      const results = await Promise.all([candidate, old]);
      const errors = results.filter(result => !result.ok).map(result => !result.ok ? sqlCode(result.error) : null);
      console.info('controlled exact-old FK race', { insertCompletedBeforeResume, errors });
      expect(errors).toEqual([]);
      expect(insertCompletedBeforeResume).toBe(true);
      const [newResult, oldResult] = results;
      expect(Number(newResult.ok && newResult.value.kind === 'claimed') + Number(oldResult.ok && oldResult.value !== null)).toBe(1);
      const persisted = await repository.getRequest(userId);
      expect(persisted?.status).toBe('processing');
      expect([candidateToken, oldToken]).toContain(persisted?.processingToken);
    } finally {
      resume.open(); await candidate; if (old) await old;
      candidateClient.release(); oldClient.release();
    }
  }, 15_000);

  it.each(['old first', 'candidate first'] as const)('%sのfresh claim順序でも一ownerだけを保持する', async order => {
    const userId = await insertUser(pool);
    const first = await pool.connect(), second = await pool.connect();
    const firstPid = await backendPid(first), secondPid = await backendPid(second);
    let pending: Promise<unknown> | undefined;
    try {
      const candidateToken = randomUUID(), oldToken = randomUUID();
      if (order === 'old first') {
        const oldDb = pinnedDatabase(first);
        expect(await new OldRepositoryClass(oldDb, oldDb).claimRequest({ userId, identityId: `identity-${userId}`, processingToken: oldToken })).not.toBeNull();
        const candidateDb = pinnedDatabase(second);
        expect((await new PostgresLegacyAccountDeletionRepository(candidateDb, candidateDb).claimRequest(claimInput(userId, candidateToken))).kind).toBe('in_progress');
      } else {
        await first.query('BEGIN');
        const candidateDb = pinnedDatabase(first);
        const inline: TransactionRunner = { transaction: async work => work(candidateDb) };
        expect((await new PostgresLegacyAccountDeletionRepository(candidateDb, inline).claimRequest(claimInput(userId, candidateToken))).kind).toBe('claimed');
        const oldDb = pinnedDatabase(second);
        pending = new OldRepositoryClass(oldDb, oldDb).claimRequest({ userId, identityId: `identity-${userId}`, processingToken: oldToken });
        await waitUntil(() => isBlockedBy(pool, secondPid, firstPid));
        await first.query('COMMIT');
        expect(await pending).toBeNull();
      }
      expect((await repository.getRequest(userId))?.processingToken).toBe(order === 'old first' ? oldToken : candidateToken);
    } finally {
      await first.query('ROLLBACK'); if (pending) await pending;
      first.release(); second.release();
    }
  }, 15_000);

  it.each(['ordinary update', 'upload admission', 'anonymize'] as const)('claimが先の場合も%sとuser lockで排他する', async operation => {
    const userId = await insertUser(pool);
    const token = randomUUID();
    if (operation === 'anonymize') expect((await repository.claimRequest(claimInput(userId, token))).kind).toBe('claimed');
    const first = await pool.connect(), second = await pool.connect();
    const firstPid = await backendPid(first), secondPid = await backendPid(second);
    const locked = latch(), resume = latch();
    const candidateDb = pinnedDatabase(first, async text => {
      if (text.startsWith('SELECT id FROM users')) { locked.open(); await resume.promise; }
    });
    const candidate = settle(new PostgresLegacyAccountDeletionRepository(candidateDb, candidateDb).claimRequest(claimInput(userId, randomUUID())));
    let later: Promise<Settled<unknown>> | undefined;
    try {
      await locked.promise;
      const otherDb = pinnedDatabase(second);
      later = settle<unknown>(operation === 'ordinary update'
        ? second.query("UPDATE users SET display_name='concurrent update' WHERE id=$1", [userId])
        : operation === 'anonymize'
          ? new PostgresLegacyAccountDeletionRepository(otherDb, otherDb).anonymizePersonalData(userId, token)
          : otherDb.transaction(client => assertLegacyPersonalWriteAllowed(client, { userId, organizationId: null })));
      await waitUntil(() => isBlockedBy(pool, secondPid, firstPid));
      resume.open();
      expect((await candidate).ok).toBe(true);
      const result = await later;
      if (operation === 'upload admission') {
        expect(result.ok).toBe(false);
        expect(!result.ok && sqlCode(result.error)).toBe('FORBIDDEN');
      } else expect(result.ok).toBe(true);
    } finally {
      resume.open(); await candidate; if (later) await later;
      first.release(); second.release();
    }
  }, 15_000);

  it.each(['ordinary update', 'upload admission', 'anonymize'] as const)('%sが先の場合はclaimがuser lock解放を待つ', async operation => {
    const userId = await insertUser(pool);
    const token = randomUUID();
    if (operation === 'anonymize') expect((await repository.claimRequest(claimInput(userId, token))).kind).toBe('claimed');
    const first = await pool.connect(), second = await pool.connect();
    const firstPid = await backendPid(first), secondPid = await backendPid(second);
    let pending: Promise<Settled<LegacyAccountDeletionClaimResult>> | undefined;
    try {
      await first.query('BEGIN');
      const firstDb = pinnedDatabase(first);
      if (operation === 'ordinary update') await first.query("UPDATE users SET display_name='first update' WHERE id=$1", [userId]);
      else if (operation === 'upload admission') await assertLegacyPersonalWriteAllowed(firstDb, { userId, organizationId: null });
      else {
        const inline: TransactionRunner = { transaction: async work => work(firstDb) };
        expect(await new PostgresLegacyAccountDeletionRepository(firstDb, inline).anonymizePersonalData(userId, token)).toBe(true);
      }
      const secondDb = pinnedDatabase(second);
      pending = settle(new PostgresLegacyAccountDeletionRepository(secondDb, secondDb).claimRequest(claimInput(userId, randomUUID())));
      await waitUntil(() => isBlockedBy(pool, secondPid, firstPid));
      await first.query('COMMIT');
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(result.ok && result.value.kind).toBe(operation === 'anonymize' ? 'in_progress' : 'claimed');
    } finally {
      await first.query('ROLLBACK'); if (pending) await pending;
      first.release(); second.release();
    }
  }, 15_000);

  it('旧fresh claimと候補fresh claimの同時実行は一方だけがprocessing ownerになる', async () => {
    const userId = await insertUser(pool);
    const oldRepository = new OldRepositoryClass(database, database);
    const candidateToken = randomUUID();
    const oldToken = randomUUID();
    const [candidate, old] = await Promise.all([
      repository.claimRequest(claimInput(userId, candidateToken)),
      oldRepository.claimRequest({ userId, identityId: `identity-${userId}`, processingToken: oldToken }),
    ]);
    const winnerCount = Number(candidate.kind === 'claimed') + Number(old !== null);
    expect(winnerCount).toBe(1);
    const persisted = await pool.query<{ processing_token: string; status: string }>(
      'SELECT processing_token,status FROM account_deletion_requests WHERE user_id=$1',
      [userId],
    );
    expect([candidateToken, oldToken]).toContain(persisted.rows[0]?.processing_token);
    expect(persisted.rows[0]?.status).toBe('processing');
  });

  it('候補fresh claim同士も一方だけがprocessing ownerになる', async () => {
    const userId = await insertUser(pool);
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    const [first, second] = await Promise.all([
      repository.claimRequest(claimInput(userId, firstToken)),
      repository.claimRequest(claimInput(userId, secondToken)),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['claimed', 'in_progress']);
    const persisted = await repository.getRequest(userId);
    expect([firstToken, secondToken]).toContain(persisted?.processingToken);
  });

  it('候補checkpointを旧repoが読み旧checkpointを候補repoが継続できる', async () => {
    const userId = await insertUser(pool);
    const token = randomUUID();
    const claim = await repository.claimRequest(claimInput(userId, token));
    expectClaimed(claim);
    expect(await repository.markAssetScheduled(userId, token, 'saved/user/legacy-page.png')).toBe(true);
    expect(await repository.recordFailure(userId, token, 'RESPONSE_UNKNOWN')).toBe(true);

    const oldRepository = new OldRepositoryClass(database, database);
    expect(await oldRepository.getRequest(userId)).toMatchObject({
      status: 'pending_external_action',
      scheduledAssetKeys: ['saved/user/legacy-page.png'],
    });
    const oldToken = randomUUID();
    expect(await oldRepository.claimRequest({
      userId, identityId: `identity-${userId}`, processingToken: oldToken,
    })).not.toBeNull();
    await oldRepository.markSubscriptionCancelled(userId, 'sub-old');
    expect(await repository.getRequest(userId)).toMatchObject({
      processingToken: oldToken,
      cancelledSubscriptionIds: ['sub-old'],
      scheduledAssetKeys: ['saved/user/legacy-page.png'],
    });
  });

  it('候補はunknown processingを自動reclaimせずstale ownerのCAS更新を拒否する', async () => {
    const userId = await insertUser(pool);
    const staleToken = randomUUID();
    const claim = await repository.claimRequest(claimInput(userId, staleToken));
    expectClaimed(claim);
    await pool.query(
      "UPDATE account_deletion_requests SET processing_token=$2,processing_started_at=NOW()-INTERVAL '11 minutes' WHERE user_id=$1",
      [userId, randomUUID()],
    );

    expect(await repository.claimNextPending(randomUUID())).toBeNull();
    expect(await repository.markAssetScheduled(userId, staleToken, 'saved/user/stale.png')).toBe(false);
    expect((await repository.getRequest(userId))?.scheduledAssetKeys).toEqual([]);
  });

  it('sole ownerと旧generation/export active rowsをblockしschema inventoryを変更しない', async () => {
    const inventoryBefore = await schemaInventory(pool);
    const userId = await insertUser(pool);
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Deletion owner',$2)", [organizationId, userId]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, userId]);
    await pool.query(
      "INSERT INTO generation_jobs(id,user_id,job_type,status,generation_mode,credit_cost,params) VALUES($1,$2,'entity_generate','queued','standard',0,'{}')",
      [randomUUID(), userId],
    );
    const episodeId = await insertEpisode(pool, userId);
    await pool.query(
      `INSERT INTO export_jobs(id,user_id,episode_id,format,filename,page_ids,page_snapshot,
        request_fingerprint,idempotency_key,status,expires_at)
       VALUES($1,$2,$3,'pdf','legacy.pdf',$4,'[]',$5,$6,'queued',NOW()+INTERVAL '1 day')`,
      [randomUUID(), userId, episodeId, [randomUUID()], 'a'.repeat(64), `request-${randomUUID()}`],
    );

    const flight = await repository.getFlight(userId);
    expect(flight.uniqueOwnerOrganizations).toHaveLength(1);
    expect(flight.activePersonalGenerationJobCount).toBe(1);
    expect(flight.activePersonalExportJobCount).toBe(1);
    const result = await repository.claimRequest(claimInput(userId, randomUUID()));
    expect(result.kind).toBe('blocked');
    expect(await schemaInventory(pool)).toEqual(inventoryBefore);
  });

  it('期限切れqueued exportだけをCAS終端化し未期限queuedとprocessingをblockする', async () => {
    const expiredQueuedUserId = await insertUser(pool);
    const unexpiredQueuedUserId = await insertUser(pool);
    const expiredProcessingUserId = await insertUser(pool);
    await insertExportJob(pool, expiredQueuedUserId, 'queued', true);
    await insertExportJob(pool, unexpiredQueuedUserId, 'queued', false);
    await insertExportJob(pool, expiredProcessingUserId, 'processing', true);

    expect((await repository.getFlight(expiredQueuedUserId)).activePersonalExportJobCount).toBe(0);
    expect((await repository.getFlight(unexpiredQueuedUserId)).activePersonalExportJobCount).toBe(1);
    expect((await repository.getFlight(expiredProcessingUserId)).activePersonalExportJobCount).toBe(1);
    expect((await pool.query<{ status: string; error_code: string | null }>(
      'SELECT status,error_code FROM export_jobs WHERE user_id=$1', [expiredQueuedUserId],
    )).rows[0]).toEqual({ status: 'failed', error_code: 'EXPORT_EXPIRED' });
  });

  it('blocked再記録はcompleted行をdowngradeせず旧checkpoint配列を保持する', async () => {
    const userId = await insertUser(pool);
    await pool.query(
      `INSERT INTO account_deletion_requests(user_id,identity_id,status,cancelled_subscription_ids,
        scheduled_asset_keys,completed_at) VALUES($1,$2,'completed',$3,$4,NOW())`,
      [userId, `identity-${userId}`, ['sub-kept'], ['saved/user/kept.png']],
    );
    expect(await repository.recordBlocked(userId, ['ACTIVE_PERSONAL_JOB'])).toBe(false);
    expect(await repository.getRequest(userId)).toMatchObject({
      status: 'completed', cancelledSubscriptionIds: ['sub-kept'],
      scheduledAssetKeys: ['saved/user/kept.png'],
    });
  });

  it('候補service完了後も旧repoがraw identityとscheduled checkpointを読める', async () => {
    const userId = await insertUser(pool);
    const identityId = `identity-${userId}`;
    const providers = new RecordingDeletionProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    const result = await service.requestDeletion({
      userId, identityId, confirmation: 'DELETE',
      acknowledgePersonalSubscriptions: true,
      acknowledgeStoreBilling: true,
      acknowledgePersonalAssets: true,
    });

    expect(result).toEqual({ status: 'completed', blockers: [] });
    const old = await new OldRepositoryClass(database, database).getRequest(userId);
    expect(old).toMatchObject({ status: 'completed' });
    expect((await pool.query<{ identity_id: string }>(
      'SELECT identity_id FROM account_deletion_requests WHERE user_id=$1', [userId],
    )).rows[0]?.identity_id).toBe(identityId);
    expect(providers.identities).toEqual([`disable:${identityId}`, `delete:${identityId}`]);
  });
});

class RecordingDeletionProviders {
  public identities: string[] = [];
  public async cancelPersonalSubscription(): Promise<void> {}
  public async reconcilePersonalSubscriptionCancellation(): Promise<'applied'> { return 'applied'; }
  public async scheduleDeletion(): Promise<void> {}
  public async reconcileDeletionSchedule(): Promise<'applied'> { return 'applied'; }
  public async disableIdentity(identityId: string): Promise<void> { this.identities.push(`disable:${identityId}`); }
  public async reconcileIdentityDisabled(): Promise<'applied'> { return 'applied'; }
  public async deleteIdentity(identityId: string): Promise<void> { this.identities.push(`delete:${identityId}`); }
  public async reconcileIdentityDeleted(): Promise<'applied'> { return 'applied'; }
}

function claimInput(userId: string, processingToken: string) {
  return {
    userId, identityId: `identity-${userId}`, processingToken,
    acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: true,
  };
}

function expectClaimed(result: LegacyAccountDeletionClaimResult): void {
  expect(result.kind).toBe('claimed');
}

async function insertUser(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [
    userId, `identity-${userId}`, `${userId}@example.invalid`,
  ]);
  return userId;
}

async function insertEpisode(pool: Pool, userId: string): Promise<string> {
  const workId = randomUUID();
  const chapterId = randomUUID();
  const episodeId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Deletion export')", [workId, userId]);
  await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
  await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
  return episodeId;
}

async function insertExportJob(
  pool: Pool,
  userId: string,
  status: 'queued' | 'processing',
  expired: boolean,
): Promise<void> {
  const episodeId = await insertEpisode(pool, userId);
  await pool.query(
    `INSERT INTO export_jobs(id,user_id,episode_id,format,filename,page_ids,page_snapshot,
      request_fingerprint,idempotency_key,status,created_at,expires_at)
     VALUES($1,$2,$3,'pdf','legacy.pdf',$4,'[]',$5,$6,$7,
       CASE WHEN $8 THEN NOW()-INTERVAL '2 days' ELSE NOW() END,
       CASE WHEN $8 THEN NOW()-INTERVAL '1 day' ELSE NOW()+INTERVAL '1 day' END)`,
    [randomUUID(), userId, episodeId, [randomUUID()], 'b'.repeat(64), `request-${randomUUID()}`, status, expired],
  );
}

async function schemaInventory(pool: Pool): Promise<QueryResultRow[]> {
  const result = await pool.query(
    `SELECT table_name,column_name,data_type FROM information_schema.columns
     WHERE table_schema=current_schema() ORDER BY table_name,column_name`,
  );
  return result.rows;
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
      pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
            client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return result;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function latch(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
}
function sqlCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
}
async function backendPid(client: PoolClient): Promise<number> {
  return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
}
async function isBlockedBy(pool: Pool, waiter: number, blocker: number): Promise<boolean> {
  return (await pool.query<{ blocked: boolean }>('SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked', [waiter, blocker])).rows[0]?.blocked === true;
}
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Controlled PostgreSQL race did not reach the expected lock state');
}
function pinnedDatabase(client: PoolClient, afterQuery?: (text: string) => Promise<void>): DatabaseClient & TransactionRunner {
  const database: DatabaseClient & TransactionRunner = {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
      const result = await client.query<Row>(text, values === undefined ? undefined : [...values]);
      if (afterQuery) await afterQuery(text);
      return result;
    },
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      await client.query('BEGIN');
      try { const result = await work(database); await client.query('COMMIT'); return result; }
      catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
    },
  };
  return database;
}
