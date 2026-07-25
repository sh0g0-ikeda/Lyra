import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import type { DatabaseClient } from '../src/lib/db.js';

interface InvariantQuery {
  name: string;
  sql: string;
}

interface InvariantRow {
  id: unknown;
}

export interface DeploymentDataInvariantViolation {
  name: string;
  sampleIds: string[];
}

export interface DeploymentDataInvariantReport {
  ok: boolean;
  checkedCount: number;
  violations: DeploymentDataInvariantViolation[];
}

const SAMPLE_LIMIT = 10;
const ACTIVE_GENERATION_JOB_STATUSES_SQL = "'queued', 'processing'";
const GENERATION_JOB_TYPES_SQL =
  "'page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton'";
const GENERATION_JOB_LEDGER_SCOPE_SQL =
  '((generation_jobs.organization_id IS NULL AND credit_ledger.organization_id IS NULL AND credit_ledger.user_id = generation_jobs.user_id) OR (generation_jobs.organization_id IS NOT NULL AND credit_ledger.organization_id = generation_jobs.organization_id))';
const GENERATION_JOB_CONSUME_LEDGER_EXISTS_SQL = `EXISTS (SELECT 1 FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND credit_ledger.type = 'consume' AND ${GENERATION_JOB_LEDGER_SCOPE_SQL})`;

