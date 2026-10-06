import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresPushNotificationDeliveryRepository } from '../../src/repositories/PushNotificationDeliveryRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const dbDescribe = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const legacyMigrations = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

dbDescribe('legacy 2debe push delivery profile', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  let repository: PostgresPushNotificationDeliveryRepository;
  const schema = `legacy_push_delivery_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 12 });
    database = testDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: legacyMigrations }));
    repository = new PostgresPushNotificationDeliveryRepository(database, database, 'legacy_2debe_v1');
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('旧terminal triggerのdeliveryを並行claimし期限切れleaseだけを再取得する', async () => {
    const fixture = await createTerminalFixture();
    const claimed = (await Promise.all([repository.claimPending(1), repository.claimPending(1)])).flat();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.deliveryId).toBe(fixture.deliveryId);
    expect(claimed[0]?.navigation).toMatchObject({ job_id: fixture.jobId, page_id: fixture.pageId });

    const firstLease = claimed[0]!.leaseToken;
    await pool.query("UPDATE mobile_push_notification_deliveries SET locked_at=NOW()-INTERVAL '6 minutes' WHERE id=$1", [fixture.deliveryId]);
    const [reclaimed] = await repository.claimPending(1);
    expect(reclaimed?.leaseToken).not.toBe(firstLease);
    expect(await repository.markSent(fixture.deliveryId, firstLease)).toBe(false);
    expect(await repository.markSent(fixture.deliveryId, reclaimed!.leaseToken)).toBe(true);
  });

  it('failed通知の旧retry後も同じoutboxとdeliveryを維持してclaimできる', async () => {
    const fixture = await createTerminalFixture('failed');
    await pool.query("UPDATE generation_jobs SET status='queued',retry_count=retry_count+1 WHERE id=$1", [fixture.jobId]);
    const [delivery] = await repository.claimPending(1);
    expect(delivery?.deliveryId).toBe(fixture.deliveryId);
    expect(await repository.isDeliveryCurrent(fixture.deliveryId, delivery!.leaseToken)).toBe(true);
    await repository.markRetry(fixture.deliveryId, delivery!.leaseToken, 'retry_after_failed', new Date());
    await pool.query("UPDATE generation_jobs SET status='completed' WHERE id=$1", [fixture.jobId]);
    expect((await pool.query('SELECT count(*)::int count FROM mobile_push_notification_outbox WHERE generation_job_id=$1', [fixture.jobId])).rows[0]?.count).toBe(1);
    expect((await pool.query('SELECT status FROM mobile_push_notification_deliveries WHERE id=$1', [fixture.deliveryId])).rows[0]?.status).toBe('pending');
    await pool.query("UPDATE mobile_push_notification_deliveries SET status='sent' WHERE id=$1", [fixture.deliveryId]);
  });

  it.each(['processing', 'pending_external_action', 'completed'] as const)('%s deletion requestはclaimをdeadへ終端する', async (status) => {
    const fixture = await createTerminalFixture();
    await pool.query('INSERT INTO account_deletion_requests(user_id,identity_id,status) VALUES($1,$2,$3)', [fixture.userId, randomUUID(), status]);
    expect(await repository.claimPending(1)).toEqual([]);
    expect((await pool.query('SELECT status,error_code FROM mobile_push_notification_deliveries WHERE id=$1', [fixture.deliveryId])).rows[0]).toMatchObject({ status: 'dead', error_code: 'MISSING_NAVIGATION_CONTEXT' });
  });

  it('blocked deletion requestは通常deliveryを許可し、token削除後のcurrent checkはdeadにする', async () => {
    const fixture = await createTerminalFixture();
    await pool.query("INSERT INTO account_deletion_requests(user_id,identity_id,status) VALUES($1,$2,'blocked')", [fixture.userId, randomUUID()]);
    const [delivery] = await repository.claimPending(1);
    expect(delivery).toBeDefined();
    await pool.query('DELETE FROM mobile_push_tokens WHERE id=$1', [fixture.tokenId]);
    expect(await repository.isDeliveryCurrent(fixture.deliveryId, delivery!.leaseToken)).toBe(false);
    expect((await pool.query('SELECT status,error_code FROM mobile_push_notification_deliveries WHERE id=$1', [fixture.deliveryId])).rows[0]).toMatchObject({ status: 'dead', error_code: 'MISSING_NAVIGATION_CONTEXT' });
  });

  it('cancel要求済みjobとactiveでないorganization memberをclaimしない', async () => {
    const cancelled = await createTerminalFixture();
    await pool.query('UPDATE generation_jobs SET cancel_requested_at=NOW(),cancel_requested_by=$2 WHERE id=$1', [cancelled.jobId, cancelled.userId]);
    expect(await repository.claimPending(1)).toEqual([]);
    expect((await pool.query('SELECT status FROM mobile_push_notification_deliveries WHERE id=$1', [cancelled.deliveryId])).rows[0]?.status).toBe('dead');

    const nonmember = await createTerminalFixture();
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Legacy push organization',$2)", [organizationId, nonmember.userId]);
    await pool.query('UPDATE generation_jobs SET organization_id=$2 WHERE id=$1', [nonmember.jobId, organizationId]);
    await pool.query('UPDATE works SET organization_id=$2 WHERE id=(SELECT chapter.work_id FROM chapters chapter JOIN episodes episode ON episode.chapter_id=chapter.id JOIN pages page ON page.episode_id=episode.id WHERE page.id=$1)', [nonmember.pageId, organizationId]);
    expect(await repository.claimPending(1)).toEqual([]);
    expect((await pool.query('SELECT status FROM mobile_push_notification_deliveries WHERE id=$1', [nonmember.deliveryId])).rows[0]?.status).toBe('dead');
  });

  it('active organizationのclaim後に削除開始又はmember除外されるとcurrent checkを拒否する', async () => {
    const deletion = await createTerminalFixture();
    await makeOrganizationDelivery(deletion);
    const [claimedForDeletion] = await repository.claimPending(1);
    expect(claimedForDeletion).toBeDefined();
    await pool.query("INSERT INTO account_deletion_requests(user_id,identity_id,status) VALUES($1,$2,'processing')", [deletion.userId, randomUUID()]);
    expect(await repository.isDeliveryCurrent(deletion.deliveryId, claimedForDeletion!.leaseToken)).toBe(false);

    const removal = await createTerminalFixture();
    const organizationId = await makeOrganizationDelivery(removal);
    const [claimedForRemoval] = await repository.claimPending(1);
    expect(claimedForRemoval).toBeDefined();
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [organizationId, removal.userId]);
    expect(await repository.isDeliveryCurrent(removal.deliveryId, claimedForRemoval!.leaseToken)).toBe(false);
  });

  it('古いleaseのcurrent checkは再claim済みdeliveryを変更しない', async () => {
    const fixture = await createTerminalFixture();
    const [first] = await repository.claimPending(1);
    await pool.query("UPDATE mobile_push_notification_deliveries SET locked_at=NOW()-INTERVAL '6 minutes' WHERE id=$1", [fixture.deliveryId]);
    const [second] = await repository.claimPending(1);
    expect(await repository.isDeliveryCurrent(fixture.deliveryId, first!.leaseToken)).toBe(false);
    expect((await pool.query('SELECT status,lease_token FROM mobile_push_notification_deliveries WHERE id=$1', [fixture.deliveryId])).rows[0]).toMatchObject({ status: 'processing', lease_token: second!.leaseToken });
  });

  async function makeOrganizationDelivery(fixture: { userId: string; jobId: string; pageId: string }): Promise<string> {
    const organizationId = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Legacy active push organization',$2)", [organizationId, fixture.userId]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, fixture.userId]);
    await pool.query('UPDATE generation_jobs SET organization_id=$2 WHERE id=$1', [fixture.jobId, organizationId]);
    await pool.query('UPDATE works SET organization_id=$2 WHERE id=(SELECT chapter.work_id FROM chapters chapter JOIN episodes episode ON episode.chapter_id=chapter.id JOIN pages page ON page.episode_id=episode.id WHERE page.id=$1)', [fixture.pageId, organizationId]);
    return organizationId;
  }

  async function createTerminalFixture(terminalStatus: 'completed' | 'failed' = 'completed'): Promise<{ userId: string; jobId: string; tokenId: string; pageId: string; deliveryId: string }> {
    const userId = randomUUID(); const workId = randomUUID(); const chapterId = randomUUID(); const episodeId = randomUUID();
    const pageId = randomUUID(); const jobId = randomUUID(); const tokenId = randomUUID();
    await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, userId, `${userId}@example.invalid`]);
    await pool.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Legacy push fixture')", [workId, userId]);
    await pool.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
    await pool.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
    await pool.query("INSERT INTO pages(id,episode_id,page_number,status) VALUES($1,$2,1,'editing')", [pageId, episodeId]);
    await pool.query("INSERT INTO mobile_push_tokens(id,user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id) VALUES($1,$2,$3,'android','ja',$4,$5,'test-v1')", [tokenId, userId, randomUUID(), tokenId.replaceAll('-', '').repeat(2), `v1.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`]);
    await pool.query("INSERT INTO generation_jobs(id,user_id,job_type,status,generation_mode,credit_cost,params) VALUES($1,$2,'page_generate','queued','standard',0,$3::jsonb)", [jobId, userId, JSON.stringify({ page_id: pageId })]);
    await pool.query('UPDATE generation_jobs SET status=$2 WHERE id=$1', [jobId, terminalStatus]);
    const delivery = await pool.query<{ id: string }>('SELECT deliveries.id FROM mobile_push_notification_deliveries deliveries JOIN mobile_push_notification_outbox outbox ON outbox.id=deliveries.outbox_id WHERE outbox.generation_job_id=$1', [jobId]);
    expect(delivery.rowCount).toBe(1);
    return { userId, jobId, tokenId, pageId, deliveryId: delivery.rows[0]!.id };
  }
});

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => pool.query<Row>(text, values),
    transaction: async <T>(callback: (client: DatabaseClient) => Promise<T>) => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await callback({ query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => client.query<Row>(text, values) }); await client.query('COMMIT'); return result; }
      catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
