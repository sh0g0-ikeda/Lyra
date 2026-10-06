import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { buildStageDatabaseDrainDbContract } from './stage-database-drain-db-contract.mjs';

const databaseUrl = process.env.DATABASE_URL;
const password = 'b'.repeat(64);
const expectedProofKeys = [
  'observed_at',
  'active_generation_jobs',
  'pending_generation_dispatches',
  'active_episode_export_jobs',
  'pending_episode_export_outbox',
  'active_account_deletion_requests',
  'pending_push_deliveries',
  'pending_credit_refunds',
  'pending_google_identity_link_challenges',
];
const grantedRelations = [
  'generation_jobs',
  'generation_quotes',
  'episode_export_jobs',
  'episode_export_job_outbox',
  'account_deletion_requests',
  'mobile_push_notification_deliveries',
  'mobile_push_notification_outbox',
  'mobile_push_tokens',
  'credit_ledger',
  'oauth_link_challenges',
];

function localize(sql) {
  return sql.replaceAll('lyrastaging', 'lyra_test');
}

async function assertNoContractRemnants(client) {
  const result = await client.query(`SELECT
    pg_catalog.to_regnamespace('lyra_stage_ops') IS NOT NULL AS schema_exists,
    pg_catalog.to_regrole('lyra_stage_drain_reader') IS NOT NULL AS reader_exists,
    pg_catalog.to_regrole('lyra_stage_drain_owner') IS NOT NULL AS owner_exists,
    pg_catalog.to_regprocedure('lyra_stage_ops.collect_database_drain_counts()') IS NOT NULL AS function_exists`);
  assert.deepEqual(result.rows, [{
    schema_exists: false,
    reader_exists: false,
    owner_exists: false,
    function_exists: false,
  }]);
}

async function prepareInstaller(client) {
  await client.query('CREATE ROLE lyra_staging CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS');
  await client.query('ALTER DATABASE lyra_test OWNER TO lyra_staging');
  await client.query('GRANT USAGE ON SCHEMA public TO lyra_staging WITH GRANT OPTION');
  for (const relation of grantedRelations) {
    await client.query(`GRANT SELECT ON TABLE public.${relation} TO lyra_staging WITH GRANT OPTION`);
  }
}

async function seedGoogleFixtures(client, userId) {
  const fixtures = [
    { status: 'pending', exchangeMaterial: 'p'.repeat(64), consumed: false },
    { status: 'processing', exchangeMaterial: 'r'.repeat(64), consumed: true },
    // oauth_link_challenges has no `completed` status; `linked` is terminal.
    { status: 'linked', exchangeMaterial: 'l'.repeat(64), consumed: true },
    { status: 'pending', exchangeMaterial: null, consumed: false },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    await client.query(
      `INSERT INTO public.oauth_link_challenges
        (id, user_id, provider, request_key, session_hash, state_hash, email_hash,
         native_subject, native_username, exchange_material, platform, status,
         created_at, expires_at, consumed_at)
       VALUES ($1, $2, 'Google', $3, $4, $5, $6, $7, $8, $9, 'web', $10,
         NOW(), NOW() + INTERVAL '5 minutes', CASE WHEN $11 THEN NOW() ELSE NULL END)`,
      [
        randomUUID(),
        userId,
        randomUUID(),
        '1'.repeat(64),
        String(index + 2).repeat(64),
        'a'.repeat(64),
        `stage-v2-install-subject-${index}`,
        `stage-v2-install-username-${index}`,
        fixture.exchangeMaterial,
        fixture.status,
        fixture.consumed,
      ],
    );
  }
  const seeded = await client.query(
    `SELECT status, exchange_material IS NOT NULL AS has_exchange_material
     FROM public.oauth_link_challenges WHERE user_id = $1
     ORDER BY status, has_exchange_material`,
    [userId],
  );
  assert.deepEqual(seeded.rows, [
    { status: 'linked', has_exchange_material: true },
    { status: 'pending', has_exchange_material: false },
    { status: 'pending', has_exchange_material: true },
    { status: 'processing', has_exchange_material: true },
  ]);
}

