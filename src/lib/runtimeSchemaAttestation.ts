import { ConfigurationError } from '../domain/errors/index.js';
import type { TransactionRunner } from './db.js';

export const CANONICAL_RUNTIME_MIGRATIONS = [
  '001_initial_schema.sql',
  '002_add_episode_story_input_mode.sql',
  '003_add_generation_active_resource_locks.sql',
  '004_add_rate_limit_buckets.sql',
  '005_add_billing_idempotency_indexes.sql',
  '006_add_generation_job_retention_index.sql',
  '007_add_credit_refund_job_idempotency_index.sql',
  '008_add_credit_ledger_bucket_deltas.sql',
  '009_add_generation_job_state_constraints.sql',
  '010_add_billing_state_constraints.sql',
  '011_add_core_app_state_constraints.sql',
  '012_add_credit_ledger_amount_sign_constraint.sql',
  '013_add_subscription_status_constraint.sql',
  '014_add_payment_record_external_id_constraint.sql',
  '015_add_episode_story_autofill_job_type.sql',
  '016_add_episode_story_autofill_active_lock.sql',
  '017_add_episode_page_skeleton_job_type.sql',
  '018_allow_enterprise_billing_plan_codes.sql',
  '019_add_organization_workspaces.sql',
  '020_add_payment_record_invoice_url.sql',
  '021_add_organization_workspace_indexes.sql',
  '022_add_organization_invitation_delivery.sql',
  '023_merge_creator_role_into_editor.sql',
  '024_add_generation_job_cancellation.sql',
  '025_include_cancelled_jobs_in_retention_index.sql',
  '026_backfill_legacy_credit_consume_job_links.sql',
  '027_add_account_deletion_requests.sql',
  '028_preserve_page_story_metadata_in_layout_config.sql',
  '029_add_mobile_store_purchase_ledger.sql',
  '030_add_generation_job_management.sql',
  '031_add_entity_reference_upload_tokens.sql',
  '032_add_episode_export_jobs.sql',
  '033_add_mobile_push_token_registry.sql',
  '034_add_mobile_push_notification_outbox.sql',
  '035_add_generation_cancellation_contract.sql',
  '036_add_episode_export_processing_lease.sql',
  '037_connect_account_deletion.sql',
  '038_connect_generation_job_cancellation.sql',
  '039_connect_generation_terminal_push_outbox.sql',
  '040_add_entity_state_variants.sql',
  '041_add_episode_starting_entity_states.sql',
  '042_add_generation_quotes.sql',
  '043_add_quoted_import_analysis_jobs.sql',
  '044_add_google_identity_link_challenges.sql',
  '045_add_mobile_subscription_scheduled_plan_compatibility.sql',
  '046_bridge_production_schema_lineage.sql',
  '047_add_state_reference_copy_attempts.sql',
] as const;

export interface RuntimeSchemaCatalog {
  migrationFilenames: string[];
  relations: Array<{ name: string; kind: string }>;
  namespaceArtifacts: Array<{ kind: string; name: string }>;
  columns: Array<{ relation: string; name: string; type: string; nullable: boolean }>;
  constraints: Array<{ relation: string; name: string; type: string; validated: boolean; definitionSha256: string }>;
  indexes: Array<{ relation: string; name: string; unique: boolean; valid: boolean; definitionSha256: string }>;
  triggers: Array<{ relation: string; name: string; functionName: string; enabled: string; definitionSha256: string }>;
}

export type RuntimeSchemaDescriptor = 'empty_fresh' | 'canonical_046_pending_047' | 'canonical_fresh_v1' | 'unsupported';

export interface RuntimeSchemaDescription {
  kind: RuntimeSchemaDescriptor;
  failures: string[];
}

const CANONICAL_046_MIGRATIONS = CANONICAL_RUNTIME_MIGRATIONS.slice(0, -1);
const EMPTY_RELATIONS = new Set(['schema_migrations', 'schema_migration_locks']);
const FORBIDDEN_RELATIONS = new Set(['export_jobs', 'export_job_outbox']);
const FORBIDDEN_PAGE_METADATA_COLUMNS = new Set([
  'story_source_scene_ids',
  'story_page_purpose',
  'story_continuity_note',
]);
const FORBIDDEN_TRIGGERS = new Set([
  'generation_jobs_enqueue_mobile_push_notification',
  'generation_job_late_consume_refund',
]);

const REQUIRED_RELATIONS = [
  'schema_migrations',
  'users',
  'works',
  'entities',
  'pages',
  'episodes',
  'entity_states',
  'generation_jobs',
  'credit_ledger',
  'account_deletion_requests',
  'episode_export_jobs',
  'episode_export_job_outbox',
  'mobile_store_purchases',
  'mobile_push_notification_outbox',
] as const;

