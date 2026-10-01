import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { decodeGenerationJobHistoryCursor, encodeGenerationJobHistoryCursor } from '../../src/domain/pagination.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { createJobRoutes } from '../../src/routes/jobs.js';
import { generationJobsResponseSchema as productionJobsSchema } from '../fixtures/production-mobile-2debe8c/jobSchemas.js';
const databaseUrl = process.env.DATABASE_URL;
const suite = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;
suite('generation job reporting compatibility', () => {
  let admin: Pool; let pool: Pool; let schema: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 2 }); schema = `job_reporting_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},public` });
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(new TestDatabase(pool), { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 }));
  }, 120000);
  afterAll(async () => { if (pool !== undefined) await pool.end(); if (admin !== undefined) { if (schema !== undefined) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  async function user(): Promise<string> {
    const id = randomUUID(); await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [id, `report-${id}`, `${id}@example.invalid`]);
    await pool.query('INSERT INTO credit_balances (user_id,monthly_credits,purchased_credits) VALUES ($1,10,10)', [id]); return id;
  }
  async function job(userId: string, organizationId: string | null = null, type = 'entity_generate'): Promise<string> {
    const id = randomUUID(); await pool.query("INSERT INTO generation_jobs (id,user_id,organization_id,job_type,status,generation_mode,credit_cost,params,created_at) VALUES ($1,$2,$3,$4,'queued','standard',9,'{}','2026-10-01T00:00:00Z')", [id,userId,organizationId,type]); return id;
  }
  async function ledger(userId: string, jobId: string, amount: number, organizationId: string | null = null): Promise<void> {
    await pool.query('INSERT INTO credit_ledger (user_id,organization_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after,job_id) VALUES ($1,$2,$3,$4,$4,0,10,10,$5)', [userId,organizationId,amount < 0 ? 'consume' : 'refund',amount,jobId]);
  }
  it('reports actual ledger charges and pending/full refunds instead of the declared cost or cancelled status', async () => {
    const owner = await user(); const jobId = await job(owner); await ledger(owner,jobId,-4);
    await pool.query("UPDATE generation_jobs SET status='failed',completed_at=NOW() WHERE id=$1",[jobId]);
    const repository = new PostgresGenerationJobRepository(new TestDatabase(pool));
    expect((await repository.findByIdAndUserId(jobId,owner))?.creditSettlement).toEqual({ chargedCredits:4,refundedCredits:0,netCredits:4,status:'refund_pending' });
    await ledger(owner,jobId,4);
    expect((await repository.findByIdAndUserId(jobId,owner))?.creditSettlement).toEqual({ chargedCredits:4,refundedCredits:4,netCredits:0,status:'refunded' });
    const unknown = await job(owner);
    expect((await repository.findByIdAndUserId(unknown,owner))?.creditSettlement).toBeUndefined();
    expect(await repository.findByIdAndUserId(jobId,await user())).toBeNull();
  });
  it('reports organization settlement for an authorized viewer independently of the initiating actor', async () => {
    const actor = await user(); const viewer = await user(); const outsider = await user(); const organizationId = randomUUID();
    await pool.query('INSERT INTO organizations (id,name,created_by_user_id) VALUES ($1,$2,$3)', [organizationId,'Reporting test',actor]);
    await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status) VALUES ($1,$2,'owner','active'),($1,$3,'viewer','active')",[organizationId,actor,viewer]);
    await pool.query('INSERT INTO organization_credit_balances (organization_id,monthly_credits,purchased_credits) VALUES ($1,10,10)',[organizationId]);
    const jobId = await job(actor,organizationId); await ledger(actor,jobId,-4,organizationId);
    const repository = new PostgresGenerationJobRepository(new TestDatabase(pool));
    expect((await repository.findByIdAndUserId(jobId,viewer,organizationId))?.creditSettlement).toMatchObject({ chargedCredits:4,status:'charged' });
    expect(await repository.findByIdAndUserId(jobId,viewer,null)).toBeNull(); expect(await repository.findByIdAndUserId(jobId,outsider,organizationId)).toBeNull();
    expect((await repository.listHistory({ userId:viewer,organizationId,limit:25,cursor:null })).jobs[0]?.creditSettlement).toMatchObject({ chargedCredits:4 });
  });
  it('filters before limiting and continues the deployed cursor without duplicates', async () => {
    const owner = await user(); const first = await job(owner,null,'entity_import_analysis'); const second = await job(owner,null,'entity_import_analysis'); await job(owner);
    const repository = new PostgresGenerationJobRepository(new TestDatabase(pool));
    const one = await repository.listHistory({ userId:owner,limit:1,cursor:null,statuses:['queued'],jobTypes:['entity_import_analysis'] });
    expect(one.jobs).toHaveLength(1); expect(one.nextCursor).not.toBeNull();
    const deployed = encodeGenerationJobHistoryCursor({ ...one.nextCursor!, format:'production-v1' });
    const two = await repository.listHistory({ userId:owner,limit:1,cursor:decodeGenerationJobHistoryCursor(deployed),statuses:['queued'],jobTypes:['entity_import_analysis'] });
    expect(new Set([...one.jobs,...two.jobs].map((entry)=>entry.id))).toEqual(new Set([first,second])); expect(two.nextCursor).toBeNull();
    expect((await repository.listHistory({ userId:owner,limit:25,cursor:null,statuses:['failed'],jobTypes:['entity_import_analysis'] })).jobs).toEqual([]);
  });
  it('keeps real paginated HTTP history readable by production Mobile while v2 sees imports', async () => {
    const owner = await user();
    const importId = await job(owner, null, 'entity_import_analysis');
    const entityId = await job(owner);
    const pageId = await job(owner, null, 'page_generate');
    const outsiderId = await job(await user());
    for (const jobId of [importId, entityId, pageId]) await ledger(owner, jobId, -1);
    const repository = new PostgresGenerationJobRepository(new TestDatabase(pool));
    const app = createJobRoutes({
      authMiddleware: async (c, next) => { c.set('user', { id: owner, supabaseId: owner, email: 'test@example.invalid', displayName: null, planCode: 'free' }); await next(); },
      rateLimitMiddleware: async (_c, next) => next(),
      jobService: {
        listJobHistory: (userId, input) => repository.listHistory({ userId, ...input }),
        getJob: async () => { throw new Error('Not used'); },
        cancelJob: async () => { throw new Error('Not used'); },
        hideJobFromHistory: async () => { throw new Error('Not used'); },
      },
    });
    const first = await app.request('/jobs?limit=1');
    expect(first.status).toBe(200);
    const one = productionJobsSchema.parse(await first.json());
    expect(one.jobs).toHaveLength(1);
    expect(one.next_cursor).not.toBeNull();
    const second = await app.request(`/jobs?limit=1&cursor=${encodeURIComponent(one.next_cursor!)}`);
    const two = productionJobsSchema.parse(await second.json());
    expect(new Set([...one.jobs, ...two.jobs].map((entry) => entry.id))).toEqual(new Set([entityId, pageId]));
    expect(two.next_cursor).toBeNull();
    const upgraded = await (await app.request('/jobs?job_contract=v2')).json();
    expect(new Set(upgraded.jobs.map((entry: { id: string }) => entry.id))).toEqual(new Set([importId, entityId, pageId]));
    expect(JSON.stringify(upgraded)).not.toContain(outsiderId);
    expect(productionJobsSchema.safeParse(upgraded).success).toBe(false);
  });
});
class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> { return this.pool.query<T>(text, values === undefined ? undefined : [...values]); }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work({ query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<R>(text, values === undefined ? undefined : [...values]) }); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
