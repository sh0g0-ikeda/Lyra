import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { LegacyAccountDeletionServiceAdapter } from '../../src/legacy/account/LegacyAccountDeletionServiceAdapter.js';
import type { LegacyAccountDeletionClaimResult } from '../../src/legacy/account/LegacyAccountDeletionTypes.js';
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
