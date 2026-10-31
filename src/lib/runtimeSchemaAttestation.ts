import { createHash } from 'node:crypto';
import { ConfigurationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from './db.js';
import { PRODUCTION44_EXPANSION_MIGRATIONS } from './production44ExpandedRuntimeSchemaDescriptor.js';
import { describeProduction44ExpansionCheckpoint } from './production44ExpandedRuntimeSchemaAttestation.js';
import { WORK_DELETION_SCHEMA } from './workDeletionSchemaDescriptor.js';
import { STRIPE_RECOVERY_SCHEMA } from './stripeRecoverySchemaDescriptor.js';

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
  '048_advance_entity_state_revision_for_legacy_writers.sql',
] as const;

export const SECURITY_RUNTIME_MIGRATIONS = [...CANONICAL_RUNTIME_MIGRATIONS, '049_add_stripe_credit_recovery.sql'] as const;
export const WORK_DELETION_RUNTIME_MIGRATIONS = [...SECURITY_RUNTIME_MIGRATIONS, '050_add_work_deletion.sql'] as const;
export const GOOGLE_IDENTITY_RECOVERY_RUNTIME_MIGRATIONS = [...WORK_DELETION_RUNTIME_MIGRATIONS, '051_add_google_link_recovery.sql'] as const;
export const GENERATION_WORKER_WARM_RUNTIME_MIGRATIONS = [...GOOGLE_IDENTITY_RECOVERY_RUNTIME_MIGRATIONS, '052_add_generation_worker_warm_control.sql'] as const;

export interface RuntimeSchemaCatalog {
  // Additive-table evidence only; removed after exact 052 validation so existing
  // serialized descriptors and their guarantees remain unchanged.
  generationWorkerWarmStorage?: Array<{
    persistence: string;
    heap: boolean;
    defaultColumns: boolean;
    defaultIndexes: boolean;
    noAdditionalObjects: boolean;
  }>;
  migrationFilenames: string[];
  relations: Array<{
    name: string;
    kind: string;
    rowSecurity?: boolean;
    forceRowSecurity?: boolean;
  }>;
  namespaceArtifacts: Array<{ kind: string; name: string }>;
  columns: Array<{
    relation: string;
    name: string;
    type: string;
    nullable: boolean;
    defaultExpressionSha256?: string | null;
    identityGeneration?: string | null;
    generatedExpressionSha256?: string | null;
  }>;
  constraints: Array<{ relation: string; name: string; type: string; validated: boolean; definitionSha256: string }>;
  indexes: Array<{ relation: string; name: string; unique: boolean; valid: boolean; definitionSha256: string }>;
  triggers: Array<{ relation: string; name: string; functionName: string; enabled: string; definitionSha256: string }>;
  functions?: Array<{
    name: string;
    identityArguments: string;
    returnType: string;
    language: string;
    securityDefiner: boolean;
    settings: string[];
    bodySha256: string;
    kind?: 'function' | 'procedure';
    volatility?: 'immutable' | 'stable' | 'volatile';
    strict?: boolean;
    parallel?: 'safe' | 'restricted' | 'unsafe';
    leakproof?: boolean;
  }>;
}

export interface ReadRuntimeSchemaCatalogOptions {
  includeFunctionBodies?: boolean;
  includeLegacyAttributes?: boolean;
}

export type RuntimeSchemaDescriptor = 'empty_fresh' | 'canonical_046_pending_047' | 'canonical_fresh_v1' | 'unsupported';

export interface RuntimeSchemaDescription {
  kind: RuntimeSchemaDescriptor;
  failures: string[];
}

const CANONICAL_047_MIGRATIONS = CANONICAL_RUNTIME_MIGRATIONS.slice(0, -1);
const CANONICAL_046_MIGRATIONS = CANONICAL_RUNTIME_MIGRATIONS.slice(0, -2);
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

const MIN_SUPPORTED_POSTGRES_VERSION_NUM = 160000;
const POSTGRES_NATIVE_NOT_NULL_CONSTRAINT_VERSION_NUM = 180000;
// Keep live server evidence out of the serialized catalog fingerprint while
// binding it to the exact catalog object read from the same transaction.
const runtimeSchemaPostgresVersions = new WeakMap<RuntimeSchemaCatalog, number>();

