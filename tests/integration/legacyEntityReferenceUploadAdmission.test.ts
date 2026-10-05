import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEntityReferenceUploadTokenRepository } from '../../src/repositories/EntityReferenceUploadTokenRepository.js';
import { PostgresLegacyAccountDeletionRepository } from '../../src/legacy/account/LegacyAccountDeletionRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const LEGACY_MIGRATIONS = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');

describePostgres('legacy entity reference upload admission', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `legacy_upload_admission_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public -c statement_timeout=30000`, max: 4 });
    database = testDatabase(pool);
    expect(await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationsDir: LEGACY_MIGRATIONS }))).toHaveLength(38);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  }, 120_000);

  it.each(['processing', 'pending_external_action', 'completed'] as const)(
    'personal issuance is denied without INSERT when deletion is %s', async (status) => {
      const fixture = await insertFixture(pool);
      await insertDeletionRequest(pool, fixture.userId, status);
      const result = await settle(repository().create(input(fixture)));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(await countTokens(pool, fixture.userId)).toBe(0);
    },
  );

  it('organization checks the current actor, active generate role, and actual bound scope', async () => {
    const fixture = await insertFixture(pool, true);
    const created = await repository().create(input(fixture));
    expect(created).toMatchObject({ entityId: fixture.entityId });
    await pool.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [fixture.organizationId, fixture.userId]);
    const deniedRole = await settle(repository().create(input(fixture)));
    expect(deniedRole.ok).toBe(false);
    expect(await countTokens(pool, fixture.userId)).toBe(1);
    await pool.query("UPDATE organization_members SET role='editor' WHERE organization_id=$1 AND user_id=$2", [fixture.organizationId, fixture.userId]);
    const wrongScope = await settle(repository().create({ ...input(fixture), organizationId: randomUUID() }));
    expect(wrongScope.ok).toBe(false);
    expect(await countTokens(pool, fixture.userId)).toBe(1);
  });

  it('claim先行はissuanceをactor lockで待機させ、claim後にINSERT 0で拒否する', async () => {
    const fixture = await insertFixture(pool);
    await insertDeletionRequest(pool, fixture.userId, 'blocked');
    const claimant = await PinnedDatabase.connect(pool);
    const writer = await PinnedDatabase.connect(pool);
    try {
      await claimant.query('BEGIN');
      await claimant.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [fixture.userId]);
      const issuing = settle(new PostgresEntityReferenceUploadTokenRepository(writer, 'legacy_2debe_v1').create(input(fixture)));
      await waitForBlockedQuery(pool, writer.pid);
      await claimant.query("UPDATE account_deletion_requests SET status='processing' WHERE user_id=$1", [fixture.userId]);
      await claimant.query('COMMIT');
      const result = await issuing;
      expect(result.ok).toBe(false);
      expect(await countTokens(pool, fixture.userId)).toBe(0);
    } finally { await claimant.query('ROLLBACK').catch(() => undefined); await claimant.close(); await writer.close(); }
  });

  it('issuance先行はclaimをactor lockで待機させ、commit後にtokenを観測できる', async () => {
    const fixture = await insertFixture(pool);
    const gate = deferred<void>();
    const inserted = deferred<void>();
    const writer = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('INSERT INTO entity_reference_upload_tokens')) { inserted.resolve(); await gate.promise; }
    });
    const claimant = await PinnedDatabase.connect(pool);
    try {
      const issuance = new PostgresEntityReferenceUploadTokenRepository(writer, 'legacy_2debe_v1').create(input(fixture));
      await inserted.promise;
      const claim = new PostgresLegacyAccountDeletionRepository(claimant, claimant).claimRequest({
        userId: fixture.userId, identityId: `identity-${fixture.userId}`, processingToken: randomUUID(),
        acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true,
      });
      await waitForBlockedQuery(pool, claimant.pid);
      gate.resolve();
      await issuance;
      const claimed = await claim;
      expect(claimed.kind).toBe('blocked');
      if (claimed.kind === 'blocked') expect(claimed.flight.activePersonalUploadCount).toBe(1);
      expect(await countTokens(pool, fixture.userId)).toBe(1);
      expect((await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM account_deletion_requests WHERE user_id=$1 AND status='processing'", [fixture.userId])).rows[0]?.count).toBe(0);
    } finally { gate.resolve(); await claimant.close(); await writer.close(); }
  });

  it('role downgrade先行はmembership lock待機後に拒否しINSERTしない', async () => {
    const fixture = await insertFixture(pool, true);
    const updater = await pool.connect(); const writer = await PinnedDatabase.connect(pool);
    try {
      await updater.query('BEGIN');
      await updater.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [fixture.organizationId, fixture.userId]);
      const issuance = settle(new PostgresEntityReferenceUploadTokenRepository(writer, 'legacy_2debe_v1').create(input(fixture)));
      await waitForBlockedQuery(pool, writer.pid);
      await updater.query('COMMIT');
      expect((await issuance).ok).toBe(false);
      expect(await countTokens(pool, fixture.userId)).toBe(0);
    } finally { await updater.query('ROLLBACK').catch(() => undefined); updater.release(); await writer.close(); }
  });

  it('work scope update先行はworks lock待機後にfresh scopeで拒否し循環しない', async () => {
    const fixture = await insertFixture(pool);
    const updater = await pool.connect(); const writer = await PinnedDatabase.connect(pool);
    try {
      const foreignOrganizationId = randomUUID();
      await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Foreign scope',$2)", [foreignOrganizationId, fixture.userId]);
      await updater.query('BEGIN');
      await updater.query('UPDATE works SET organization_id=$2 WHERE id=$1', [fixture.workId, foreignOrganizationId]);
      const issuance = settle(new PostgresEntityReferenceUploadTokenRepository(writer, 'legacy_2debe_v1').create(input(fixture)));
      await waitForBlockedQuery(pool, writer.pid);
      await updater.query('COMMIT');
      expect((await issuance).ok).toBe(false);
      expect(await countTokens(pool, fixture.userId)).toBe(0);
    } finally { await updater.query('ROLLBACK').catch(() => undefined); updater.release(); await writer.close(); }
  });

  function repository(): PostgresEntityReferenceUploadTokenRepository {
    return new PostgresEntityReferenceUploadTokenRepository(database, 'legacy_2debe_v1');
  }
});