const REQUIRED_COLUMNS: ReadonlyArray<readonly [string, string, string]> = [
  ['pages', 'layout_config', 'jsonb'],
  ['generation_jobs', 'status', 'text'],
  ['generation_jobs', 'cancel_requested_at', 'timestamp with time zone'],
  ['generation_jobs', 'cancel_requested_by', 'uuid'],
  ['generation_jobs', 'cancelled_at', 'timestamp with time zone'],
  ['generation_jobs', 'commit_started_at', 'timestamp with time zone'],
  ['entity_states', 'name', 'text'],
  ['entity_states', 'description', 'text'],
  ['entity_states', 'reference_image', 'jsonb'],
  ['episodes', 'starting_entity_states', 'jsonb'],
  ['episode_export_jobs', 'status', 'text'],
  ['episode_export_job_outbox', 'export_job_id', 'uuid'],
  ['users', 'account_deletion_started_at', 'timestamp with time zone'],
  ['users', 'account_deleted_at', 'timestamp with time zone'],
  ['account_deletion_requests', 'identity_key', 'text'],
  ['mobile_push_notification_outbox', 'generation_retry_count', 'integer'],
];

export const CANONICAL_RUNTIME_SCHEMA_SIGNATURES = {
  constraints: {
    generation_jobs_status_check: '2f61d9914cb9e98f0a14d31435d8ef48d61b8d7283972487bbfbcfd36b0bc613',
    generation_jobs_cancellation_state_check: 'c0768e5dcd1bfed0c89ded8b878edcf0c8e0bc05751ea95cd3b484c1cc260790',
    entity_states_variant_name_description_check: '042fd2455717b621a78a2166f6cfcdc74da0dd51eaf1e94c6e8fb6f1f0665810',
    entity_states_reference_image_object_check: 'e1c7aef1139f5b25b0aff243ef482e7bf63d89aa9ef883ab3be3faa2cda016ff',
    episodes_starting_entity_states_shape_check: '3c38db758cdd26aac267753477a17c882bdefaaa03c381636abe466a0d7689a3',
    mobile_push_notification_outbox_event_unique: 'c0f86b03588a2d038290bf427e49c90a3268b9f60fc32b64c6a8d47151e118fe',
    account_deletion_requests_identity_key_shape_check: 'db41328dfb89c4d815428161eabbf8524663bfaad08ae865bc08adf7b9a5adec',
    mobile_store_purchases_scheduled_plan_check: 'b01e3cfe9f8cf0ed7a2e5eaad051b35783c2b8ab0b2a9140e161344cc9c2640d',
    state_copy_v2_scope_shape: '9c24b61d08dc626a0326337ff1fcafc15c9fca44250a244ed9aac148781551fd',
  },
  indexes: {
    idx_episode_export_jobs_idempotency_scope: '8f504f41cb6301e31b6afe67b376407214a4676243db979d0f8a060e40cc6412',
    idx_episode_export_jobs_active_duplicate: '500ced5538fe045184471944b6f3517835d5edc057852b2150143292251cdb52',
    idx_account_deletion_requests_identity_key: '35c8f3b2906198725f61535d4bb785f4fcda871fd153f9c679657572813ac94d',
    state_copy_v2_active_candidate: 'be66e4aaf8d801248377bcc57be9cb2d1c0061b265f22b000b311dbfa4147295',
  },
  triggers: {
    works_account_deletion_write_guard: '6716c71a49d9150aa55e9df1e7bb87182327eff8a6112c42d0617b6b22453c43',
    entities_account_deletion_write_guard: 'a5abd955172044779efa5412027e453290eadadaf4c59ef8484071330030be34',
    generation_jobs_account_deletion_write_guard: '9afbbb9a3a44adcc410a4d462a99b7dfe8c1fa021f76848aac0c4652817d9b44',
    generation_job_credit_consume_guard: 'ae6114198db073c07520476af410d46ee4c0fa2ef9006a85c4eb90e623811acd',
    state_copy_v2_guard: 'db700e2e6a1591db0d6f70bbe2aedb5ad471b01eab6f569fb1a8ddafe5c8d6e2',
  },
} as const;