export function describeRuntimeSchema(catalog: RuntimeSchemaCatalog): RuntimeSchemaDescription {
  const warm = projectGenerationWorkerWarmControl(catalog);
  if (warm === null) return { kind: 'unsupported', failures: ['GENERATION_WORKER_WARM_SCHEMA_MISMATCH'] };
  catalog = warm;
  const recovery = projectGoogleIdentityRecovery(catalog);
  if (recovery === null) return { kind: 'unsupported', failures: ['GOOGLE_IDENTITY_RECOVERY_SCHEMA_MISMATCH'] };
  if (recovery.enabled) return describeRuntimeSchema(recovery.catalog);
  if (
    catalog.migrationFilenames.length === 0
    && catalog.relations.every(({ name, kind }) => EMPTY_RELATIONS.has(name) && kind === 'r')
    && catalog.namespaceArtifacts.length === 0
  ) {
    return { kind: 'empty_fresh', failures: [] };
  }

  const hasWorkDeletionGuard = sameStrings(catalog.migrationFilenames, WORK_DELETION_RUNTIME_MIGRATIONS);
  const hasRecoveryGuard = hasWorkDeletionGuard || sameStrings(catalog.migrationFilenames, SECURITY_RUNTIME_MIGRATIONS);
  const hasRevisionGuard = hasRecoveryGuard || sameStrings(catalog.migrationFilenames, CANONICAL_RUNTIME_MIGRATIONS);
  const historyKind = hasRevisionGuard || sameStrings(catalog.migrationFilenames, CANONICAL_047_MIGRATIONS)
    ? 'canonical_fresh_v1'
    : sameStrings(catalog.migrationFilenames, CANONICAL_046_MIGRATIONS)
      ? 'canonical_046_pending_047'
      : null;
  if (historyKind === null) {
    return { kind: 'unsupported', failures: ['MIGRATION_HISTORY_MISMATCH'] };
  }

  const failures = validateCanonicalCatalog(catalog, historyKind === 'canonical_fresh_v1');
  if (hasRecoveryGuard) {
    const serverVersionNum = runtimeSchemaPostgresVersions.get(catalog);
    if (
      typeof serverVersionNum !== 'number'
      || !Number.isSafeInteger(serverVersionNum)
      || serverVersionNum < MIN_SUPPORTED_POSTGRES_VERSION_NUM
    ) {
      failures.push('POSTGRES_VERSION_UNSUPPORTED');
    } else {
      for (const relation of ['stripe_payment_recoveries', 'stripe_payment_adjustment_objects', 'stripe_unresolved_payment_adjustments']) {
        if (!catalog.relations.some(item => item.name === relation && item.kind === 'r')) failures.push(`RELATION:${relation}`);
      }
      for (const part of ['columns', 'constraints', 'indexes'] as const) {
        const expectedRows = part === 'constraints' && serverVersionNum < POSTGRES_NATIVE_NOT_NULL_CONSTRAINT_VERSION_NUM
          ? STRIPE_RECOVERY_SCHEMA.constraints.filter(constraint => constraint.type !== 'n')
          : STRIPE_RECOVERY_SCHEMA[part];
        for (const expected of expectedRows) {
          const actual = catalog[part].find(item => item.relation === expected.relation && item.name === expected.name);
          if (actual === undefined || !Object.entries(expected).every(([key, value]) => (actual as unknown as Record<string, unknown>)[key] === value)) {
            failures.push(`RECOVERY_${part.toUpperCase()}:${expected.relation}.${expected.name}`);
          }
        }
      }
    }
  } else if (catalog.relations.some(item => item.name.startsWith('stripe_payment_') || item.name === 'stripe_unresolved_payment_adjustments')) {
    failures.push('UNRECORDED_RECOVERY_SCHEMA');
  }
  if (hasWorkDeletionGuard) {
    const serverVersionNum = runtimeSchemaPostgresVersions.get(catalog) ?? 0;
    for (const part of ['relations', 'columns', 'constraints', 'indexes', 'triggers', 'functions'] as const) {
      const expectedRows = part === 'constraints' && serverVersionNum < POSTGRES_NATIVE_NOT_NULL_CONSTRAINT_VERSION_NUM
        ? WORK_DELETION_SCHEMA.constraints.filter(row => row.type !== 'n') : WORK_DELETION_SCHEMA[part];
      for (const expected of expectedRows) {
        const actualRows = catalog[part] ?? [];
        const actual = actualRows.find(row => {
          const record = row as unknown as Record<string, unknown>;
          const identity = expected as unknown as Record<string, unknown>;
          return record.name === identity.name && (identity.relation === undefined || record.relation === identity.relation);
        });
        if (actual === undefined || !Object.entries(expected).every(([key, value]) => JSON.stringify((actual as unknown as Record<string, unknown>)[key]) === JSON.stringify(value))) {
          failures.push(`WORK_DELETION_${part.toUpperCase()}:${'relation' in expected ? expected.relation + '.' : ''}${expected.name}`);
        }
      }
    }
  } else if (catalog.relations.some(row => row.name.startsWith('work_deletion_') || row.name === 'work_storage_operations')
    || catalog.columns.some(row => row.relation === 'works' && row.name === 'deletion_started_at')) {
    failures.push('UNRECORDED_WORK_DELETION_SCHEMA');
  }
  const revisionTriggers = catalog.triggers.filter(trigger => trigger.name === 'entity_states_monotonic_revision');
  const revisionFunctions = catalog.functions?.filter(fn => fn.name === 'lyra_advance_entity_state_revision') ?? [];
  if (hasRevisionGuard) {
    const trigger = revisionTriggers[0];
    const fn = revisionFunctions[0];
    if (revisionTriggers.length !== 1 || trigger?.relation !== 'entity_states' || trigger.functionName !== 'lyra_advance_entity_state_revision' || trigger.enabled !== 'O' || trigger.definitionSha256 !== 'f4ecec84d3f71eb573ea77f0e3f3c54e8c90604aeb80dc9b54910517f66dd040') failures.push('REVISION_TRIGGER_MISMATCH');
    if (revisionFunctions.length !== 1 || fn?.identityArguments !== '' || fn.returnType !== 'trigger' || fn.language !== 'plpgsql' || fn.securityDefiner !== false || fn.settings.length !== 0 || fn.bodySha256 !== '205cfe9d4f1cdc91c376ee628dd7b4e00ea668a9303b4cdb281f40077442c0c1' || fn.kind !== 'function' || fn.volatility !== 'volatile' || fn.strict !== false || fn.parallel !== 'unsafe' || fn.leakproof !== false) failures.push('REVISION_FUNCTION_MISMATCH');
    if (!catalog.columns.some(column => column.relation === 'entity_states' && column.name === 'updated_at' && column.type === 'timestamp with time zone')) failures.push('REVISION_COLUMN_MISMATCH');
  } else if (revisionTriggers.length > 0 || revisionFunctions.length > 0 || catalog.namespaceArtifacts.some(artifact => artifact.name === 'lyra_advance_entity_state_revision()')) {
    failures.push('UNRECORDED_REVISION_GUARD');
  }
  return failures.length === 0
    ? { kind: historyKind, failures: [] }
    : { kind: 'unsupported', failures };
}