async function insertFixture(pool: Pool, organization = false): Promise<{ userId: string; organizationId: string | null; workId: string; entityId: string }> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, `identity-${userId}`, `${userId}@example.invalid`]);
  const organizationId = organization ? randomUUID() : null;
  if (organizationId !== null) {
    await pool.query("INSERT INTO organizations(id,name,created_by_user_id) VALUES($1,'Upload org',$2)", [organizationId, userId]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'editor','active')", [organizationId, userId]);
  }
  const workId = randomUUID();
  const entityId = randomUUID();
  await pool.query("INSERT INTO works(id,user_id,organization_id,title) VALUES($1,$2,$3,'Upload work')", [workId, userId, organizationId]);
  await pool.query("INSERT INTO entities(id,work_id,user_id,entity_type,name,structured_fields,speech_profile) VALUES($1,$2,$3,'character','Upload entity','{}'::jsonb,'{}'::jsonb)", [entityId, workId, userId]);
  return { userId, organizationId, workId, entityId };
}

function input(fixture: { userId: string; organizationId: string | null; entityId: string }) {
  return { tokenHash: randomUUID().replaceAll('-', '').repeat(2), userId: fixture.userId, organizationId: fixture.organizationId, entityId: fixture.entityId, purpose: 'entity_reference_import' as const, mimeType: 'image/png' as const, sizeBytes: 8, s3Key: `tmp/${fixture.userId}/entities/imports/${randomUUID()}.png`, expiresAt: new Date(Date.now() + 300_000) };
}

async function insertDeletionRequest(pool: Pool, userId: string, status: 'blocked' | 'processing' | 'pending_external_action' | 'completed'): Promise<void> {
  await pool.query('INSERT INTO account_deletion_requests(user_id,identity_id,status,completed_at) VALUES($1,$2,$3,CASE WHEN $3=\'completed\' THEN NOW() ELSE NULL END)', [userId, `identity-${userId}`, status]);
}
async function countTokens(pool: Pool, userId: string): Promise<number> { return (await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM entity_reference_upload_tokens WHERE user_id=$1', [userId])).rows[0]?.count ?? 0; }
function testDatabase(pool: Pool): DatabaseClient & TransactionRunner { return { query: async <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => pool.query<R>(text, values === undefined ? undefined : [...values]), transaction: async <T>(work: (client: DatabaseClient) => Promise<T>) => { const client = await pool.connect(); try { await client.query('BEGIN'); const value = await work({ query: async <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<R>(text, values === undefined ? undefined : [...values]) }); await client.query('COMMIT'); return value; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } }; }
async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; } }
class PinnedDatabase implements DatabaseClient, TransactionRunner {
  private constructor(private readonly client: PoolClient, public readonly pid: number, private readonly onQuery?: (sql: string) => Promise<void>) {}
  public static async connect(pool: Pool, onQuery?: (sql: string) => Promise<void>): Promise<PinnedDatabase> { const client = await pool.connect(); const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid; if (pid === undefined) throw new Error('Missing backend pid'); return new PinnedDatabase(client, pid, onQuery); }
  public async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) { return this.client.query<R>(text, values === undefined ? undefined : [...values]); }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> { await this.client.query('BEGIN'); try { const value = await work({ query: async <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => { const result = await this.client.query<R>(text, values === undefined ? undefined : [...values]); await this.onQuery?.(text); return result; } }); await this.client.query('COMMIT'); return value; } catch (error) { await this.client.query('ROLLBACK'); throw error; } }
  public async close(): Promise<void> { this.client.release(); }
}
async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> { for (let attempt = 0; attempt < 200; attempt += 1) { if ((await pool.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0]?.blocked === true) return; await new Promise<void>((resolve) => setTimeout(resolve, 10)); } throw new Error('Issuance did not block'); }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>((innerResolve) => { resolve = innerResolve; }), resolve }; }
