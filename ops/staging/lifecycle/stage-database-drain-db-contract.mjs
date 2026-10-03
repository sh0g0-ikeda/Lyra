import { DATABASE_DRAIN_PROOF_QUERY } from './stage-database-drain-proof.mjs';

const DATABASE_NAME = 'lyrastaging';
const READER_ROLE = 'lyra_stage_drain_reader';
const OWNER_ROLE = 'lyra_stage_drain_owner';
const STAGE_INSTALLER_ROLE = 'lyra_staging';
const OPS_SCHEMA = 'lyra_stage_ops';
const FUNCTION_NAME = 'collect_database_drain_counts';
const FUNCTION_SIGNATURE = `${OPS_SCHEMA}.${FUNCTION_NAME}()`;
const PASSWORD_SETTING = 'lyra.stage_drain_reader_password';
const READER_VALID_UNTIL = '2026-10-09T16:20:00Z';

const RELATION_COLUMNS = Object.freeze({
  generation_jobs: Object.freeze(['id', 'status', 'commit_started_at', 'credit_cost', 'organization_id', 'user_id']),
  generation_quotes: Object.freeze(['dispatch_state']),
  episode_export_jobs: Object.freeze(['id', 'status']),
  episode_export_job_outbox: Object.freeze(['export_job_id', 'dispatched_at']),
  account_deletion_requests: Object.freeze(['status']),
  mobile_push_notification_deliveries: Object.freeze(['id', 'status', 'outbox_id', 'push_token_id']),
  mobile_push_notification_outbox: Object.freeze(['id', 'user_id', 'created_at']),
  mobile_push_tokens: Object.freeze(['id', 'user_id', 'created_at']),
  credit_ledger: Object.freeze(['id', 'type', 'monthly_delta', 'purchased_delta', 'amount', 'job_id', 'organization_id', 'user_id']),
});

export const STAGE_DATABASE_DRAIN_QUALIFIED_QUERY = qualifyApplicationRelations(DATABASE_DRAIN_PROOF_QUERY);
const FUNCTION_BODY = `\n${STAGE_DATABASE_DRAIN_QUALIFIED_QUERY}\n`;

const OWNER_COLUMN_GRANTS = Object.entries(RELATION_COLUMNS)
  .map(([relation, columns]) => `GRANT SELECT (${columns.join(', ')}) ON TABLE public.${relation} TO ${OWNER_ROLE};`)
  .join('\n');

const OWNER_COLUMN_REVOKES = Object.entries(RELATION_COLUMNS)
  .map(([relation, columns]) => `REVOKE SELECT (${columns.join(', ')}) ON TABLE public.${relation} FROM ${OWNER_ROLE};`)
  .join('\n');

const EXPECTED_OWNER_COLUMNS = Object.entries(RELATION_COLUMNS)
  .flatMap(([relation, columns]) => columns.map((column) => `('public', '${relation}', '${column}')`))
  .join(',\n      ');

const ROLE_MEMBERSHIP_VALIDATION = `
  SELECT COUNT(*) INTO role_membership_count
  FROM pg_catalog.pg_auth_members
  WHERE member IN (reader_oid, owner_oid) OR roleid IN (reader_oid, owner_oid);
  IF installer_oid IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid = 10 AND rolsuper)
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members
       WHERE (member IN (reader_oid, owner_oid) OR roleid IN (reader_oid, owner_oid))
         AND NOT (
           roleid IN (reader_oid, owner_oid)
           AND member = installer_oid
           AND grantor = 10
           AND admin_option
           AND NOT inherit_option
           AND NOT set_option
         )
     )
     OR role_membership_count NOT IN (0, 2)
     OR (installer_is_superuser AND role_membership_count <> 0)
     OR (
       role_membership_count = 2
       AND (
         NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_auth_members
           WHERE roleid = owner_oid AND member = installer_oid AND grantor = 10
             AND admin_option AND NOT inherit_option AND NOT set_option
         )
         OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_auth_members
           WHERE roleid = reader_oid AND member = installer_oid AND grantor = 10
             AND admin_option AND NOT inherit_option AND NOT set_option
         )
       )
     ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_ROLE_MEMBERSHIP_INVALID';
  END IF;`;

