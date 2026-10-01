import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEPLOYMENT_DATA_INVARIANT_QUERIES } from '../../scripts/checkDeploymentDataInvariants.js';
import { readStateReferenceCopyHistory, UNRESOLVED_STATE_REFERENCE_COPY_SQL } from '../../src/repositories/StateReferenceCopyHistory.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;
const scope = { userId: randomUUID(), entityId: randomUUID(), stateId: randomUUID() };
const safe = { attempt_id: randomUUID(), state: 'succeeded', entity_id: scope.entityId, state_id: scope.stateId,
  ref_id: 'job-1', s3_key: `saved/${scope.userId}/entities/${scope.entityId}/states/${scope.stateId}/job-1.png` };

// Real SQL and application parsing must agree on every terminal-history shape.
// These in-memory VALUES rows contain no real user/account/storage data.
describePostgres('state copy settlement release invariant', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl }); });
  afterAll(async () => { await pool?.end(); });
  const cases: Array<{ name: string; value: unknown; unsafe: boolean }> = [
    { name: 'absent', value: undefined, unsafe: false },
    { name: 'null', value: null, unsafe: false },
    { name: 'empty', value: [], unsafe: false },
    { name: 'single confirmed response', value: [safe], unsafe: false },
    { name: 'proven not dispatched', value: [{ ...safe, state: 'not_dispatched' }], unsafe: false },
    { name: 'still unresolved', value: [{ ...safe, state: 'unresolved' }], unsafe: true },
    { name: 'legacy missing evidence', value: [{ ...safe, state: undefined, attempt_id: undefined }], unsafe: true },
    { name: 'malformed list', value: { ...safe }, unsafe: true },
    { name: 'malformed entry', value: [null], unsafe: true },
    { name: 'invalid token', value: [{ ...safe, attempt_id: 'not-a-uuid' }], unsafe: true },
    { name: 'duplicate token', value: [safe, safe], unsafe: true },
    { name: 'unknown state', value: [{ ...safe, state: 'timed_out' }], unsafe: true },
    { name: 'array state is not a string', value: [{ ...safe, state: ['succeeded'] }], unsafe: true },
    { name: 'numeric state is not a string', value: [{ ...safe, state: 1 }], unsafe: true },
    { name: 'foreign owner', value: [{ ...safe, s3_key: safe.s3_key.replace(scope.userId, randomUUID()) }], unsafe: true },
    { name: 'foreign state', value: [{ ...safe, state_id: randomUUID() }], unsafe: true },
    { name: 'invalid ref', value: [{ ...safe, ref_id: '../other' }], unsafe: true },
  ];
  it.each([
    { jobType: 'page_generate', params: { target: 'entity_state', entity_id: scope.entityId, entity_state_id: scope.stateId } },
    { jobType: 'entity_generate', params: { target: 'entity', entity_id: scope.entityId, entity_state_id: scope.stateId } },
    { jobType: 'entity_generate', params: {} },
  ])('履歴に適合しないjob scopeもSQLで拒否する: %j', async ({ jobType, params }) => {
    const rows = await pool.query<{ unsafe: boolean }>(`WITH generation_jobs AS (
      SELECT $1::uuid AS user_id, $2::text AS job_type, $3::jsonb AS params, $4::jsonb AS result
    ) SELECT (${UNRESOLVED_STATE_REFERENCE_COPY_SQL}) AS unsafe FROM generation_jobs`,
    [scope.userId, jobType, JSON.stringify(params), JSON.stringify({ state_reference_copies: [safe] })]);
    expect(rows.rows[0]?.unsafe).toBe(true);
  });

  it.each(cases)('$name', async ({ value, unsafe }) => {
    const result = value === undefined ? {} : { state_reference_copies: value };
    const params = { target: 'entity_state', entity_id: scope.entityId, entity_state_id: scope.stateId };
    const rows = await pool.query<{ unsafe: boolean }>(`WITH generation_jobs AS (
      SELECT $1::uuid AS user_id, 'entity_generate'::text AS job_type, $2::jsonb AS params, $3::jsonb AS result
    ) SELECT (${UNRESOLVED_STATE_REFERENCE_COPY_SQL}) AS unsafe FROM generation_jobs`,
    [scope.userId, JSON.stringify(params), JSON.stringify(result)]);
    expect(rows.rows[0]?.unsafe).toBe(unsafe);
    let parsedUnsafe: boolean;
    try { parsedUnsafe = readStateReferenceCopyHistory(value, scope).some((entry) => entry.state === 'unresolved'); }
    catch { parsedUnsafe = true; }
    expect(parsedUnsafe).toBe(unsafe);

    const invariant = DEPLOYMENT_DATA_INVARIANT_QUERIES.find((query) => query.name === 'generation_jobs.unresolved_state_reference_copies');
    expect(invariant).toBeDefined();
    const query = `WITH generation_jobs AS (SELECT $2::uuid AS id, $2::uuid AS user_id, 'entity_generate'::text AS job_type, $3::jsonb AS params, $4::jsonb AS result) ${invariant!.sql}`;
    const report = await pool.query(query, [10, scope.userId, JSON.stringify(params), JSON.stringify(result)]);
    expect(report.rows.length).toBe(unsafe ? 1 : 0);
  });
});