export async function readRuntimeSchemaCatalog(
  database: TransactionRunner,
  options: ReadRuntimeSchemaCatalogOptions = {},
): Promise<RuntimeSchemaCatalog> {
  return database.transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    return readRuntimeSchemaCatalogInTransaction(client, options);
  });
}

async function readPostgresServerVersionNum(client: DatabaseClient): Promise<number> {
  const result = await client.query<{ serverVersionNum: string }>(
    `SELECT current_setting('server_version_num') AS "serverVersionNum"`,
  );
  const rawVersion = result.rows.length === 1 ? result.rows[0]?.serverVersionNum : undefined;
  if (typeof rawVersion !== 'string' || !/^\d+$/u.test(rawVersion)) {
    throw new Error('PostgreSQL server version metadata is invalid');
  }
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < MIN_SUPPORTED_POSTGRES_VERSION_NUM) {
    throw new Error('PostgreSQL server version is unsupported');
  }
  return version;
}

/** The caller owns the transaction: expansion verifies its uncommitted DDL
 * before recording a successful checkpoint. Runtime readers use the read-only wrapper. */
export async function readRuntimeSchemaCatalogInTransaction(
  client: DatabaseClient,
  options: ReadRuntimeSchemaCatalogOptions = {},
): Promise<RuntimeSchemaCatalog> {
    const legacyRelationSelect = options.includeLegacyAttributes
      ? ', relation.relrowsecurity AS "rowSecurity", relation.relforcerowsecurity AS "forceRowSecurity"'
      : '';
    const relations = await client.query<RuntimeSchemaCatalog['relations'][number]>(`
      SELECT relation.relname AS name, relation.relkind AS kind${legacyRelationSelect}
      FROM pg_class relation
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = CURRENT_SCHEMA()
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      ORDER BY relation.relname
    `);
    const legacyColumnSelect = options.includeLegacyAttributes
      ? `,
        CASE WHEN column_default IS NULL THEN NULL
          ELSE encode(sha256(convert_to(column_default, 'UTF8')), 'hex')
        END AS "defaultExpressionSha256",
        CASE WHEN is_identity = 'YES' THEN identity_generation ELSE NULL END AS "identityGeneration",
        CASE WHEN is_generated = 'ALWAYS' THEN
          encode(sha256(convert_to(COALESCE(generation_expression, ''), 'UTF8')), 'hex')
          ELSE NULL
        END AS "generatedExpressionSha256"`
      : '';
    const columns = await client.query<RuntimeSchemaCatalog['columns'][number]>(`
      SELECT table_name AS relation, column_name AS name,
        CASE WHEN data_type = 'ARRAY' THEN udt_name ELSE data_type END AS type,
        is_nullable = 'YES' AS nullable${legacyColumnSelect}
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
    const legacyFunctionSelect = options.includeLegacyAttributes
      ? `,
          CASE procedure.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
          CASE procedure.provolatile
            WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile'
          END AS volatility,
          procedure.proisstrict AS strict,
          CASE procedure.proparallel
            WHEN 's' THEN 'safe' WHEN 'r' THEN 'restricted' ELSE 'unsafe'
          END AS parallel,
          procedure.proleakproof AS leakproof`
      : '';
    const functions = options.includeFunctionBodies
      ? await client.query<NonNullable<RuntimeSchemaCatalog['functions']>[number]>(`
        SELECT procedure.proname AS name,
          pg_get_function_identity_arguments(procedure.oid) AS "identityArguments",
          COALESCE(pg_get_function_result(procedure.oid), 'procedure') AS "returnType",
          language.lanname AS language,
          procedure.prosecdef AS "securityDefiner",
          COALESCE(procedure.proconfig, ARRAY[]::text[]) AS settings,
          encode(sha256(convert_to(replace(procedure.prosrc, E'\\r\\n', E'\\n'), 'UTF8')), 'hex') AS "bodySha256"${legacyFunctionSelect}
        FROM pg_proc procedure
        INNER JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        INNER JOIN pg_language language ON language.oid = procedure.prolang
        WHERE namespace.nspname = CURRENT_SCHEMA()
          AND procedure.prokind IN ('f', 'p')
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend dependency
            WHERE dependency.classid = 'pg_proc'::regclass
              AND dependency.objid = procedure.oid
              AND dependency.deptype = 'e'
          )
        ORDER BY procedure.proname, pg_get_function_identity_arguments(procedure.oid)
      `)
      : undefined;
    const relationNames = new Set(relations.rows.map(({ name }) => name));
    const migrations = relationNames.has('schema_migrations')
      ? await client.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename')
      : { rows: [] };

    const catalog: RuntimeSchemaCatalog = {
      migrationFilenames: migrations.rows.map(({ filename }) => filename),
      relations: relations.rows,
      namespaceArtifacts: namespaceArtifacts.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      triggers: triggers.rows,
    };
    const completeCatalog = functions === undefined ? catalog : { ...catalog, functions: functions.rows };
    if (relationNames.has(GENERATION_WORKER_WARM_TABLE)) {
      // Generic legacy index signatures omit INCLUDE columns, access methods and
      // storage details. Check these only for 052, without widening old hashes.
      const storage = await client.query<NonNullable<RuntimeSchemaCatalog['generationWorkerWarmStorage']>[number]>(`
        SELECT relation.relpersistence::text AS persistence,
          method.amname = 'heap' AS heap,
          NOT EXISTS (
            SELECT 1 FROM pg_attribute attribute
            INNER JOIN pg_type column_type ON column_type.oid = attribute.atttypid
            INNER JOIN pg_namespace type_namespace ON type_namespace.oid = column_type.typnamespace
            WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
              AND (type_namespace.nspname <> 'pg_catalog'
                OR column_type.typname <> CASE attribute.attname
                  WHEN 'resource_id' THEN 'text' WHEN 'last_applied_floor' THEN 'int2' ELSE 'timestamptz' END
                OR attribute.atttypmod <> -1 OR attribute.attndims <> 0
                OR attribute.attcollation <> column_type.typcollation)
          ) AS "defaultColumns",
          NOT EXISTS (
            SELECT 1 FROM pg_index warm_index
            INNER JOIN pg_class index_relation ON index_relation.oid = warm_index.indexrelid
            INNER JOIN pg_am index_method ON index_method.oid = index_relation.relam
            WHERE warm_index.indrelid = relation.oid
              AND (index_method.amname <> 'btree' OR warm_index.indnatts <> 1 OR warm_index.indnkeyatts <> 1
                OR NOT warm_index.indisprimary OR NOT warm_index.indimmediate OR warm_index.indnullsnotdistinct
                OR index_relation.reloptions IS NOT NULL OR index_relation.reltablespace <> 0)
          ) AS "defaultIndexes",
          (NOT relation.relhasrules AND relation.relreplident = 'd' AND relation.reloptions IS NULL
            AND relation.reltablespace = 0
            AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = relation.oid OR inhparent = relation.oid)
            AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = relation.oid)) AS "noAdditionalObjects"
        FROM pg_class relation
        INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_am method ON method.oid = relation.relam
        WHERE namespace.nspname = CURRENT_SCHEMA() AND relation.relname = $1
      `, [GENERATION_WORKER_WARM_TABLE]);
      completeCatalog.generationWorkerWarmStorage = storage.rows;
    }
    if (completeCatalog.migrationFilenames.includes('049_add_stripe_credit_recovery.sql')) {
      const postgresVersion = await readPostgresServerVersionNum(client);
      runtimeSchemaPostgresVersions.set(completeCatalog, postgresVersion);
    }
    return completeCatalog;
}

export interface AttestedCanonicalRuntime {
  readonly descriptor: 'canonical_fresh_v1';
  readonly repositoryProfile: 'canonical';
}

export type AttestedRuntime = Readonly<{
  descriptor: 'canonical_fresh_v1';
  repositoryProfile: 'canonical';
  capabilities: Readonly<{ entityStateMonotonicRevision: boolean; stripeCreditRecovery?: boolean; workDeletion?: boolean; googleIdentityRecovery?: boolean }>;
} | {
  descriptor: 'production44_expanded_pg18_v1';
  repositoryProfile: 'production44_expanded_pg18_v1';
  capabilities: Readonly<{ entityStateMonotonicRevision: true; stripeCreditRecovery?: boolean; workDeletion?: boolean; googleIdentityRecovery?: boolean }>;
}>;

const verifiedRuntimeProofs = new WeakSet<object>();

/** The frozen proof is issued from catalog evidence, never an environment selection. */
function runtimeProof(catalog: RuntimeSchemaCatalog): AttestedRuntime | null {
  const warm = projectGenerationWorkerWarmControl(catalog);
  if (warm === null) return null;
  catalog = warm;
  const recovery = projectGoogleIdentityRecovery(catalog);
  if (recovery === null) return null;
  catalog = recovery.catalog;
  const recoveryCapability = recovery.enabled ? { googleIdentityRecovery: true } : {};
  const canonical = describeRuntimeSchema(catalog).kind === 'canonical_fresh_v1';
  if (!canonical && describeProduction44ExpansionCheckpoint(catalog) !== PRODUCTION44_EXPANSION_MIGRATIONS.length) return null;
  const proof: AttestedRuntime = canonical
    ? Object.freeze({ descriptor: 'canonical_fresh_v1', repositoryProfile: 'canonical', capabilities: Object.freeze({ entityStateMonotonicRevision: catalog.migrationFilenames.includes('048_advance_entity_state_revision_for_legacy_writers.sql'), stripeCreditRecovery: catalog.migrationFilenames.includes('049_add_stripe_credit_recovery.sql'), workDeletion: catalog.migrationFilenames.includes('050_add_work_deletion.sql'), ...recoveryCapability }) })
    : Object.freeze({ descriptor: 'production44_expanded_pg18_v1', repositoryProfile: 'production44_expanded_pg18_v1', capabilities: Object.freeze({ entityStateMonotonicRevision: true, stripeCreditRecovery: true, workDeletion: true, ...recoveryCapability }) });
  verifiedRuntimeProofs.add(proof);
  return proof;
}

export function assertVerifiedRuntimeProof(runtime: AttestedRuntime): void {
  if (!verifiedRuntimeProofs.has(runtime)) throw new ConfigurationError('Runtime schema attestation failed: UNVERIFIED_RUNTIME_PROOF');
}

async function readBootCatalog(database: TransactionRunner): Promise<RuntimeSchemaCatalog> {
  try { return await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true }); }
  catch { throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_QUERY_FAILED'); }
}

export async function attestRuntimeSchema(database: TransactionRunner): Promise<AttestedRuntime> {
  const proof = runtimeProof(await readBootCatalog(database));
  if (proof === null) throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
  return proof;
}

export async function prepareAttestedRuntimeSchema(input: {
  database: TransactionRunner;
  autoRunMigrations: boolean;
  runMigrations: (database: TransactionRunner) => Promise<string[]>;
}): Promise<{ runtime: AttestedRuntime; appliedMigrations: string[] }> {
  const catalog = await readBootCatalog(input.database);
  const proof = runtimeProof(catalog);
  // Expansion is exclusively the explicit allowlist command, including when an
  // ordinary canonical AUTO migration flag was accidentally retained at rollout.
  if (proof?.repositoryProfile === 'production44_expanded_pg18_v1') return { runtime: proof, appliedMigrations: [] };
  if (!input.autoRunMigrations) {
    if (proof === null) throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
    return { runtime: proof, appliedMigrations: [] };
  }
  if (!['empty_fresh', 'canonical_046_pending_047', 'canonical_fresh_v1'].includes(describeRuntimeSchema(catalog).kind)) {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
  }
  const appliedMigrations = await input.runMigrations(input.database);
  return { runtime: await attestRuntimeSchema(input.database), appliedMigrations };
}

export async function startAttestedRuntime<T>(input: {
  attest: () => Promise<AttestedRuntime>;
  start: (runtime: AttestedRuntime) => T | Promise<T>;
}): Promise<T> {
  const runtime = await input.attest();
  assertVerifiedRuntimeProof(runtime);
  return input.start(runtime);
}

/** Spec §11: no writer is constructed before attestation, and its profile is
 * carried into startup rather than read again from mutable configuration.
 * This deliberately does not admit a legacy descriptor or enable legacy use. */
export async function startAttestedCanonicalRuntime<T>(input: {
  attest: () => Promise<'canonical_fresh_v1'>;
  start: (runtime: AttestedCanonicalRuntime) => T | Promise<T>;
}): Promise<T> {
  const descriptor = await input.attest();
  if (descriptor !== 'canonical_fresh_v1') {
    throw new ConfigurationError('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
  }
  return input.start(Object.freeze({ descriptor, repositoryProfile: 'canonical' }));
}

export async function attestCanonicalRuntimeSchema(database: TransactionRunner): Promise<'canonical_fresh_v1'> {
  let catalog: RuntimeSchemaCatalog;
  try {
    catalog = await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true });
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
    before = describeRuntimeSchema(await readRuntimeSchemaCatalog(input.database, { includeFunctionBodies: true, includeLegacyAttributes: true }));
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

const GOOGLE_IDENTITY_RECOVERY_MIGRATION = '051_add_google_link_recovery.sql';
const GOOGLE_RECOVERY_TABLE = 'retired_auth_subjects';
const GOOGLE_RECOVERY_COLUMNS = ['operation_phase', 'source_subject_key'];
const googleRecoveryDigest = (value: string): string => createHash('sha256').update(value).digest('hex');
// These definitions were checked against isolated PostgreSQL 18.3 running 051.
// Projection is permitted only after the whole additive footprint is verified.
// All pre-051 descriptor checks and expanded catalog fingerprints stay intact.
const GOOGLE_RECOVERY_COLUMN_ROWS = [
  ['retired_auth_subjects', 'subject_key', 'text', false, null],
  ['retired_auth_subjects', 'destination_user_id', 'uuid', false, null],
  ['retired_auth_subjects', 'created_at', 'timestamp with time zone', false, 'now()'],
  ['oauth_identity_links', 'operation_phase', 'text', false, "'attempted'::text"],
  ['oauth_identity_links', 'source_subject_key', 'text', true, null],
] as const;
const GOOGLE_RECOVERY_CONSTRAINT_ROWS = [
  ['retired_auth_subjects', 'retired_auth_subjects_pkey', 'p', 'PRIMARY KEY (subject_key)'],
  ['retired_auth_subjects', 'retired_auth_subjects_subject_key_check', 'c', 'CHECK (char_length(subject_key) = 43)'],
  ['retired_auth_subjects', 'retired_auth_subjects_destination_user_id_fkey', 'f', 'FOREIGN KEY (destination_user_id) REFERENCES users(id) ON DELETE RESTRICT'],
  ['retired_auth_subjects', 'retired_auth_subjects_subject_key_not_null', 'n', 'NOT NULL subject_key'],
  ['retired_auth_subjects', 'retired_auth_subjects_destination_user_id_not_null', 'n', 'NOT NULL destination_user_id'],
  ['retired_auth_subjects', 'retired_auth_subjects_created_at_not_null', 'n', 'NOT NULL created_at'],
  ['oauth_identity_links', 'oauth_identity_links_operation_phase_not_null', 'n', 'NOT NULL operation_phase'],
  ['oauth_identity_links', 'oauth_identity_links_operation_phase_check', 'c', "CHECK (operation_phase = ANY (ARRAY['ready'::text, 'attempted'::text, 'rejected'::text, 'linked'::text]))"],
  ['oauth_identity_links', 'oauth_identity_links_source_subject_key_check', 'c', 'CHECK (source_subject_key IS NULL OR char_length(source_subject_key) = 43)'],
] as const;

function projectGoogleIdentityRecovery(catalog: RuntimeSchemaCatalog): { catalog: RuntimeSchemaCatalog; enabled: boolean } | null {
  const ownsColumn = (row: RuntimeSchemaCatalog['columns'][number]): boolean => row.relation === GOOGLE_RECOVERY_TABLE
    || (row.relation === 'oauth_identity_links' && GOOGLE_RECOVERY_COLUMNS.includes(row.name));
  const ownsConstraint = (row: RuntimeSchemaCatalog['constraints'][number]): boolean => row.relation === GOOGLE_RECOVERY_TABLE
    || GOOGLE_RECOVERY_CONSTRAINT_ROWS.some(([relation, name]) => row.relation === relation && row.name === name);
  const recorded = catalog.migrationFilenames.includes(GOOGLE_IDENTITY_RECOVERY_MIGRATION);
  if (!recorded) {
    if (catalog.relations.some(row => row.name === GOOGLE_RECOVERY_TABLE) || catalog.columns.some(ownsColumn)
      || catalog.constraints.some(ownsConstraint) || catalog.indexes.some(row => row.relation === GOOGLE_RECOVERY_TABLE)
      || catalog.triggers.some(row => row.relation === GOOGLE_RECOVERY_TABLE)) return null;
    return { catalog, enabled: false };
  }
  const version = runtimeSchemaPostgresVersions.get(catalog);
  if (version === undefined || version < MIN_SUPPORTED_POSTGRES_VERSION_NUM) return null;
  const columns = GOOGLE_RECOVERY_COLUMN_ROWS.map(([relation, name, type, nullable, expression]) => ({
    relation, name, type, nullable, defaultExpressionSha256: expression === null ? null : googleRecoveryDigest(expression),
    identityGeneration: null, generatedExpressionSha256: null,
  }));
  const constraints = GOOGLE_RECOVERY_CONSTRAINT_ROWS.filter(([, , type]) => version >= POSTGRES_NATIVE_NOT_NULL_CONSTRAINT_VERSION_NUM || type !== 'n')
    .map(([relation, name, type, definition]) => ({ relation, name, type, validated: true, definitionSha256: googleRecoveryDigest(definition) }));
  if (!sameCatalogRows(catalog.relations.filter(row => row.name === GOOGLE_RECOVERY_TABLE), [
    { name: GOOGLE_RECOVERY_TABLE, kind: 'r', rowSecurity: false, forceRowSecurity: false },
  ]) || !sameCatalogRows(catalog.columns.filter(ownsColumn), columns)
    || !sameCatalogRows(catalog.constraints.filter(ownsConstraint), constraints)
    || !sameCatalogRows(catalog.indexes.filter(row => row.relation === GOOGLE_RECOVERY_TABLE), [
      { relation: GOOGLE_RECOVERY_TABLE, name: 'retired_auth_subjects_pkey', unique: true, valid: true, definitionSha256: googleRecoveryDigest('[["subject_key"], ""]') },
    ]) || catalog.triggers.some(row => row.relation === GOOGLE_RECOVERY_TABLE)) return null;
  const baseline: RuntimeSchemaCatalog = {
    ...catalog,
    migrationFilenames: catalog.migrationFilenames.filter(filename => filename !== GOOGLE_IDENTITY_RECOVERY_MIGRATION),
    relations: catalog.relations.filter(row => row.name !== GOOGLE_RECOVERY_TABLE),
    columns: catalog.columns.filter(row => !ownsColumn(row)),
    constraints: catalog.constraints.filter(row => !ownsConstraint(row)),
    indexes: catalog.indexes.filter(row => row.relation !== GOOGLE_RECOVERY_TABLE),
  };
  if (catalog.migrationFilenames.filter(filename => filename === GOOGLE_IDENTITY_RECOVERY_MIGRATION).length !== 1
    || !baseline.migrationFilenames.includes('050_add_work_deletion.sql')) return null;
  runtimeSchemaPostgresVersions.set(baseline, version);
  return { catalog: baseline, enabled: true };
}
function sameCatalogRows(actual: readonly object[], expected: readonly object[]): boolean {
  const signatures = (rows: readonly object[]): string[] => rows.map(row => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort();
  return sameStrings(signatures(actual), signatures(expected));
}

const GENERATION_WORKER_WARM_MIGRATION = '052_add_generation_worker_warm_control.sql';
const GENERATION_WORKER_WARM_TABLE = 'generation_worker_warm_controls';
const GENERATION_WORKER_WARM_COLUMNS = [
  ['resource_id', 'text', false, null],
  ['lease_until', 'timestamp with time zone', true, null],
  ['last_applied_floor', 'smallint', true, null],
  ['updated_at', 'timestamp with time zone', false, 'clock_timestamp()'],
] as const;
const GENERATION_WORKER_WARM_CONSTRAINTS = [
  ['generation_worker_warm_controls_pkey', 'p', 'PRIMARY KEY (resource_id)'],
  ['generation_worker_warm_controls_resource_id_check', 'c', 'CHECK (length(resource_id) >= 1 AND length(resource_id) <= 200)'],
  ['generation_worker_warm_controls_last_applied_floor_check', 'c', 'CHECK (last_applied_floor = ANY (ARRAY[0, 1]))'],
  ['generation_worker_warm_controls_resource_id_not_null', 'n', 'NOT NULL resource_id'],
  ['generation_worker_warm_controls_updated_at_not_null', 'n', 'NOT NULL updated_at'],
] as const;

/** Spec §6/10: 052 is operational state, not a new writer capability. Validate
 * its whole additive footprint before removing it from the existing 051 proof.
 * Reject partial/unrecorded DDL and retain live version evidence across both
 * projections; never trust a deserialized catalog's claimed PostgreSQL version. */
function projectGenerationWorkerWarmControl(catalog: RuntimeSchemaCatalog): RuntimeSchemaCatalog | null {
  const owns = (row: { relation: string }): boolean => row.relation === GENERATION_WORKER_WARM_TABLE;
  const hasReservedArtifact = catalog.namespaceArtifacts.some(row => row.name.startsWith(GENERATION_WORKER_WARM_TABLE))
    || (catalog.functions ?? []).some(row => row.name.startsWith(GENERATION_WORKER_WARM_TABLE));
  const occurrences = catalog.migrationFilenames.filter(filename => filename === GENERATION_WORKER_WARM_MIGRATION).length;
  if (occurrences === 0) {
    return catalog.relations.some(row => row.name === GENERATION_WORKER_WARM_TABLE)
      || catalog.columns.some(owns) || catalog.constraints.some(owns) || catalog.indexes.some(owns)
      || catalog.triggers.some(owns) || catalog.generationWorkerWarmStorage !== undefined || hasReservedArtifact
      ? null : catalog;
  }
  const version = runtimeSchemaPostgresVersions.get(catalog);
  if (occurrences !== 1 || !catalog.migrationFilenames.includes(GOOGLE_IDENTITY_RECOVERY_MIGRATION)
    || version === undefined || version < MIN_SUPPORTED_POSTGRES_VERSION_NUM || hasReservedArtifact) return null;
  const columns = GENERATION_WORKER_WARM_COLUMNS.map(([name, type, nullable, expression]) => ({
    relation: GENERATION_WORKER_WARM_TABLE, name, type, nullable,
    defaultExpressionSha256: expression === null ? null : googleRecoveryDigest(expression),
    identityGeneration: null, generatedExpressionSha256: null,
  }));
  const constraints = GENERATION_WORKER_WARM_CONSTRAINTS
    .filter(([, type]) => version >= POSTGRES_NATIVE_NOT_NULL_CONSTRAINT_VERSION_NUM || type !== 'n')
    .map(([name, type, definition]) => ({ relation: GENERATION_WORKER_WARM_TABLE, name, type, validated: true, definitionSha256: googleRecoveryDigest(definition) }));
  if (!sameCatalogRows(catalog.relations.filter(row => row.name === GENERATION_WORKER_WARM_TABLE), [
    { name: GENERATION_WORKER_WARM_TABLE, kind: 'r', rowSecurity: false, forceRowSecurity: false },
  ]) || !sameCatalogRows(catalog.columns.filter(owns), columns)
    || !sameCatalogRows(catalog.constraints.filter(owns), constraints)
    || !sameCatalogRows(catalog.indexes.filter(owns), [{
      relation: GENERATION_WORKER_WARM_TABLE, name: 'generation_worker_warm_controls_pkey', unique: true,
      valid: true, definitionSha256: googleRecoveryDigest('[["resource_id"], ""]'),
    }]) || catalog.triggers.some(owns)
    || !sameCatalogRows(catalog.generationWorkerWarmStorage ?? [], [{
      persistence: 'p', heap: true, defaultColumns: true, defaultIndexes: true, noAdditionalObjects: true,
    }])) return null;
  const baseline: RuntimeSchemaCatalog = {
    ...catalog,
    migrationFilenames: catalog.migrationFilenames.filter(filename => filename !== GENERATION_WORKER_WARM_MIGRATION),
    relations: catalog.relations.filter(row => row.name !== GENERATION_WORKER_WARM_TABLE),
    columns: catalog.columns.filter(row => !owns(row)),
    constraints: catalog.constraints.filter(row => !owns(row)),
    indexes: catalog.indexes.filter(row => !owns(row)),
  };
  delete baseline.generationWorkerWarmStorage;
  runtimeSchemaPostgresVersions.set(baseline, version);
  return baseline;
}