const INSTALL_SQL = `DO $install$
DECLARE
  reader_password text;
BEGIN
  IF pg_catalog.current_database() <> '${DATABASE_NAME}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_DATABASE_MISMATCH';
  END IF;
  IF current_user <> '${STAGE_INSTALLER_ROLE}' OR session_user <> '${STAGE_INSTALLER_ROLE}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_INSTALLER_IDENTITY_INVALID';
  END IF;
  IF pg_catalog.to_regrole('${OWNER_ROLE}') IS NOT NULL
     OR pg_catalog.to_regrole('${READER_ROLE}') IS NOT NULL
     OR pg_catalog.to_regnamespace('${OPS_SCHEMA}') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_CONTRACT_CONFLICT';
  END IF;
  reader_password := pg_catalog.current_setting('${PASSWORD_SETTING}', true);
  IF reader_password IS NULL OR reader_password !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_PASSWORD_INVALID';
  END IF;
  EXECUTE 'CREATE ROLE ${OWNER_ROLE} WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  EXECUTE pg_catalog.format(
    'CREATE ROLE ${READER_ROLE} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L',
    reader_password,
    '${READER_VALID_UNTIL}'
  );
  EXECUTE 'GRANT ${OWNER_ROLE} TO ${STAGE_INSTALLER_ROLE} WITH SET TRUE, INHERIT FALSE';
  PERFORM pg_catalog.set_config('${PASSWORD_SETTING}', '', true);
  reader_password := NULL;
END
$install$ LANGUAGE plpgsql;

CREATE SCHEMA ${OPS_SCHEMA} AUTHORIZATION ${OWNER_ROLE};
GRANT USAGE ON SCHEMA public TO ${OWNER_ROLE};
${OWNER_COLUMN_GRANTS}
GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${READER_ROLE};

SET LOCAL ROLE ${OWNER_ROLE};
CREATE FUNCTION ${FUNCTION_SIGNATURE}
RETURNS TABLE (
  observed_at timestamp with time zone,
  active_generation_jobs text,
  pending_generation_dispatches text,
  active_episode_export_jobs text,
  pending_episode_export_outbox text,
  active_account_deletion_requests text,
  pending_push_deliveries text,
  pending_credit_refunds text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$${FUNCTION_BODY}$function$;
REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${OPS_SCHEMA} TO ${READER_ROLE};
GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO ${READER_ROLE};
RESET ROLE;
DO $remove_install_membership$
DECLARE
  reader_oid oid := pg_catalog.to_regrole('${READER_ROLE}');
  owner_oid oid := pg_catalog.to_regrole('${OWNER_ROLE}');
  installer_oid oid := pg_catalog.to_regrole('${STAGE_INSTALLER_ROLE}');
  installer_is_superuser boolean := COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE oid = installer_oid), false);
  role_membership_count bigint;
BEGIN
  EXECUTE 'REVOKE ${OWNER_ROLE} FROM ${STAGE_INSTALLER_ROLE}';
${ROLE_MEMBERSHIP_VALIDATION}
END
$remove_install_membership$ LANGUAGE plpgsql;`;