const DEPLOYMENT_DATA_INVARIANT_QUERIES: InvariantQuery[] = [
  {
    name: 'database.invalid_indexes',
    sql: "SELECT pg_class.relname::text AS id FROM pg_index JOIN pg_class ON pg_class.oid = pg_index.indexrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE NOT pg_index.indisvalid AND pg_namespace.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY pg_class.relname LIMIT $1",
  },
  {
    name: 'works.status',
    sql: "SELECT id::text AS id FROM works WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'chapters.status',
    sql: "SELECT id::text AS id FROM chapters WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'episodes.status',
    sql: "SELECT id::text AS id FROM episodes WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'scenes.status',
    sql: "SELECT id::text AS id FROM scenes WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'entities.status',
    sql: "SELECT id::text AS id FROM entities WHERE status NOT IN ('draft', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'reference_sets.status',
    sql: "SELECT entity_id::text AS id FROM reference_sets WHERE status NOT IN ('empty', 'partial', 'ready') ORDER BY entity_id LIMIT $1",
  },
  {
    name: 'pages.status',
    sql: "SELECT id::text AS id FROM pages WHERE status NOT IN ('designing', 'generating', 'generated', 'editing', 'confirmed') ORDER BY id LIMIT $1",
  },
  {
    name: 'pages.dialogue_mode',
    sql: "SELECT id::text AS id FROM pages WHERE dialogue_mode NOT IN ('image_baked', 'balloon_only', 'mixed') ORDER BY id LIMIT $1",
  },
  {
    name: 'pages.generation_mode',
    sql: "SELECT id::text AS id FROM pages WHERE generation_mode IS NOT NULL AND generation_mode NOT IN ('standard', 'thinking') ORDER BY id LIMIT $1",
  },
  {
    name: 'panels.panel_role',
    sql: "SELECT id::text AS id FROM panels WHERE panel_role IS NOT NULL AND panel_role NOT IN ('establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact') ORDER BY id LIMIT $1",
  },
  {
    name: 'panels.panel_size',
    sql: "SELECT id::text AS id FROM panels WHERE panel_size IS NOT NULL AND panel_size NOT IN ('standard', 'large', 'wide', 'narrow', 'splash') ORDER BY id LIMIT $1",
  },
  {
    name: 'panel_frames.border_style',
    sql: "SELECT id::text AS id FROM panel_frames WHERE border_style IS NOT NULL AND border_style NOT IN ('solid', 'dashed', 'none') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.balloon_type',
    sql: "SELECT id::text AS id FROM balloons WHERE balloon_type NOT IN ('speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.writing_mode',
    sql: "SELECT id::text AS id FROM balloons WHERE writing_mode IS NOT NULL AND writing_mode NOT IN ('vertical', 'horizontal') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.font_family',
    sql: "SELECT id::text AS id FROM balloons WHERE font_family IS NOT NULL AND font_family NOT IN ('manga_gothic', 'mincho', 'rounded', 'bold') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.job_type',
    sql: `SELECT id::text AS id FROM generation_jobs WHERE job_type NOT IN (${GENERATION_JOB_TYPES_SQL}) ORDER BY id LIMIT $1`,
  },
  {
    name: 'generation_jobs.status',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE status NOT IN ('queued', 'processing', 'completed', 'failed', 'cancelled') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.generation_mode',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE generation_mode IS NOT NULL AND generation_mode NOT IN ('standard', 'thinking') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.cancel_request_metadata_pair',
    sql: 'SELECT id::text AS id FROM generation_jobs WHERE (cancel_requested_at IS NULL) <> (cancel_requested_by IS NULL) ORDER BY id LIMIT $1',
  },
  {
    name: 'generation_jobs.active_page_resource_unique',
    sql: `SELECT MIN(id::text) AS id FROM generation_jobs WHERE job_type = 'page_generate' AND status IN (${ACTIVE_GENERATION_JOB_STATUSES_SQL}) AND params ? 'page_id' GROUP BY params->>'page_id' HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1`,
  },
  {
    name: 'generation_jobs.active_entity_resource_unique',
    sql: `SELECT MIN(id::text) AS id FROM generation_jobs WHERE job_type = 'entity_generate' AND status IN (${ACTIVE_GENERATION_JOB_STATUSES_SQL}) AND params ? 'entity_id' GROUP BY params->>'entity_id' HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1`,
  },
  {
    name: 'generation_jobs.active_episode_story_autofill_resource_unique',
    sql: `SELECT MIN(id::text) AS id FROM generation_jobs WHERE job_type = 'episode_story_autofill' AND status IN (${ACTIVE_GENERATION_JOB_STATUSES_SQL}) AND params ? 'episode_id' GROUP BY params->>'episode_id' HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1`,
  },
  {
    name: 'generation_jobs.active_episode_page_skeleton_resource_unique',
    sql: `SELECT MIN(id::text) AS id FROM generation_jobs WHERE job_type = 'episode_page_skeleton' AND status IN (${ACTIVE_GENERATION_JOB_STATUSES_SQL}) AND params ? 'episode_id' GROUP BY params->>'episode_id' HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1`,
  },
  {
    name: 'generation_jobs.failed_page_missing_refund',
    sql: `SELECT generation_jobs.id::text AS id FROM generation_jobs WHERE generation_jobs.job_type = 'page_generate' AND generation_jobs.status = 'failed' AND generation_jobs.credit_cost > 0 AND ${GENERATION_JOB_CONSUME_LEDGER_EXISTS_SQL} AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND credit_ledger.type = 'refund' AND ${GENERATION_JOB_LEDGER_SCOPE_SQL}) ORDER BY generation_jobs.id LIMIT $1`,
  },
  {
    name: 'generation_jobs.failed_entity_missing_refund',
    sql: `SELECT generation_jobs.id::text AS id FROM generation_jobs WHERE generation_jobs.job_type = 'entity_generate' AND generation_jobs.status = 'failed' AND generation_jobs.credit_cost > 0 AND ${GENERATION_JOB_CONSUME_LEDGER_EXISTS_SQL} AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND credit_ledger.type = 'refund' AND ${GENERATION_JOB_LEDGER_SCOPE_SQL}) ORDER BY generation_jobs.id LIMIT $1`,
  },
  {
    name: 'generation_jobs.failed_page_under_refunded',
    sql: `SELECT generation_jobs.id::text AS id FROM generation_jobs JOIN LATERAL (SELECT COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_amount, COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_amount FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND ${GENERATION_JOB_LEDGER_SCOPE_SQL}) ledger ON TRUE WHERE generation_jobs.job_type = 'page_generate' AND generation_jobs.status = 'failed' AND generation_jobs.credit_cost > 0 AND ABS(ledger.consumed_amount) > ledger.refunded_amount ORDER BY generation_jobs.id LIMIT $1`,
  },
  {
    name: 'generation_jobs.failed_entity_under_refunded',
    sql: `SELECT generation_jobs.id::text AS id FROM generation_jobs JOIN LATERAL (SELECT COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_amount, COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_amount FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND ${GENERATION_JOB_LEDGER_SCOPE_SQL}) ledger ON TRUE WHERE generation_jobs.job_type = 'entity_generate' AND generation_jobs.status = 'failed' AND generation_jobs.credit_cost > 0 AND ABS(ledger.consumed_amount) > ledger.refunded_amount ORDER BY generation_jobs.id LIMIT $1`,
  },
  {
    name: 'users.plan_code',
    sql: "SELECT id::text AS id FROM users WHERE plan_code NOT IN ('free', 'standard', 'premium') ORDER BY id LIMIT $1",
  },
  {
    name: 'subscriptions.plan_code',
    sql: "SELECT id::text AS id FROM subscriptions WHERE plan_code NOT IN ('free', 'standard', 'premium') ORDER BY id LIMIT $1",
  },
  {
    name: 'subscriptions.status',
    sql: "SELECT id::text AS id FROM subscriptions WHERE status NOT IN ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.store',
    sql: "SELECT id::text AS id FROM mobile_store_purchases WHERE store NOT IN ('apple', 'google') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.environment',
    sql: "SELECT id::text AS id FROM mobile_store_purchases WHERE environment NOT IN ('sandbox', 'production') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.state',
    sql: "SELECT id::text AS id FROM mobile_store_purchases WHERE state NOT IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.product_mapping',
    sql: "SELECT id::text AS id FROM mobile_store_purchases WHERE NOT ((kind = 'subscription' AND plan_code IN ('standard', 'premium') AND credit_package_code IS NULL) OR (kind = 'credit_pack' AND plan_code IS NULL AND credit_package_code IN ('credits_200', 'credits_1000', 'credits_3000'))) ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchase_events.store',
    sql: "SELECT id::text AS id FROM mobile_store_purchase_events WHERE store NOT IN ('apple', 'google') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchase_events.operation',
    sql: "SELECT id::text AS id FROM mobile_store_purchase_events WHERE operation NOT IN ('observe', 'grant', 'reverse') ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchase_events.state',
    sql: "SELECT id::text AS id FROM mobile_store_purchase_events WHERE state NOT IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed') ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.type',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE type NOT IN ('signup_bonus', 'monthly_grant', 'purchase', 'purchase_reversal', 'consume', 'refund') ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.amount_sign',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE NOT ((type IN ('consume', 'purchase_reversal') AND amount < 0) OR (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund') AND amount > 0)) ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.bucket_delta_pair',
    sql: 'SELECT id::text AS id FROM credit_ledger WHERE (monthly_delta IS NULL) <> (purchased_delta IS NULL) ORDER BY id LIMIT $1',
  },
  {
    name: 'credit_ledger.stripe_event_id_unique',
    sql: 'SELECT MIN(id::text) AS id FROM credit_ledger WHERE stripe_event_id IS NOT NULL GROUP BY stripe_event_id HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1',
  },
  {
    name: 'credit_ledger.mobile_store_event_key_unique',
    sql: 'SELECT MIN(id::text) AS id FROM credit_ledger WHERE mobile_store_event_key IS NOT NULL GROUP BY mobile_store_event_key HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1',
  },
  {
    name: 'credit_ledger.job_refund_over_consumed',
    sql: "WITH scoped_ledger AS (SELECT job_id, ABS(COALESCE(SUM(amount) FILTER (WHERE type = 'consume'), 0)) AS consumed_amount, COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0) AS refunded_amount FROM credit_ledger WHERE job_id IS NOT NULL AND organization_id IS NULL GROUP BY user_id, job_id UNION ALL SELECT job_id, ABS(COALESCE(SUM(amount) FILTER (WHERE type = 'consume'), 0)) AS consumed_amount, COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0) AS refunded_amount FROM credit_ledger WHERE job_id IS NOT NULL AND organization_id IS NOT NULL GROUP BY organization_id, job_id) SELECT job_id::text AS id FROM scoped_ledger WHERE refunded_amount > consumed_amount ORDER BY job_id LIMIT $1",
  },
  {
    name: 'payment_records.kind',
    sql: "SELECT id::text AS id FROM payment_records WHERE kind NOT IN ('subscription', 'credit_purchase') ORDER BY id LIMIT $1",
  },
  {
    name: 'payment_records.status',
    sql: "SELECT id::text AS id FROM payment_records WHERE status NOT IN ('paid', 'failed') ORDER BY id LIMIT $1",
  },
  {
    name: 'payment_records.amount_jpy',
    sql: 'SELECT id::text AS id FROM payment_records WHERE amount_jpy < 0 ORDER BY id LIMIT $1',
  },
  {
    name: 'payment_records.external_id_pair',
    sql: 'SELECT id::text AS id FROM payment_records WHERE (stripe_checkout_session_id IS NULL) = (stripe_invoice_id IS NULL) ORDER BY id LIMIT $1',
  },
  {
    name: 'payment_records.checkout_session_kind_status_unique',
    sql: 'SELECT MIN(id::text) AS id FROM payment_records WHERE stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id, kind, status HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1',
  },
  {
    name: 'payment_records.invoice_kind_status_unique',
    sql: 'SELECT MIN(id::text) AS id FROM payment_records WHERE stripe_invoice_id IS NOT NULL GROUP BY stripe_invoice_id, kind, status HAVING COUNT(*) > 1 ORDER BY MIN(id::text) LIMIT $1',
  },
];

