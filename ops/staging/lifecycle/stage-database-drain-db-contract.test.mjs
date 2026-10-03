import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { DATABASE_DRAIN_PROOF_QUERY } from './stage-database-drain-proof.mjs';
import {
  buildStageDatabaseDrainDbContract,
  STAGE_DATABASE_DRAIN_QUALIFIED_QUERY,
} from './stage-database-drain-db-contract.mjs';

const password = 'a'.repeat(64);

test('stage drain contract binds a bounded password without embedding it in SQL', () => {
  const contract = buildStageDatabaseDrainDbContract(password);

  assert.deepEqual(contract.passwordCommand, {
    text: "SELECT pg_catalog.set_config('lyra.stage_drain_reader_password', $1, true)",
    values: [password],
  });
  for (const sql of [contract.installSql, contract.verifySql, contract.teardownSql]) {
    assert.doesNotMatch(sql, new RegExp(password, 'u'));
  }
  for (const invalid of ['', 'a'.repeat(63), 'a'.repeat(65), 'G'.repeat(64), `${'a'.repeat(63)}'`]) {
    assert.throws(() => buildStageDatabaseDrainDbContract(invalid), /STAGE_DATABASE_DRAIN_PASSWORD_INVALID/u);
  }
});

test('install SQL exposes only the exact counter function to the fixed stage reader', () => {
  const contract = buildStageDatabaseDrainDbContract(password);

  assert.equal(STAGE_DATABASE_DRAIN_QUALIFIED_QUERY.replaceAll('public.', ''), DATABASE_DRAIN_PROOF_QUERY);
  for (const relation of [
    'generation_jobs',
    'generation_quotes',
    'episode_export_jobs',
    'episode_export_job_outbox',
    'account_deletion_requests',
    'mobile_push_notification_deliveries',
    'mobile_push_notification_outbox',
    'mobile_push_tokens',
    'credit_ledger',
  ]) {
    assert.match(STAGE_DATABASE_DRAIN_QUALIFIED_QUERY, new RegExp(`(?:FROM|JOIN) public\\.${relation}\\b`, 'u'));
    assert.doesNotMatch(STAGE_DATABASE_DRAIN_QUALIFIED_QUERY, new RegExp(`(?:FROM|JOIN) ${relation}\\b`, 'u'));
  }
  assert.match(contract.installSql, /CREATE ROLE lyra_stage_drain_reader WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/u);
  assert.match(contract.installSql, /VALID UNTIL %L/u);
  assert.match(contract.installSql, /'2026-10-09T16:20:00Z'/u);
  assert.match(contract.installSql, /CREATE ROLE lyra_stage_drain_owner WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/u);
  assert.match(contract.installSql, /current_user <> 'lyra_staging' OR session_user <> 'lyra_staging'/u);
  assert.match(contract.installSql, /GRANT lyra_stage_drain_owner TO lyra_staging WITH SET TRUE, INHERIT FALSE/u);
  assert.match(contract.installSql, /SECURITY DEFINER/u);
  assert.match(contract.installSql, /SET search_path = pg_catalog, pg_temp/u);
  assert.match(contract.installSql, /SET row_security = off/u);
  assert.match(contract.installSql, /REVOKE ALL ON FUNCTION lyra_stage_ops\.collect_database_drain_counts\(\) FROM PUBLIC/u);
  assert.match(contract.installSql, /GRANT EXECUTE ON FUNCTION lyra_stage_ops\.collect_database_drain_counts\(\) TO lyra_stage_drain_reader/u);
  assert.match(contract.installSql, /GRANT CONNECT ON DATABASE lyrastaging TO lyra_stage_drain_reader/u);
  assert.match(contract.verifySql, /grantor = 10/u);
  assert.match(contract.verifySql, /role_membership_count NOT IN \(0, 2\)/u);
  assert.match(contract.verifySql, /role_membership_count = 2/u);
  assert.doesNotMatch(contract.verifySql, /NOT installer_is_superuser\s+AND\s+\(\s+role_membership_count <> 2/u);
  assert.match(contract.verifySql, /AND prosrc = /u);
  assert.doesNotMatch(contract.installSql, /GRANT SELECT ON (?:ALL TABLES|TABLE public\.[a-z_]+ TO lyra_stage_drain_reader)/u);
  assert.doesNotMatch(contract.teardownSql, /CASCADE|DROP TABLE|DROP DATABASE|TRUNCATE/u);
});

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.APP_ENV === 'test'
  && typeof databaseUrl === 'string'
  && /^postgres(?:ql)?:\/\/[^/]+@(?:127\.0\.0\.1|localhost):15433\/lyra_test(?:[?]|$)/u.test(databaseUrl);

test('local PostgreSQL proves the reader can execute only the counter function and teardown is scoped', {
  skip: !runPostgres,
  timeout: 30_000,
}, async () => {
  const contract = buildStageDatabaseDrainDbContract(password);
  const localize = (sql) => sql.replaceAll('lyrastaging', 'lyra_test');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rlsUserId = randomUUID();
    await client.query(
      `INSERT INTO public.users (id, supabase_id, email)
       VALUES ($1, $2, $3)`,
      [rlsUserId, `stage-drain-rls-${rlsUserId}`, `stage-drain-rls-${rlsUserId}@example.invalid`],
    );
    await client.query(
      `INSERT INTO public.generation_jobs (id, user_id, job_type, status, generation_mode, credit_cost, params)
       VALUES ($1, $2, 'entity_generate', 'queued', 'standard', 0, '{}'::jsonb)`,
      [randomUUID(), rlsUserId],
    );
    const baseline = await client.query(DATABASE_DRAIN_PROOF_QUERY);
    await client.query('CREATE ROLE lyra_staging CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS');
    await client.query('ALTER DATABASE lyra_test OWNER TO lyra_staging');
    await client.query('GRANT USAGE ON SCHEMA public TO lyra_staging WITH GRANT OPTION');
    for (const relation of [
      'generation_jobs',
      'generation_quotes',
      'episode_export_jobs',
      'episode_export_job_outbox',
      'account_deletion_requests',
      'mobile_push_notification_deliveries',
      'mobile_push_notification_outbox',
      'mobile_push_tokens',
      'credit_ledger',
    ]) {
      await client.query(`GRANT SELECT ON TABLE public.${relation} TO lyra_staging WITH GRANT OPTION`);
    }
    await client.query('SAVEPOINT wrong_installer');
    await client.query(contract.passwordCommand.text, contract.passwordCommand.values);
    await assert.rejects(client.query(localize(contract.installSql)), /STAGE_DATABASE_DRAIN_INSTALLER_IDENTITY_INVALID/u);
    await client.query('ROLLBACK TO SAVEPOINT wrong_installer');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    const installerIdentity = await client.query('SELECT current_user, session_user');
    assert.deepEqual(installerIdentity.rows, [{ current_user: 'lyra_staging', session_user: 'lyra_staging' }]);
    await client.query(contract.passwordCommand.text, contract.passwordCommand.values);
    await client.query(localize(contract.installSql));
    const readMemberships = async () => (await client.query(`SELECT
        granted.rolname AS granted_role,
        member.rolname AS member_role,
        membership.grantor,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS granted ON granted.oid = roleid
      INNER JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      WHERE membership.member IN (
        pg_catalog.to_regrole('lyra_stage_drain_reader'),
        pg_catalog.to_regrole('lyra_stage_drain_owner')
      ) OR membership.roleid IN (
        pg_catalog.to_regrole('lyra_stage_drain_reader'),
        pg_catalog.to_regrole('lyra_stage_drain_owner')
      )
      ORDER BY granted.rolname`)).rows;
    assert.deepEqual(await readMemberships(), [
      { granted_role: 'lyra_stage_drain_owner', member_role: 'lyra_staging', grantor: 10, admin_option: true, inherit_option: false, set_option: false },
      { granted_role: 'lyra_stage_drain_reader', member_role: 'lyra_staging', grantor: 10, admin_option: true, inherit_option: false, set_option: false },
    ]);
    await client.query(localize(contract.verifySql));

    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_stage_drain_reader');
    const proof = await client.query(contract.functionQuery);
    assert.equal(proof.rows.length, 1);
    assert.ok(proof.rows[0].observed_at instanceof Date);
    assert.ok(proof.rows[0].observed_at >= baseline.rows[0].observed_at);
    assert.deepEqual(
      { ...proof.rows[0], observed_at: undefined },
      { ...baseline.rows[0], observed_at: undefined },
    );
    const privileges = await client.query(`SELECT
      pg_catalog.has_table_privilege(current_user, 'public.generation_jobs', 'SELECT') AS table_select,
      pg_catalog.has_function_privilege(current_user, 'lyra_stage_ops.collect_database_drain_counts()', 'EXECUTE') AS function_execute`);
    assert.deepEqual(privileges.rows, [{ table_select: false, function_execute: true }]);
    await client.query('SAVEPOINT denied_table_read');
    await assert.rejects(client.query('SELECT id FROM public.generation_jobs LIMIT 1'), /permission denied/u);
    await client.query('ROLLBACK TO SAVEPOINT denied_table_read');
    await client.query('RESET SESSION AUTHORIZATION');

    await client.query('ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY');
    await client.query(`CREATE POLICY lyra_stage_drain_hide_queued
      ON public.generation_jobs
      FOR SELECT
      TO lyra_stage_drain_owner
      USING (status <> 'queued')`);
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_stage_drain_reader');
    await client.query('SAVEPOINT hidden_active_row');
    await assert.rejects(
      client.query(contract.functionQuery),
      /query would be affected by row-level security policy/u,
    );
    await client.query('ROLLBACK TO SAVEPOINT hidden_active_row');
    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('DROP POLICY lyra_stage_drain_hide_queued ON public.generation_jobs');
    await client.query('ALTER TABLE public.generation_jobs DISABLE ROW LEVEL SECURITY');

    const assertAuditRejects = async (mutation, expected) => {
      await client.query('SAVEPOINT invalid_privilege');
      await client.query(mutation);
      await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
      await assert.rejects(client.query(localize(contract.verifySql)), expected);
      await client.query('ROLLBACK TO SAVEPOINT invalid_privilege');
    };
    const assertStageAuditRejects = async (mutation, expected) => {
      await client.query('SAVEPOINT invalid_stage_grant');
      await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
      await client.query(mutation);
      await assert.rejects(client.query(localize(contract.verifySql)), expected);
      await client.query('ROLLBACK TO SAVEPOINT invalid_stage_grant');
    };
    await assertAuditRejects(
      'GRANT SELECT (id) ON TABLE public.generation_jobs TO lyra_stage_drain_reader',
      /STAGE_DATABASE_DRAIN_READER_TABLE_PRIVILEGE_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT lyra_stage_drain_owner TO lyra_stage_drain_reader',
      /STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT lyra_stage_drain_owner TO lyra_staging WITH SET TRUE, INHERIT FALSE',
      /STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT lyra_stage_drain_reader TO lyra_staging WITH INHERIT TRUE, SET FALSE',
      /STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID/u,
    );
    await assertAuditRejects(
      'CREATE ROLE lyra_stage_drain_extra NOLOGIN; GRANT lyra_stage_drain_owner TO lyra_stage_drain_extra',
      /STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID/u,
    );
    await assertStageAuditRejects(
      'GRANT lyra_stage_drain_owner TO lyra_staging WITH SET TRUE, INHERIT FALSE',
      /STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT CREATE ON SCHEMA public TO lyra_stage_drain_reader',
      /STAGE_DATABASE_DRAIN_SCHEMA_CREATE_INVALID/u,
    );
    await assertAuditRejects(
      `CREATE FUNCTION public.lyra_stage_unexpected_security_definer()
       RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
      /STAGE_DATABASE_DRAIN_OTHER_SECURITY_DEFINER_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT SELECT (title) ON TABLE public.works TO lyra_stage_drain_owner',
      /STAGE_DATABASE_DRAIN_OWNER_COLUMN_PRIVILEGE_INVALID/u,
    );
    await assertAuditRejects(
      'GRANT DELETE ON TABLE public.works TO lyra_stage_drain_owner',
      /STAGE_DATABASE_DRAIN_OWNER_RELATION_PRIVILEGE_INVALID/u,
    );
    await assertAuditRejects(
      'ALTER FUNCTION lyra_stage_ops.collect_database_drain_counts() IMMUTABLE',
      /STAGE_DATABASE_DRAIN_FUNCTION_INVALID/u,
    );
    await assertAuditRejects(
      `CREATE OR REPLACE FUNCTION lyra_stage_ops.collect_database_drain_counts()
       RETURNS TABLE (
         observed_at timestamp with time zone, active_generation_jobs text,
         pending_generation_dispatches text, active_episode_export_jobs text,
         pending_episode_export_outbox text, active_account_deletion_requests text,
         pending_push_deliveries text, pending_credit_refunds text
       ) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
       AS $tampered$SELECT clock_timestamp(), '0'::text, '0'::text, '0'::text, '0'::text, '0'::text, '0'::text, '0'::text$tampered$`,
      /STAGE_DATABASE_DRAIN_FUNCTION_INVALID/u,
    );

    // RDS 18.3 CREATEROLE creates the owner and reader without self-membership.
    // The controller removes the local automatic memberships; the non-super installer must still verify zero rows.
    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('REVOKE lyra_stage_drain_owner FROM lyra_staging');
    await client.query('REVOKE lyra_stage_drain_reader FROM lyra_staging');
    assert.deepEqual(await readMemberships(), []);
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(localize(contract.verifySql));
    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('GRANT lyra_stage_drain_owner TO lyra_staging WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
    await client.query('GRANT lyra_stage_drain_reader TO lyra_staging WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
    assert.deepEqual(await readMemberships(), [
      { granted_role: 'lyra_stage_drain_owner', member_role: 'lyra_staging', grantor: 10, admin_option: true, inherit_option: false, set_option: false },
      { granted_role: 'lyra_stage_drain_reader', member_role: 'lyra_staging', grantor: 10, admin_option: true, inherit_option: false, set_option: false },
    ]);

    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(localize(contract.teardownSql));
    const remnants = await client.query(`SELECT
      pg_catalog.to_regnamespace('lyra_stage_ops') IS NOT NULL AS schema_exists,
      pg_catalog.to_regrole('lyra_stage_drain_reader') IS NOT NULL AS reader_exists,
      pg_catalog.to_regrole('lyra_stage_drain_owner') IS NOT NULL AS owner_exists`);
    assert.deepEqual(remnants.rows, [{ schema_exists: false, reader_exists: false, owner_exists: false }]);
    await client.query('RESET SESSION AUTHORIZATION');
    await client.query('ALTER ROLE lyra_staging SUPERUSER');
    await client.query('SET LOCAL SESSION AUTHORIZATION lyra_staging');
    await client.query(contract.passwordCommand.text, contract.passwordCommand.values);
    await client.query(localize(contract.installSql));
    assert.deepEqual(await readMemberships(), []);
    await client.query(localize(contract.verifySql));
    await client.query(localize(contract.teardownSql));

    await client.query('SAVEPOINT conflicting_role');
    await client.query('CREATE ROLE lyra_stage_drain_reader NOLOGIN');
    await assert.rejects(
      client.query(localize(contract.teardownSql)),
      /STAGE_DATABASE_DRAIN_CONTRACT_INCOMPLETE/u,
    );
    await client.query('ROLLBACK TO SAVEPOINT conflicting_role');
    await client.query('RESET SESSION AUTHORIZATION');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
