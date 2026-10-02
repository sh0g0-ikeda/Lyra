import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresGoogleIdentityLinkRepository } from '../../src/repositories/GoogleIdentityLinkRepository.js';
import type { GoogleLinkChallenge } from '../../src/domain/types/googleIdentityLink.js';
import { GOOGLE_LINK_TTL_MS } from '../../src/domain/auth/GoogleLinkProtocol.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf, throwingRejectionOf } from './asyncPostgresAssertions.js';
const dbDescribe = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
dbDescribe('Google identity link durable challenges', () => {
    let admin: Pool, pool: Pool, database: DatabaseClient & TransactionRunner, repo: PostgresGoogleIdentityLinkRepository;
    const schema = `google_identity_links_${process.pid}_${Date.now()}`;
    beforeAll(async () => { admin = new Pool({ connectionString: process.env.DATABASE_URL }); await admin.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public`, max: 12 }); database = testDatabase(pool); repo = new PostgresGoogleIdentityLinkRepository(database); await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database)); }, 120000);
    afterAll(async () => { if (pool)
        await pool.end(); if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    } });
    async function fixture(): Promise<GoogleLinkChallenge> { const userId = randomUUID(); await pool.query('INSERT INTO users(id,supabase_id,email) VALUES($1,$2,$3)', [userId, userId, `${userId}@example.invalid`]); const createdAt = new Date(); return { id: randomUUID(), userId, requestKey: randomUUID(), nativeSubject: userId, nativeUsername: userId, sessionHash: 'a'.repeat(64), stateHash: randomUUID().replaceAll('-', '').repeat(2), emailHash: 'b'.repeat(64), exchangeMaterial: 'encrypted'.repeat(10), platform: 'mobile', status: 'pending', providerSubjectHash: null, messageCode: null, createdAt, expiresAt: new Date(createdAt.getTime() + GOOGLE_LINK_TTL_MS), consumedAt: null }; }
    it('concurrent same-key starts create one immutable receipt', async () => { const f = await fixture(); const rows = await Promise.all([repo.create(f), repo.create({ ...f, id: randomUUID(), stateHash: 'c'.repeat(64) })]); expect(rows[0].id).toBe(rows[1].id); expect((await pool.query('SELECT count(*)::int n FROM oauth_link_challenges WHERE user_id=$1', [f.userId])).rows[0].n).toBe(1); });
    it('callback state can only be claimed once under concurrency', async () => { const f = await repo.create(await fixture()); const claims = await Promise.all([repo.claimState(f.stateHash), repo.claimState(f.stateHash)]); expect(claims.filter(Boolean)).toHaveLength(1); });
    it('provider reservation is durable before any mutation and scoped uniquely across users', async () => { const a = await repo.create(await fixture()), b = await repo.create(await fixture()); await repo.claimState(a.stateHash); await repo.claimState(b.stateHash); await repo.reserveIdentity(a.id, 'd'.repeat(64)); expect(await throwingRejectionOf(repo.reserveIdentity(b.id, 'd'.repeat(64)))).toThrow(); const stored = await repo.findForUser(a.id, a.userId); expect(stored).toMatchObject({ providerSubjectHash: 'd'.repeat(64), exchangeMaterial: null, status: 'processing' }); });
    it('successful linking and read reconciliation preserve one identity; replay does not mutate again', async () => { const f = await repo.create(await fixture()); await repo.claimState(f.stateHash); await repo.reserveIdentity(f.id, 'e'.repeat(64)); let calls = 0; await repo.performLink(f.id, 'e'.repeat(64), async () => { calls++; }); await repo.completeReconciliation(f.id, 'e'.repeat(64)); expect(calls).toBe(1); expect((await repo.findForUser(f.id, f.userId))?.status).toBe('linked'); expect(await throwingRejectionOf(repo.performLink(f.id, 'e'.repeat(64), async () => { calls++; }))).toThrow(); expect(calls).toBe(1); });
    it('unknown mutation outcome keeps committed intent and cannot be stolen by a new challenge', async () => { const f = await repo.create(await fixture()); await repo.claimState(f.stateHash); await repo.reserveIdentity(f.id, 'f'.repeat(64)); expect(await throwingRejectionOf(repo.performLink(f.id, 'f'.repeat(64), async () => { throw new Error('network lost'); }))).toThrow(); await repo.finish(f.id, 'recovery_required', 'RECOVERY_REQUIRED'); expect((await repo.findForUser(f.id, f.userId))?.providerSubjectHash).toBe('f'.repeat(64)); const next = await repo.create({ ...f, id: randomUUID(), requestKey: randomUUID(), stateHash: '0'.repeat(64) }); await repo.claimState(next.stateHash); expect(await throwingRejectionOf(repo.reserveIdentity(next.id, 'f'.repeat(64)))).toThrow(); await repo.completeReconciliation(f.id, 'f'.repeat(64)); expect((await repo.findForUser(f.id, f.userId))?.status).toBe('linked'); });
    it('deletion gate removes all private challenges and reservations and blocks late mutation', async () => { const f = await repo.create(await fixture()); await repo.claimState(f.stateHash); await repo.reserveIdentity(f.id, '1'.repeat(64)); await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1', [f.userId]); expect(await repo.findForUser(f.id, f.userId)).toBeNull(); expect((await pool.query('SELECT count(*)::int n FROM oauth_identity_links WHERE user_id=$1', [f.userId])).rows[0].n).toBe(0); let called = false; expect(await throwingRejectionOf(repo.performLink(f.id, '1'.repeat(64), async () => { called = true; }))).toThrow(); expect(called).toBe(false); expect(await throwingRejectionOf(repo.create({ ...f, id: randomUUID(), requestKey: randomUUID() }))).toThrow(); });
    it('provider success followed by lost DB finalization retains intent for read-only recovery', async () => {
        const f = await repo.create(await fixture());
        await repo.claimState(f.stateHash);
        await repo.reserveIdentity(f.id, '2'.repeat(64));
        let remoteCalls = 0;
        const failing: DatabaseClient & TransactionRunner = { query: database.query, transaction: async (fn) => database.transaction(async (client) => fn({ query: async (text, values) => {
                    if (text.includes("SET status='linked'"))
                        throw new Error('Injected post-provider DB failure');
                    return client.query(text, values);
                } })) };
        const failingRepo = new PostgresGoogleIdentityLinkRepository(failing);
        expect(await throwingRejectionOf(failingRepo.performLink(f.id, '2'.repeat(64), async () => { remoteCalls++; }))).toThrow();
        expect(await repo.findForUser(f.id, f.userId)).toMatchObject({ status: 'processing', providerSubjectHash: '2'.repeat(64), exchangeMaterial: null });
        await repo.completeReconciliation(f.id, '2'.repeat(64));
        expect(remoteCalls).toBe(1);
        expect((await repo.findForUser(f.id, f.userId))?.status).toBe('linked');
    });
    it('pending expiry cleanup is bounded and owner lookup never returns another account', async () => { const f = await fixture(); f.createdAt = new Date(Date.now() - 700000); f.expiresAt = new Date(f.createdAt.getTime() + GOOGLE_LINK_TTL_MS); await repo.create(f); expect(await repo.findForUser(f.id, randomUUID())).toBeNull(); expect(await repo.claimState(f.stateHash)).toBeNull(); expect(await repo.expirePending(1)).toBe(1); expect(await repo.findForUser(f.id, f.userId)).toMatchObject({ status: 'expired', exchangeMaterial: null }); expect(await throwingRejectionOf(repo.expirePending(10000))).toThrow(); });
    it('a lost reservation acknowledgement cannot downgrade durable intent to terminal failure', async () => {
        const f = await repo.create(await fixture());
        await repo.claimState(f.stateHash); await repo.reserveIdentity(f.id, '3'.repeat(64));
        await repo.finish(f.id, 'failed', 'GOOGLE_LINK_FAILED');
        expect(await repo.findForUser(f.id, f.userId)).toMatchObject({ status: 'recovery_required', messageCode: 'RECOVERY_REQUIRED' });
        await repo.completeReconciliation(f.id, '3'.repeat(64));
        expect((await repo.findForUser(f.id, f.userId))?.status).toBe('linked');
    });
    it('constraint rollback cannot leave a consumed state without its status', async () => { const f = await repo.create(await fixture()); expect(await rejectionOf(pool.query("UPDATE oauth_link_challenges SET status='linked' WHERE id=$1", [f.id]))).toMatchObject({ code: '23514' }); expect((await repo.findForUser(f.id, f.userId))?.status).toBe('pending'); });
});
function testDatabase(pool: Pool): DatabaseClient & TransactionRunner { return { query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => pool.query<Row>(text, values), transaction: async <T>(fn: (db: DatabaseClient) => Promise<T>) => { const c = await pool.connect(); try {
        await c.query('BEGIN');
        const result = await fn({ query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => c.query<Row>(text, values) });
        await c.query('COMMIT');
        return result;
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } } }; }