const VERIFY_SQL = `DO $verify$
DECLARE
  reader_oid oid := pg_catalog.to_regrole('${READER_ROLE}');
  owner_oid oid := pg_catalog.to_regrole('${OWNER_ROLE}');
  installer_oid oid := pg_catalog.to_regrole('${STAGE_INSTALLER_ROLE}');
  installer_is_superuser boolean := COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE oid = installer_oid), false);
  role_membership_count bigint;
  schema_oid oid := pg_catalog.to_regnamespace('${OPS_SCHEMA}');
  function_oid oid := (
    SELECT p.oid
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = '${OPS_SCHEMA}'
      AND p.proname = '${FUNCTION_NAME}'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  );
BEGIN
  IF pg_catalog.current_database() <> '${DATABASE_NAME}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_DATABASE_MISMATCH';
  END IF;
  IF current_user <> '${STAGE_INSTALLER_ROLE}' OR session_user <> '${STAGE_INSTALLER_ROLE}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_INSTALLER_IDENTITY_INVALID';
  END IF;
  IF reader_oid IS NULL OR owner_oid IS NULL OR schema_oid IS NULL OR function_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_CONTRACT_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = reader_oid
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
      AND rolconnlimit = 1
      AND rolvaliduntil = '${READER_VALID_UNTIL}'::timestamptz
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = owner_oid
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_ROLE_ATTRIBUTES_INVALID';
  END IF;
${ROLE_MEMBERSHIP_VALIDATION}
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = schema_oid) <> owner_oid
     OR NOT pg_catalog.has_schema_privilege(reader_oid, schema_oid, 'USAGE')
     OR pg_catalog.has_schema_privilege(reader_oid, schema_oid, 'CREATE') THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_SCHEMA_PRIVILEGE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> '${OPS_SCHEMA}'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND pg_catalog.has_schema_privilege(reader_oid, n.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_SCHEMA_CREATE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> '${OPS_SCHEMA}'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND pg_catalog.has_schema_privilege(owner_oid, n.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_OWNER_SCHEMA_CREATE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND (
        pg_catalog.has_table_privilege(reader_oid, c.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'INSERT')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'DELETE')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege(reader_oid, c.oid, 'TRIGGER')
        OR pg_catalog.has_any_column_privilege(reader_oid, c.oid, 'SELECT')
        OR pg_catalog.has_any_column_privilege(reader_oid, c.oid, 'INSERT')
        OR pg_catalog.has_any_column_privilege(reader_oid, c.oid, 'UPDATE')
        OR pg_catalog.has_any_column_privilege(reader_oid, c.oid, 'REFERENCES')
      )
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_READER_TABLE_PRIVILEGE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND (
        pg_catalog.has_sequence_privilege(reader_oid, c.oid, 'USAGE')
        OR pg_catalog.has_sequence_privilege(reader_oid, c.oid, 'SELECT')
        OR pg_catalog.has_sequence_privilege(reader_oid, c.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_READER_SEQUENCE_PRIVILEGE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND p.oid <> function_oid
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND pg_catalog.has_function_privilege(reader_oid, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_OTHER_SECURITY_DEFINER_INVALID';
  END IF;
  IF NOT pg_catalog.has_database_privilege(reader_oid, pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_function_privilege(reader_oid, function_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc p,
            LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
       WHERE p.oid = function_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_EXECUTE_PRIVILEGE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = function_oid
      AND proowner = owner_oid
      AND prosecdef
      AND pronargs = 0
      AND prokind = 'f'
      AND provolatile = 'v'
      AND prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'row_security=off']::text[]
      AND prosrc = ${sqlLiteral(FUNCTION_BODY)}
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_FUNCTION_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND (
        pg_catalog.has_table_privilege(owner_oid, c.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'INSERT')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'DELETE')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege(owner_oid, c.oid, 'TRIGGER')
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND (
        pg_catalog.has_sequence_privilege(owner_oid, c.oid, 'USAGE')
        OR pg_catalog.has_sequence_privilege(owner_oid, c.oid, 'SELECT')
        OR pg_catalog.has_sequence_privilege(owner_oid, c.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_OWNER_RELATION_PRIVILEGE_INVALID';
  END IF;
  IF EXISTS (
    WITH expected(table_schema, table_name, column_name) AS (
      VALUES ${EXPECTED_OWNER_COLUMNS}
    )
    SELECT 1 FROM expected
    WHERE NOT pg_catalog.has_column_privilege(
      owner_oid,
      pg_catalog.format('%I.%I', table_schema, table_name),
      column_name,
      'SELECT'
    )
  ) OR EXISTS (
    WITH expected(table_schema, table_name, column_name) AS (
      VALUES ${EXPECTED_OWNER_COLUMNS}
    )
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND (
        pg_catalog.has_column_privilege(owner_oid, c.oid, a.attnum, 'INSERT')
        OR pg_catalog.has_column_privilege(owner_oid, c.oid, a.attnum, 'UPDATE')
        OR pg_catalog.has_column_privilege(owner_oid, c.oid, a.attnum, 'REFERENCES')
        OR (
          pg_catalog.has_column_privilege(owner_oid, c.oid, a.attnum, 'SELECT')
          AND NOT EXISTS (
            SELECT 1 FROM expected
            WHERE table_schema = n.nspname AND table_name = c.relname AND column_name = a.attname
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_OWNER_COLUMN_PRIVILEGE_INVALID';
  END IF;
END
$verify$ LANGUAGE plpgsql;`;

