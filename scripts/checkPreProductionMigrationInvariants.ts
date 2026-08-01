import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import type { DatabaseClient } from '../src/lib/db.js';
import {
  SCHEMA_026_DEPLOYMENT_DATA_INVARIANT_QUERIES,
  type DeploymentDataInvariantQuery,
  type DeploymentDataInvariantReport,
  type DeploymentDataInvariantViolation,
} from './checkDeploymentDataInvariants.js';

interface InvariantRow {
  id: unknown;
}

const SAMPLE_LIMIT = 10;

const EXPECTED_SCHEMA_026_MIGRATIONS = [
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
] as const;

const expectedMigrationValuesSql = EXPECTED_SCHEMA_026_MIGRATIONS.map(
  (filename) => `('${filename}')`,
).join(', ');

const PRE_MIGRATION_GUARD_QUERIES: readonly DeploymentDataInvariantQuery[] = [
  {
    name: 'schema_migrations.expected_026',
    sql: `WITH expected(filename) AS (VALUES ${expectedMigrationValuesSql}), differences AS (SELECT COALESCE(expected.filename, applied.filename) AS id FROM expected FULL OUTER JOIN schema_migrations AS applied USING (filename) WHERE expected.filename IS NULL OR applied.filename IS NULL) SELECT id FROM differences ORDER BY id LIMIT $1`,
  },
  {
    name: 'schema_migrations.post_026_artifacts',
    sql: "SELECT pg_class.relname::text AS id FROM pg_class INNER JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE /* schema_migrations.post_026_artifacts */ pg_namespace.nspname = CURRENT_SCHEMA() AND pg_class.relkind IN ('r', 'p') AND pg_class.relname IN ('account_deletion_requests', 'mobile_store_purchases', 'mobile_store_purchase_events', 'generation_job_history_hides', 'entity_reference_upload_tokens', 'episode_export_jobs', 'episode_export_job_outbox', 'mobile_push_tokens', 'mobile_push_notification_outbox', 'mobile_push_notification_deliveries') ORDER BY pg_class.relname LIMIT $1",
  },
  {
    name: 'generation_jobs.must_be_drained',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE /* generation_jobs.must_be_drained */ status IN ('queued', 'processing') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.cancellation_contract',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE /* generation_jobs.cancellation_contract */ (cancel_requested_at IS NULL) <> (cancel_requested_by IS NULL) OR cancel_requested_at < created_at OR commit_started_at < created_at OR (cancel_requested_at IS NOT NULL AND commit_started_at IS NOT NULL) OR (status = 'cancelled' AND (cancel_requested_at IS NULL OR cancel_requested_by IS NULL OR cancelled_at IS NULL OR completed_at IS NULL OR commit_started_at IS NOT NULL OR cancelled_at < cancel_requested_at OR completed_at < cancelled_at)) OR (status <> 'cancelled' AND cancelled_at IS NOT NULL) ORDER BY id LIMIT $1",
  },
];

export const PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES: readonly DeploymentDataInvariantQuery[] = [
  ...PRE_MIGRATION_GUARD_QUERIES,
  ...SCHEMA_026_DEPLOYMENT_DATA_INVARIANT_QUERIES,
];

export async function checkPreProductionMigrationInvariants(
  database: DatabaseClient,
): Promise<DeploymentDataInvariantReport> {
  const violations: DeploymentDataInvariantViolation[] = [];

  for (const query of PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES) {
    const result = await database.query<InvariantRow>(query.sql, [SAMPLE_LIMIT]);
    if (result.rows.length === 0) {
      continue;
    }

    violations.push({
      name: query.name,
      sampleIds: result.rows.map((row) => String(row.id)),
    });
  }

  return {
    ok: violations.length === 0,
    checkedCount: PRE_PRODUCTION_MIGRATION_INVARIANT_QUERIES.length,
    violations,
  };
}

async function main(): Promise<void> {
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();

  const { closeDatabasePool, db } = await import('../src/lib/db.js');

  try {
    const report = await checkPreProductionMigrationInvariants(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabasePool();
  }
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown pre-production migration check error'));
    process.exitCode = 1;
  });
}