const REQUIRED_CONSTRAINTS: ReadonlyArray<readonly [string, string, string, boolean, string]> = [
  ['generation_jobs', 'generation_jobs_status_check', 'c', true, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.generation_jobs_status_check],
  ['generation_jobs', 'generation_jobs_cancellation_state_check', 'c', false, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.generation_jobs_cancellation_state_check],
  ['entity_states', 'entity_states_variant_name_description_check', 'c', false, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.entity_states_variant_name_description_check],
  ['entity_states', 'entity_states_reference_image_object_check', 'c', false, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.entity_states_reference_image_object_check],
  ['episodes', 'episodes_starting_entity_states_shape_check', 'c', false, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.episodes_starting_entity_states_shape_check],
  ['mobile_push_notification_outbox', 'mobile_push_notification_outbox_event_unique', 'u', true, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.mobile_push_notification_outbox_event_unique],
  ['account_deletion_requests', 'account_deletion_requests_identity_key_shape_check', 'c', true, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.account_deletion_requests_identity_key_shape_check],
  ['mobile_store_purchases', 'mobile_store_purchases_scheduled_plan_check', 'c', true, CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.mobile_store_purchases_scheduled_plan_check],
];

const REQUIRED_INDEXES: ReadonlyArray<readonly [string, string, string]> = [
  ['episode_export_jobs', 'idx_episode_export_jobs_idempotency_scope', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.indexes.idx_episode_export_jobs_idempotency_scope],
  ['episode_export_jobs', 'idx_episode_export_jobs_active_duplicate', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.indexes.idx_episode_export_jobs_active_duplicate],
  ['account_deletion_requests', 'idx_account_deletion_requests_identity_key', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.indexes.idx_account_deletion_requests_identity_key],
];

const REQUIRED_TRIGGERS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['works', 'works_account_deletion_write_guard', 'reject_write_after_account_deletion', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers.works_account_deletion_write_guard],
  ['entities', 'entities_account_deletion_write_guard', 'reject_write_after_account_deletion', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers.entities_account_deletion_write_guard],
  ['generation_jobs', 'generation_jobs_account_deletion_write_guard', 'reject_write_after_account_deletion', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers.generation_jobs_account_deletion_write_guard],
  ['credit_ledger', 'generation_job_credit_consume_guard', 'guard_generation_job_credit_consume', CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers.generation_job_credit_consume_guard],
];

export function describeRuntimeSchema(catalog: RuntimeSchemaCatalog): RuntimeSchemaDescription {
  if (
    catalog.migrationFilenames.length === 0
    && catalog.relations.every(({ name, kind }) => EMPTY_RELATIONS.has(name) && kind === 'r')
    && catalog.namespaceArtifacts.length === 0
  ) {
    return { kind: 'empty_fresh', failures: [] };
  }

  const historyKind = sameStrings(catalog.migrationFilenames, CANONICAL_RUNTIME_MIGRATIONS)
    ? 'canonical_fresh_v1'
    : sameStrings(catalog.migrationFilenames, CANONICAL_046_MIGRATIONS)
      ? 'canonical_046_pending_047'
      : null;
  if (historyKind === null) {
    return { kind: 'unsupported', failures: ['MIGRATION_HISTORY_MISMATCH'] };
  }

  const failures = validateCanonicalCatalog(catalog, historyKind === 'canonical_fresh_v1');
  return failures.length === 0
    ? { kind: historyKind, failures: [] }
    : { kind: 'unsupported', failures };
}