const MOBILE_BASELINE_026_FILENAMES = [
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

const SCHEMA_026_INVARIANT_NAMES = new Set([
  'database.invalid_indexes',
  'works.status',
  'chapters.status',
  'episodes.status',
  'scenes.status',
  'entities.status',
  'reference_sets.status',
  'pages.status',
  'pages.dialogue_mode',
  'pages.generation_mode',
  'panels.panel_role',
  'panels.panel_size',
  'panel_frames.border_style',
  'balloons.balloon_type',
  'balloons.writing_mode',
  'balloons.font_family',
  'generation_jobs.job_type',
  'generation_jobs.status',
  'generation_jobs.generation_mode',
  'generation_jobs.cancel_request_metadata_pair',
  'generation_jobs.active_page_resource_unique',
  'generation_jobs.active_entity_resource_unique',
  'generation_jobs.active_episode_story_autofill_resource_unique',
  'generation_jobs.active_episode_page_skeleton_resource_unique',
  'generation_jobs.failed_page_missing_refund',
  'generation_jobs.failed_entity_missing_refund',
  'generation_jobs.failed_page_under_refunded',
  'generation_jobs.failed_entity_under_refunded',
  'users.plan_code',
  'subscriptions.plan_code',
  'subscriptions.status',
  'credit_ledger.type',
  'credit_ledger.amount_sign',
  'credit_ledger.bucket_delta_pair',
  'credit_ledger.stripe_event_id_unique',
  'credit_ledger.job_refund_over_consumed',
  'payment_records.kind',
  'payment_records.status',
  'payment_records.amount_jpy',
  'payment_records.external_id_pair',
  'payment_records.checkout_session_kind_status_unique',
  'payment_records.invoice_kind_status_unique',
]);

const MOBILE_BASELINE_026_VALUES_SQL = MOBILE_BASELINE_026_FILENAMES
  .map((filename) => `('${filename}')`)
  .join(', ');

const PRE_MOBILE_MIGRATION_INVARIANT_QUERIES: InvariantQuery[] = [
  {
    name: 'schema_migrations.mobile_baseline_026',
    sql: `WITH expected(filename) AS (VALUES ${MOBILE_BASELINE_026_VALUES_SQL}), actual(filename) AS (SELECT filename::text FROM schema_migrations), drift(id) AS (SELECT 'missing:' || expected.filename FROM expected LEFT JOIN actual USING (filename) WHERE actual.filename IS NULL UNION ALL SELECT 'unexpected:' || actual.filename FROM actual LEFT JOIN expected USING (filename) WHERE expected.filename IS NULL) SELECT id FROM drift ORDER BY id LIMIT $1`,
  },
  ...DEPLOYMENT_DATA_INVARIANT_QUERIES.filter((query) =>
    SCHEMA_026_INVARIANT_NAMES.has(query.name),
  ),
];

export async function checkDeploymentDataInvariants(
  database: DatabaseClient,
): Promise<DeploymentDataInvariantReport> {
  return checkInvariantQueries(database, DEPLOYMENT_DATA_INVARIANT_QUERIES);
}

export async function checkPreMobileMigrationDataInvariants(
  database: DatabaseClient,
): Promise<DeploymentDataInvariantReport> {
  return checkInvariantQueries(database, PRE_MOBILE_MIGRATION_INVARIANT_QUERIES);
}

async function checkInvariantQueries(
  database: DatabaseClient,
  queries: readonly InvariantQuery[],
): Promise<DeploymentDataInvariantReport> {
  const violations: DeploymentDataInvariantViolation[] = [];

  for (const query of queries) {
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
    checkedCount: queries.length,
    violations,
  };
}

async function main(): Promise<void> {
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();

  const { closeDatabasePool, db } = await import('../src/lib/db.js');

  try {
    const report = await checkDeploymentDataInvariants(db);
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
    console.error(sanitizePersistedErrorMessage(error, 'Unknown deployment invariant check error'));
    process.exitCode = 1;
  });
}