test('local PostgreSQL installs v2 directly and fully rolls back a missing-table failure', {
  timeout: 30_000,
}, async () => {
  assert.equal(process.env.APP_ENV, 'test', 'APP_ENV_TEST_REQUIRED');
  assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV_TEST_REQUIRED');
  assert.equal(typeof databaseUrl, 'string', 'DISPOSABLE_LOCAL_DATABASE_URL_REQUIRED');
  assert.match(databaseUrl, /^postgres(?:ql)?:\/\/[^/]+@(?:127\.0\.0\.1|localhost):(?:15433|15435)\/lyra_test(?:[?]|$)/u, 'DISPOSABLE_LOCAL_DATABASE_URL_REQUIRED');

  const contract = buildStageDatabaseDrainDbContract(password, { proofSchemaVersion: 2 });
  assert.equal(contract.schemaVersion, 2);
  assert.deepEqual(contract.passwordCommand.values, [password]);
  for (const sql of [contract.installSql, contract.verifySql, contract.teardownSql]) {
    assert.doesNotMatch(sql, new RegExp(password, 'u'));
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await assertNoContractRemnants(client);
    const beforeMissingAttempt = await client.query('SELECT COUNT(*)::text AS count FROM public.oauth_link_challenges');

    // Failure path: the v2-only relation disappears within this transaction.
    // Install may have begun creating roles/schema, so only a full ROLLBACK is accepted.
    await client.query('BEGIN');
    transactionOpen = true;
    await prepareInstaller(client);
    await client.query('ALTER TABLE public.oauth_link_challenges RENAME TO oauth_link_challenges_missing_for_v2_test');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(contract.passwordCommand.text, contract.passwordCommand.values);
    await assert.rejects(
      client.query(localize(contract.installSql)),
      (error) => error?.code === '42P01',
    );
    await client.query('ROLLBACK');
    transactionOpen = false;

    await assertNoContractRemnants(client);
    const missingRollback = await client.query(`SELECT
      pg_catalog.to_regclass('public.oauth_link_challenges') IS NOT NULL AS original_exists,
      pg_catalog.to_regclass('public.oauth_link_challenges_missing_for_v2_test') IS NOT NULL AS renamed_exists,
      (SELECT COUNT(*)::text FROM public.oauth_link_challenges) AS row_count`);
    assert.deepEqual(missingRollback.rows, [{
      original_exists: true,
      renamed_exists: false,
      row_count: beforeMissingAttempt.rows[0].count,
    }]);

    // Success path: password setting, install, full verify, reader proof, and
    // teardown all use this single backend connection and transaction.
    await client.query('BEGIN');
    transactionOpen = true;
    const backendBefore = await client.query('SELECT pg_backend_pid() AS pid');
    const userId = randomUUID();
    const generationJobId = randomUUID();
    await client.query(
      'INSERT INTO public.users (id, supabase_id, email) VALUES ($1, $2, $3)',
      [userId, `stage-v2-install-${userId}`, `stage-v2-install-${userId}@example.invalid`],
    );
    await seedGoogleFixtures(client, userId);
    await client.query(
      `INSERT INTO public.generation_jobs
        (id, user_id, job_type, status, generation_mode, credit_cost, params)
       VALUES ($1, $2, 'entity_generate', 'queued', 'standard', 0, '{}'::jsonb)`,
      [generationJobId, userId],
    );
    await prepareInstaller(client);
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(contract.passwordCommand.text, contract.passwordCommand.values);
    await client.query(localize(contract.installSql));
    await client.query(localize(contract.verifySql));

    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_stage_drain_reader');
    const proof = await client.query(contract.functionQuery);
    assert.equal(proof.rows.length, 1);
    assert.deepEqual(Object.keys(proof.rows[0]), expectedProofKeys);
    assert.ok(proof.rows[0].observed_at instanceof Date);
    assert.equal(proof.rows[0].active_generation_jobs, '1');
    assert.equal(proof.rows[0].pending_google_identity_link_challenges, '2');
    for (const key of expectedProofKeys.slice(1)) assert.match(proof.rows[0][key], /^\d+$/u);
    const privileges = await client.query(`SELECT
      pg_catalog.has_table_privilege(current_user, 'public.oauth_link_challenges', 'SELECT') AS table_select,
      pg_catalog.has_column_privilege(current_user, 'public.oauth_link_challenges', 'status', 'SELECT') AS status_select,
      pg_catalog.has_function_privilege(current_user, 'lyra_stage_ops.collect_database_drain_counts()', 'EXECUTE') AS function_execute`);
    assert.deepEqual(privileges.rows, [{ table_select: false, status_select: false, function_execute: true }]);
    await client.query('SAVEPOINT denied_google_table_read');
    await assert.rejects(
      client.query('SELECT status FROM public.oauth_link_challenges LIMIT 1'),
      (error) => error?.code === '42501',
    );
    await client.query('ROLLBACK TO SAVEPOINT denied_google_table_read');

    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(localize(contract.teardownSql));
    await client.query('RESET SESSION AUTHORIZATION');
    await assertNoContractRemnants(client);
    const googleColumnGrants = await client.query(`SELECT COUNT(*)::integer AS count
      FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'oauth_link_challenges'
        AND grantee IN ('lyra_stage_drain_owner', 'lyra_stage_drain_reader')`);
    assert.deepEqual(googleColumnGrants.rows, [{ count: 0 }]);
    const preserved = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM public.users WHERE id = $1) AS users,
      (SELECT COUNT(*)::integer FROM public.generation_jobs WHERE id = $2) AS jobs,
      (SELECT COUNT(*)::integer FROM public.oauth_link_challenges WHERE user_id = $1) AS challenges`,
    [userId, generationJobId]);
    assert.deepEqual(preserved.rows, [{ users: 1, jobs: 1, challenges: 4 }]);
    const backendAfter = await client.query('SELECT pg_backend_pid() AS pid');
    assert.deepEqual(backendAfter.rows, backendBefore.rows);

    await client.query('ROLLBACK');
    transactionOpen = false;
    await assertNoContractRemnants(client);
    const rolledBackFixtures = await client.query(
      `SELECT
        (SELECT COUNT(*)::integer FROM public.users WHERE id = $1) AS users,
        (SELECT COUNT(*)::integer FROM public.generation_jobs WHERE id = $2) AS jobs,
        (SELECT COUNT(*)::integer FROM public.oauth_link_challenges WHERE user_id = $1) AS challenges`,
      [userId, generationJobId],
    );
    assert.deepEqual(rolledBackFixtures.rows, [{ users: 0, jobs: 0, challenges: 0 }]);
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