const TEARDOWN_SQL = `DO $teardown$
DECLARE
  reader_oid oid := pg_catalog.to_regrole('${READER_ROLE}');
  owner_oid oid := pg_catalog.to_regrole('${OWNER_ROLE}');
  installer_oid oid := pg_catalog.to_regrole('${STAGE_INSTALLER_ROLE}');
  installer_is_superuser boolean := COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE oid = installer_oid), false);
  role_membership_count bigint;
  schema_oid oid := pg_catalog.to_regnamespace('${OPS_SCHEMA}');
  function_oid oid := (
    SELECT p.oid
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = '${OPS_SCHEMA}'
      AND p.proname = '${FUNCTION_NAME}'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  );
BEGIN
  IF pg_catalog.current_database() <> '${DATABASE_NAME}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_DATABASE_MISMATCH';
  END IF;
  IF current_user <> '${STAGE_INSTALLER_ROLE}' OR session_user <> '${STAGE_INSTALLER_ROLE}' THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_INSTALLER_IDENTITY_INVALID';
  END IF;
  IF schema_oid IS NULL AND function_oid IS NULL AND reader_oid IS NULL AND owner_oid IS NULL THEN
    RETURN;
  END IF;
  IF schema_oid IS NULL OR function_oid IS NULL OR reader_oid IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_CONTRACT_INCOMPLETE';
  END IF;
  IF schema_oid IS NOT NULL AND (owner_oid IS NULL OR (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = schema_oid) <> owner_oid) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_SCHEMA_OWNER_INVALID';
  END IF;
  IF function_oid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = function_oid
      AND proowner = owner_oid
      AND prosecdef
      AND pronargs = 0
      AND prokind = 'f'
      AND provolatile = 'v'
      AND prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'row_security=off']::text[]
      AND prosrc = ${sqlLiteral(FUNCTION_BODY)}
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_FUNCTION_OWNER_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = reader_oid
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
      AND rolconnlimit = 1
      AND rolvaliduntil = '${READER_VALID_UNTIL}'::timestamptz
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = owner_oid
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'STAGE_DATABASE_DRAIN_ROLE_IDENTITY_INVALID';
  END IF;
${ROLE_MEMBERSHIP_VALIDATION}
END
$teardown$ LANGUAGE plpgsql;

DO $grant_teardown_membership$
BEGIN
  EXECUTE 'GRANT ${OWNER_ROLE} TO ${STAGE_INSTALLER_ROLE} WITH SET TRUE, INHERIT FALSE';
END
$grant_teardown_membership$ LANGUAGE plpgsql;
SET LOCAL ROLE ${OWNER_ROLE};
DROP FUNCTION ${FUNCTION_SIGNATURE};
DROP SCHEMA ${OPS_SCHEMA};
RESET ROLE;
DO $remove_teardown_membership$
BEGIN
  EXECUTE 'REVOKE ${OWNER_ROLE} FROM ${STAGE_INSTALLER_ROLE}';
END
$remove_teardown_membership$ LANGUAGE plpgsql;

REVOKE CONNECT ON DATABASE ${DATABASE_NAME} FROM ${READER_ROLE};
REVOKE USAGE ON SCHEMA public FROM ${OWNER_ROLE};
${OWNER_COLUMN_REVOKES}
DROP ROLE ${READER_ROLE};
DROP ROLE ${OWNER_ROLE};`;

export function buildStageDatabaseDrainDbContract(password) {
  if (typeof password !== 'string' || !/^[0-9a-f]{64}$/u.test(password)) {
    throw new Error('STAGE_DATABASE_DRAIN_PASSWORD_INVALID');
  }
  return Object.freeze({
    passwordCommand: Object.freeze({
      text: `SELECT pg_catalog.set_config('${PASSWORD_SETTING}', $1, true)`,
      values: Object.freeze([password]),
    }),
    installSql: INSTALL_SQL,
    verifySql: VERIFY_SQL,
    teardownSql: TEARDOWN_SQL,
    functionQuery: `SELECT * FROM ${FUNCTION_SIGNATURE}`,
  });
}

function qualifyApplicationRelations(query) {
  let qualified = query;
  for (const relation of Object.keys(RELATION_COLUMNS)) {
    const pattern = new RegExp(`\\b(FROM|JOIN)\\s+${relation}\\b`, 'gu');
    if (!pattern.test(qualified)) throw new Error(`STAGE_DATABASE_DRAIN_QUERY_RELATION_MISSING:${relation}`);
    qualified = qualified.replace(pattern, `$1 public.${relation}`);
  }
  if (qualified.replaceAll('public.', '') !== query) {
    throw new Error('STAGE_DATABASE_DRAIN_QUERY_QUALIFICATION_INVALID');
  }
  return qualified;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
