import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresOrganizationRepository } from '../../src/repositories/OrganizationRepository.js';
import { OrganizationService } from '../../src/services/organization/OrganizationService.js';
import { createOrganizationRoutes } from '../../src/routes/organizations.js';
import type { OrganizationBillingServicePort } from '../../src/services/organization/OrganizationBillingService.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import {
  organizationUsageResponseSchema, organizationAuditLogsResponseSchema,
  organizationMembersResponseSchema, organizationInvitationsResponseSchema,
} from '../fixtures/production-mobile-2debe8c/organizationSchemas.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;
const month = "date_trunc('month', timezone('UTC', NOW())) AT TIME ZONE 'UTC'";
const tiedTimestamp = `(${month}) + INTERVAL '1 day 0.123456 seconds'`;
suite('organization pagination production Mobile compatibility', () => {
  let admin: Pool; let pool: Pool; let schema: string; let service: OrganizationService;
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    schema = `organization_pagination_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},public` });
    const database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 }));
    service = new OrganizationService(new PostgresOrganizationRepository(database, database));
  }, 120000);
  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      if (schema !== undefined) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  async function user(): Promise<string> {
    const id = randomUUID();
    await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [id, `org-page-${id}`, `${id}@example.invalid`]);
    return id;
  }
  async function organization(): Promise<{ owner: string; id: string }> {
    const owner = await user(); const id = randomUUID();
    await pool.query('INSERT INTO organizations (id,name,created_by_user_id) VALUES ($1,$2,$3)', [id, 'Pagination fixture', owner]);
    await member(id, owner, 'owner');
    return { owner, id };
  }
  async function member(organizationId: string, userId: string, role: string): Promise<void> {
    await pool.query(`INSERT INTO organization_members (organization_id,user_id,role,status,created_at) VALUES ($1,$2,$3,'active',${tiedTimestamp})`, [organizationId, userId, role]);
  }
  function routes(userId: string): ReturnType<typeof createOrganizationRoutes> {
    const app = createOrganizationRoutes({
      authMiddleware: async (c, next) => {
        c.set('user', { id: userId, supabaseId: userId, email: 'test@example.invalid', displayName: null, planCode: 'free' });
        await next();
      },
      rateLimitMiddleware: async (_c, next) => next(),
      organizationService: service,
      organizationBillingService: {} as OrganizationBillingServicePort,
    });
    app.onError(errorHandler);
    return app;
  }
  async function read<T>(app: ReturnType<typeof routes>, path: string, contract: z.ZodType<T>): Promise<T> {
    const response = await app.request(path);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return contract.parse(body);
  }
  it('traverses more than 200 tied microsecond events and reports the entire UTC month on every page', async () => {
    const org = await organization(); const app = routes(org.owner);
    await pool.query(`INSERT INTO organization_usage_events (organization_id,user_id,event_type,credit_amount,created_at,metadata)
      SELECT $1,$2,'generation.started',1,${tiedTimestamp},'{"generation_type":"page_generate","draft_prompt":"secret","source_s3_key":"private"}'::jsonb
      FROM generate_series(1,205)`, [org.id, org.owner]);
    await pool.query(`INSERT INTO organization_usage_events (organization_id,event_type,credit_amount,created_at) VALUES
      ($1,'refund',20,${tiedTimestamp}), ($1,'adjustment',9,${tiedTimestamp}),
      ($1,'previous',900,(${month}) - INTERVAL '1 microsecond'),
      ($1,'future',800,(${month}) + INTERVAL '1 month')`, [org.id]);
    const expected = await pool.query<{ id: string }>('SELECT id FROM organization_usage_events WHERE organization_id=$1 ORDER BY created_at DESC,id DESC', [org.id]);
    const seen: string[] = []; let cursor: string | null = null; const sizes: number[] = [];
    do {
      const page: z.output<typeof organizationUsageResponseSchema> = await read(app, `/organizations/${org.id}/usage?limit=100${cursor === null ? '' : `&cursor=${cursor}`}`, organizationUsageResponseSchema);
      sizes.push(page.usage_events.length); seen.push(...page.usage_events.map((event) => event.id));
      expect(page.summary).toEqual({
        current_month_total_credits: 234,
        by_member: [{ key: org.owner, credits: 205 }, { key: 'unknown', credits: 29 }],
        by_work: [{ key: 'unknown', credits: 234 }],
        by_generation_type: [{ key: 'generation.started', credits: 205 }, { key: 'refund', credits: 20 }, { key: 'adjustment', credits: 9 }],
      });
      for (const event of page.usage_events) {
        expect(event.metadata).not.toHaveProperty('draft_prompt'); expect(event.metadata).not.toHaveProperty('source_s3_key');
      }
      cursor = page.next_cursor;
      expect(sizes.length).toBeLessThan(5);
    } while (cursor !== null);
    expect(sizes).toEqual([100,100,9]);
    expect(seen).toEqual(expected.rows.map((row) => row.id));
    const legacy = await read(app, `/organizations/${org.id}/usage`, organizationUsageResponseSchema);
    expect(legacy.usage_events).toHaveLength(200); expect(legacy.summary.current_month_total_credits).toBe(234);
    const first = await read(app, `/organizations/${org.id}/usage?limit=1`, organizationUsageResponseSchema);
    expect(first.usage_events).toHaveLength(1); expect(first.summary).toEqual(legacy.summary);
    const emptyOrg = await organization();
    const empty = await read(routes(emptyOrg.owner), `/organizations/${emptyOrg.id}/usage?limit=1`, organizationUsageResponseSchema);
    expect(empty.usage_events).toEqual([]); expect(empty.next_cursor).toBeNull(); expect(empty.summary.current_month_total_credits).toBe(0);
  });
  it('traverses all audit rows and applies billing-only filters before page limits', async () => {
    const org = await organization(); const billing = await user(); await member(org.id, billing, 'billing');
    await pool.query(`INSERT INTO organization_audit_logs (organization_id,actor_user_id,action,target_type,created_at,metadata)
      SELECT $1,$2,CASE WHEN n % 2 = 0 THEN 'billing.paid' ELSE 'work.updated' END,'organization',${tiedTimestamp},'{"credits":1,"stripe_event_id":"private"}'::jsonb
      FROM generate_series(1,205) AS n`, [org.id, org.owner]);
    for (const [viewer, count, filtered] of [[org.owner,205,false],[billing,102,true]] as const) {
      const app = routes(viewer); const ids: string[] = []; let cursor: string | null = null;
      do {
        const page: z.output<typeof organizationAuditLogsResponseSchema> = await read(app, `/organizations/${org.id}/audit-logs?limit=100${cursor === null ? '' : `&cursor=${cursor}`}`, organizationAuditLogsResponseSchema);
        expect(page.audit_logs.length).toBeLessThanOrEqual(100);
        for (const log of page.audit_logs) { if (filtered) expect(log.action).toBe('billing.paid'); expect(log.metadata).toEqual({ credits: 1 }); }
        ids.push(...page.audit_logs.map((log) => log.id)); cursor = page.next_cursor;
        expect(ids.length).toBeLessThanOrEqual(count);
      } while (cursor !== null);
      expect(new Set(ids).size).toBe(count);
      const expected = await pool.query<{ id: string }>(`SELECT id FROM organization_audit_logs WHERE organization_id=$1 ${filtered ? "AND action LIKE 'billing.%'" : ''} ORDER BY created_at DESC,id DESC`, [org.id]);
      expect(ids).toEqual(expected.rows.map((row) => row.id));
    }
  });
  it('bounds member and invitation pages, respects exact timestamp ties, and excludes removed members', async () => {
    const org = await organization(); const app = routes(org.owner);
    for (let n=0;n<3;n+=1) await member(org.id, await user(), 'editor');
    const removed = await user(); await member(org.id, removed, 'viewer');
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [org.id,removed]);
    await pool.query(`INSERT INTO organization_invitations (organization_id,email,role,token_hash,invited_by_user_id,expires_at,created_at)
      SELECT $1,'invite-' || n || '@example.invalid','editor',gen_random_uuid()::text,$2,NOW()+INTERVAL '7 days',${tiedTimestamp} FROM generate_series(1,4) AS n`,[org.id,org.owner]);
    for (const endpoint of ['members','invitations'] as const) {
      const ids: string[] = []; let cursor: string | null = null;
      do {
        const path: string = `/organizations/${org.id}/${endpoint}?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page: z.output<typeof organizationMembersResponseSchema> | z.output<typeof organizationInvitationsResponseSchema> = endpoint === 'members'
          ? await read(app,path,organizationMembersResponseSchema)
          : await read(app,path,organizationInvitationsResponseSchema);
        const items = 'members' in page ? page.members : page.invitations;
        expect(items).toHaveLength(2); ids.push(...items.map((item) => item.id)); cursor = page.next_cursor;
        expect(ids.length).toBeLessThanOrEqual(4);
      } while (cursor !== null);
      expect(new Set(ids).size).toBe(4);
      const table = endpoint === 'members' ? 'organization_members' : 'organization_invitations';
      const expected = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE organization_id=$1 ${endpoint === 'members' ? "AND status <> 'removed'" : ''} ORDER BY created_at DESC,id DESC`,[org.id]);
      expect(ids).toEqual(expected.rows.map((row) => row.id));
    }
  });
  it('rechecks tenant access, membership and roles on continuation; rejects wrong-endpoint cursors', async () => {
    const org = await organization(); const foreign = await organization(); const app = routes(org.owner);
    await pool.query(`INSERT INTO organization_usage_events (organization_id,event_type,credit_amount,created_at)
      SELECT $1,'generation.started',1,${tiedTimestamp} FROM generate_series(1,3)`,[org.id]);
    const first = await read(app,`/organizations/${org.id}/usage?limit=1`,organizationUsageResponseSchema);
    const cursor = first.next_cursor!;
    expect((await app.request(`/organizations/${org.id}/audit-logs?limit=1&cursor=${cursor}`)).status).toBe(422);
    const outsider = routes(foreign.owner);
    for (const endpoint of ['members','invitations','usage','audit-logs']) {
      expect((await outsider.request(`/organizations/${org.id}/${endpoint}?limit=1`)).status).toBe(404);
    }
    expect((await app.request(`/organizations/${foreign.id}/usage?limit=1&cursor=${cursor}`)).status).toBe(404);
    // Authorized access to a different tenant still scopes the lookup and aggregate there.
    await member(foreign.id,org.owner,'admin');
    const scoped = await read(app,`/organizations/${foreign.id}/usage?limit=1&cursor=${cursor}`,organizationUsageResponseSchema);
    expect(scoped.usage_events).toEqual([]); expect(scoped.summary.current_month_total_credits).toBe(0);
    const viewer = await user(); await member(org.id,viewer,'viewer');
    for (const endpoint of ['members','invitations','usage','audit-logs']) {
      expect((await routes(viewer).request(`/organizations/${org.id}/${endpoint}?limit=1`)).status).toBe(403);
    }
    await pool.query("UPDATE organization_members SET status='suspended' WHERE organization_id=$1 AND user_id=$2",[org.id,org.owner]);
    expect((await app.request(`/organizations/${org.id}/usage?limit=1&cursor=${cursor}`)).status).toBe(404);
  });
});
class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<R>(text, values === undefined ? undefined : [...values]) });
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