export async function readRuntimeSchemaCatalog(database: TransactionRunner): Promise<RuntimeSchemaCatalog> {
  return database.transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    const relations = await client.query<{ name: string; kind: string }>(`
      SELECT relation.relname AS name, relation.relkind AS kind
      FROM pg_class relation
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = CURRENT_SCHEMA()
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      ORDER BY relation.relname
    `);
    const columns = await client.query<{
      relation: string;
      name: string;
      type: string;
      nullable: boolean;
    }>(`
      SELECT table_name AS relation, column_name AS name,
        CASE WHEN data_type = 'ARRAY' THEN udt_name ELSE data_type END AS type,
        is_nullable = 'YES' AS nullable
      FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA()
      ORDER BY table_name, ordinal_position
    `);
    const constraints = await client.query<{
      relation: string;
      name: string;
      type: string;
      validated: boolean;
      definitionSha256: string;
    }>(`
      SELECT relation.relname AS relation, schema_constraint.conname AS name,
        schema_constraint.contype AS type, schema_constraint.convalidated AS validated,
        encode(sha256(convert_to(pg_get_constraintdef(schema_constraint.oid, true), 'UTF8')), 'hex') AS "definitionSha256"
      FROM pg_constraint schema_constraint
      INNER JOIN pg_class relation ON relation.oid = schema_constraint.conrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = CURRENT_SCHEMA()
      ORDER BY relation.relname, schema_constraint.conname
    `);
    const indexes = await client.query<{
      relation: string;
      name: string;
      unique: boolean;
      valid: boolean;
      definitionSha256: string;
    }>(`
      SELECT relation.relname AS relation, index_relation.relname AS name,
        schema_index.indisunique AS unique, (schema_index.indisvalid AND schema_index.indisready) AS valid,
        encode(sha256(convert_to(jsonb_build_array(
          ARRAY(SELECT pg_get_indexdef(schema_index.indexrelid, position, true)
            FROM generate_series(1, schema_index.indnkeyatts) position ORDER BY position),
          COALESCE(pg_get_expr(schema_index.indpred, schema_index.indrelid, true), '')
        )::text, 'UTF8')), 'hex') AS "definitionSha256"
      FROM pg_index schema_index
      INNER JOIN pg_class relation ON relation.oid = schema_index.indrelid
      INNER JOIN pg_class index_relation ON index_relation.oid = schema_index.indexrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = CURRENT_SCHEMA()
      ORDER BY relation.relname, index_relation.relname
    `);
    const triggers = await client.query<{
      relation: string;
      name: string;
      functionName: string;
      enabled: string;
      definitionSha256: string;
    }>(`
      SELECT relation.relname AS relation, schema_trigger.tgname AS name,
        procedure.proname AS "functionName", schema_trigger.tgenabled AS enabled,
        encode(sha256(convert_to(pg_get_triggerdef(schema_trigger.oid, true), 'UTF8')), 'hex') AS "definitionSha256"
      FROM pg_trigger schema_trigger
      INNER JOIN pg_class relation ON relation.oid = schema_trigger.tgrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      INNER JOIN pg_proc procedure ON procedure.oid = schema_trigger.tgfoid
      WHERE namespace.nspname = CURRENT_SCHEMA() AND NOT schema_trigger.tgisinternal
      ORDER BY relation.relname, schema_trigger.tgname
    `);
    const namespaceArtifacts = await client.query<{ kind: string; name: string }>(`
      SELECT artifact.kind, artifact.name
      FROM (
        SELECT 'function'::text AS kind,
          procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')' AS name
        FROM pg_proc procedure
        INNER JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = CURRENT_SCHEMA()
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend dependency
            WHERE dependency.classid = 'pg_proc'::regclass
              AND dependency.objid = procedure.oid
              AND dependency.deptype = 'e'
          )
        UNION ALL
        SELECT 'type'::text AS kind, schema_type.typname AS name
        FROM pg_type schema_type
        INNER JOIN pg_namespace namespace ON namespace.oid = schema_type.typnamespace
        WHERE namespace.nspname = CURRENT_SCHEMA()
          AND schema_type.typtype IN ('d', 'e')
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend dependency
            WHERE dependency.classid = 'pg_type'::regclass
              AND dependency.objid = schema_type.oid
              AND dependency.deptype = 'e'
          )
      ) artifact
      ORDER BY artifact.kind, artifact.name
    `);
    const relationNames = new Set(relations.rows.map(({ name }) => name));
    const migrations = relationNames.has('schema_migrations')
      ? await client.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename')
      : { rows: [] };

    return {
      migrationFilenames: migrations.rows.map(({ filename }) => filename),
      relations: relations.rows,
      namespaceArtifacts: namespaceArtifacts.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      triggers: triggers.rows,
    };
  });
}

export async function attestCanonicalRuntimeSchema(database: TransactionRunner): Promise<'canonical_fresh_v1'> {
  let catalog: RuntimeSchemaCatalog;
  try {
    catalog = await readRuntimeSchemaCatalog(database);
  } catch {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_QUERY_FAILED');
  }
  const description = describeRuntimeSchema(catalog);
  if (description.kind !== 'canonical_fresh_v1') {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
  }
  return description.kind;
}

export async function prepareCanonicalRuntimeSchema(input: {
  database: TransactionRunner;
  autoRunMigrations: boolean;
  runMigrations: (database: TransactionRunner) => Promise<string[]>;
}): Promise<{ descriptor: 'canonical_fresh_v1'; appliedMigrations: string[] }> {
  let before: RuntimeSchemaDescription;
  try {
    before = describeRuntimeSchema(await readRuntimeSchemaCatalog(input.database));
  } catch {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_QUERY_FAILED');
  }

  if (!input.autoRunMigrations) {
    if (before.kind !== 'canonical_fresh_v1') {
      throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
    }
    return { descriptor: before.kind, appliedMigrations: [] };
  }
  if (!['empty_fresh', 'canonical_046_pending_047', 'canonical_fresh_v1'].includes(before.kind)) {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
  }

  const appliedMigrations = await input.runMigrations(input.database);
  await attestCanonicalRuntimeSchema(input.database);
  return { descriptor: 'canonical_fresh_v1', appliedMigrations };
}

