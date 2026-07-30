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
    name: 'credit_ledger.type',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE type NOT IN ('signup_bonus', 'monthly_grant', 'purchase', 'consume', 'refund') ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.amount_sign',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE NOT ((type = 'consume' AND amount < 0) OR (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund') AND amount > 0)) ORDER BY id LIMIT $1",
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
  {
    name: 'account_deletion_requests.status',
    sql: "SELECT user_id::text AS id FROM account_deletion_requests WHERE account_deletion_requests.status NOT IN ('blocked', 'processing', 'pending_external_action', 'completed') ORDER BY user_id LIMIT $1",
  },
  {
    name: 'account_deletion_requests.retry_count',
    sql: 'SELECT user_id::text AS id FROM account_deletion_requests WHERE account_deletion_requests.retry_count < 0 ORDER BY user_id LIMIT $1',
  },
  {
    name: 'account_deletion_requests.processing_claim',
    sql: 'SELECT user_id::text AS id FROM account_deletion_requests WHERE (processing_token IS NULL) <> (processing_started_at IS NULL) ORDER BY user_id LIMIT $1',
  },
];

export async function checkDeploymentDataInvariants(
  database: DatabaseClient,
): Promise<DeploymentDataInvariantReport> {
  const violations: DeploymentDataInvariantViolation[] = [];

  for (const query of DEPLOYMENT_DATA_INVARIANT_QUERIES) {
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
    checkedCount: DEPLOYMENT_DATA_INVARIANT_QUERIES.length,
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