function validateCanonicalCatalog(catalog: RuntimeSchemaCatalog, includeStateCopyV2: boolean): string[] {
  const failures: string[] = [];
  const relationKinds = new Map(catalog.relations.map(({ name, kind }) => [name, kind]));
  for (const relation of REQUIRED_RELATIONS) {
    if (relationKinds.get(relation) !== 'r') failures.push(`RELATION:${relation}`);
  }
  for (const forbidden of FORBIDDEN_RELATIONS) {
    if (relationKinds.has(forbidden)) failures.push(`FORBIDDEN_RELATION:${forbidden}`);
  }

  const columns = new Map(catalog.columns.map((item) => [`${item.relation}.${item.name}`, item.type]));
  for (const [relation, name, type] of REQUIRED_COLUMNS) {
    if (columns.get(`${relation}.${name}`) !== type) failures.push(`COLUMN:${relation}.${name}`);
  }
  for (const name of FORBIDDEN_PAGE_METADATA_COLUMNS) {
    if (columns.has(`pages.${name}`)) failures.push(`FORBIDDEN_COLUMN:pages.${name}`);
  }

  const constraints = new Map(catalog.constraints.map((item) => [`${item.relation}.${item.name}`, item]));
  for (const [relation, name, type, validated, definitionSha256] of REQUIRED_CONSTRAINTS) {
    const value = constraints.get(`${relation}.${name}`);
    if (value?.type !== type || value.validated !== validated || value.definitionSha256 !== definitionSha256) failures.push(`CONSTRAINT:${relation}.${name}`);
  }

  const indexes = new Map(catalog.indexes.map((item) => [`${item.relation}.${item.name}`, item]));
  for (const [relation, name, definitionSha256] of REQUIRED_INDEXES) {
    const value = indexes.get(`${relation}.${name}`);
    if (value?.unique !== true || value.valid !== true || value.definitionSha256 !== definitionSha256) failures.push(`INDEX:${relation}.${name}`);
  }

  const triggers = new Map(catalog.triggers.map((item) => [`${item.relation}.${item.name}`, item]));
  for (const [relation, name, functionName, definitionSha256] of REQUIRED_TRIGGERS) {
    const value = triggers.get(`${relation}.${name}`);
    if (value?.functionName !== functionName || !isTriggerEnabled(value.enabled) || value.definitionSha256 !== definitionSha256) failures.push(`TRIGGER:${relation}.${name}`);
  }
  for (const trigger of catalog.triggers) {
    if (FORBIDDEN_TRIGGERS.has(trigger.name)) failures.push(`FORBIDDEN_TRIGGER:${trigger.name}`);
  }

  if (includeStateCopyV2) {
    if (relationKinds.get('state_reference_copy_attempts') !== 'r') failures.push('RELATION:state_reference_copy_attempts');
    if (columns.get('state_reference_copy_attempts.state') !== 'text') failures.push('COLUMN:state_reference_copy_attempts.state');
    const stateConstraint = constraints.get('state_reference_copy_attempts.state_copy_v2_scope_shape');
    if (stateConstraint?.type !== 'c' || stateConstraint.validated !== true || stateConstraint.definitionSha256 !== CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints.state_copy_v2_scope_shape) failures.push('CONSTRAINT:state_reference_copy_attempts.state_copy_v2_scope_shape');
    const stateIndex = indexes.get('state_reference_copy_attempts.state_copy_v2_active_candidate');
    if (stateIndex?.unique !== true || stateIndex.valid !== true || stateIndex.definitionSha256 !== CANONICAL_RUNTIME_SCHEMA_SIGNATURES.indexes.state_copy_v2_active_candidate) failures.push('INDEX:state_reference_copy_attempts.state_copy_v2_active_candidate');
    const stateTrigger = triggers.get('state_reference_copy_attempts.state_copy_v2_guard');
    if (stateTrigger?.functionName !== 'lyra_guard_state_copy_v2_journal' || !isTriggerEnabled(stateTrigger.enabled) || stateTrigger.definitionSha256 !== CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers.state_copy_v2_guard) failures.push('TRIGGER:state_reference_copy_attempts.state_copy_v2_guard');
  } else if (relationKinds.has('state_reference_copy_attempts')) {
    failures.push('UNEXPECTED_RELATION:state_reference_copy_attempts');
  }

  return [...new Set(failures)].sort();
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function isTriggerEnabled(enabled: string): boolean {
  return enabled === 'O' || enabled === 'A';
}
