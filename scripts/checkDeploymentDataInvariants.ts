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
    name: 'generation_jobs.cancelled_chargeable_under_refunded',
    sql: `SELECT generation_jobs.id::text AS id FROM generation_jobs JOIN LATERAL (SELECT COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_amount, COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_amount FROM credit_ledger WHERE credit_ledger.job_id = generation_jobs.id AND ${GENERATION_JOB_LEDGER_SCOPE_SQL}) ledger ON TRUE WHERE generation_jobs.status = 'cancelled' AND generation_jobs.credit_cost > 0 AND ABS(ledger.consumed_amount) > ledger.refunded_amount ORDER BY generation_jobs.id LIMIT $1`,
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
  {
    name: 'account_deletion_requests.identity_key',
    sql: 'SELECT user_id::text AS id FROM account_deletion_requests WHERE /* account_deletion_requests.identity_key */ identity_key IS NOT NULL AND char_length(identity_key) <> 43 ORDER BY user_id LIMIT $1',
  },
  {
    name: 'users.account_deletion_timestamps',
    sql: 'SELECT id::text AS id FROM users WHERE /* users.account_deletion_timestamps */ account_deleted_at IS NOT NULL AND (account_deletion_started_at IS NULL OR account_deleted_at < account_deletion_started_at) ORDER BY id LIMIT $1',
  },
  {
    name: 'account_deletion_requests.completed_scrub',
    sql: "SELECT user_id::text AS id FROM account_deletion_requests WHERE /* account_deletion_requests.completed_scrub */ status = 'completed' AND (identity_key IS NULL OR identity_id <> 'deleted:' || user_id::text OR cardinality(cancelled_subscription_ids) <> 0 OR cardinality(scheduled_asset_keys) <> 0 OR data_anonymized_at IS NULL OR identity_deleted_at IS NULL OR completed_at IS NULL OR processing_token IS NOT NULL OR processing_started_at IS NOT NULL) ORDER BY user_id LIMIT $1",
  },
  {
    name: 'account_deletion_requests.user_anchor',
    sql: "SELECT requests.user_id::text AS id FROM account_deletion_requests AS requests INNER JOIN users ON users.id = requests.user_id WHERE /* account_deletion_requests.user_anchor */ (requests.status IN ('processing', 'pending_external_action', 'completed') AND users.account_deletion_started_at IS NULL) OR (requests.status = 'completed' AND users.account_deleted_at IS NULL) ORDER BY requests.user_id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.enum_contract',
    sql: "SELECT id::text AS id FROM mobile_store_purchases WHERE /* mobile_store_purchases.enum_contract */ store NOT IN ('apple', 'google') OR environment NOT IN ('sandbox', 'production') OR kind NOT IN ('subscription', 'credit_pack') OR state NOT IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed') OR (kind = 'subscription' AND (plan_code IS NULL OR plan_code NOT IN ('standard', 'premium') OR credit_package_code IS NOT NULL)) OR (kind = 'credit_pack' AND (plan_code IS NOT NULL OR credit_package_code IS NULL OR credit_package_code NOT IN ('credits_200', 'credits_1000', 'credits_3000'))) ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_store_purchases.key_shape',
    sql: 'SELECT id::text AS id FROM mobile_store_purchases WHERE /* mobile_store_purchases.key_shape */ char_length(external_purchase_key) <> 43 OR (transaction_key IS NOT NULL AND char_length(transaction_key) <> 43) ORDER BY id LIMIT $1',
  },
  {
    name: 'mobile_store_purchases.credit_totals',
    sql: 'SELECT id::text AS id FROM mobile_store_purchases WHERE /* mobile_store_purchases.credit_totals */ granted_credits < 0 OR reversed_credits < 0 OR reversed_credits > granted_credits ORDER BY id LIMIT $1',
  },
  {
    name: 'mobile_store_purchase_events.contract',
    sql: "SELECT id::text AS id FROM mobile_store_purchase_events WHERE /* mobile_store_purchase_events.contract */ store NOT IN ('apple', 'google') OR operation NOT IN ('observe', 'grant', 'reverse') OR state NOT IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed') OR char_length(event_key) <> 43 OR (transaction_key IS NOT NULL AND char_length(transaction_key) <> 43) OR char_length(provider_event_type) NOT BETWEEN 1 AND 255 OR jsonb_typeof(metadata) <> 'object' ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.mobile_store_event_key',
    sql: 'SELECT id::text AS id FROM credit_ledger WHERE /* credit_ledger.mobile_store_event_key */ mobile_store_event_key IS NOT NULL AND char_length(mobile_store_event_key) <> 43 ORDER BY id LIMIT $1',
  },
  {
    name: 'entity_reference_upload_tokens.contract',
    sql: "SELECT id::text AS id FROM entity_reference_upload_tokens WHERE /* entity_reference_upload_tokens.contract */ token_hash !~ '^[0-9a-f]{64}$' OR purpose <> 'entity_reference_import' OR mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp') OR size_bytes <= 0 OR size_bytes > 5242880 OR s3_key NOT LIKE ('tmp/' || user_id::text || '/entities/imports/%') OR char_length(s3_key) > 1024 OR expires_at <= created_at OR expires_at > created_at + INTERVAL '10 minutes' OR consumed_at < created_at OR consumed_at > expires_at OR NOT ((mime_type = 'image/jpeg' AND s3_key LIKE '%.jpeg') OR (mime_type = 'image/png' AND s3_key LIKE '%.png') OR (mime_type = 'image/webp' AND s3_key LIKE '%.webp')) ORDER BY id LIMIT $1",
  },
  {
    name: 'entity_reference_upload_tokens.entity_scope',
    sql: 'SELECT upload_tokens.id::text AS id FROM entity_reference_upload_tokens AS upload_tokens INNER JOIN entities ON entities.id = upload_tokens.entity_id INNER JOIN works ON works.id = entities.work_id WHERE /* entity_reference_upload_tokens.entity_scope */ upload_tokens.entity_id IS NOT NULL AND ((upload_tokens.organization_id IS NULL AND (works.organization_id IS NOT NULL OR works.user_id <> upload_tokens.user_id)) OR (upload_tokens.organization_id IS NOT NULL AND works.organization_id IS DISTINCT FROM upload_tokens.organization_id)) ORDER BY upload_tokens.id LIMIT $1',
  },
  {
    name: 'episode_export_jobs.contract',
    sql: "SELECT id::text AS id FROM episode_export_jobs WHERE /* episode_export_jobs.contract */ request_fingerprint !~ '^[0-9a-f]{64}$' OR cardinality(page_ids) NOT BETWEEN 1 AND 100 OR array_position(page_ids, NULL) IS NOT NULL OR NOT (CASE WHEN jsonb_typeof(page_snapshot) = 'array' THEN jsonb_array_length(page_snapshot) = cardinality(page_ids) ELSE FALSE END) OR expires_at <= created_at OR expires_at > created_at + INTERVAL '24 hours' OR artifact_size_bytes > 134217728 OR (status = 'completed' AND (artifact_s3_key IS DISTINCT FROM ('exports/' || COALESCE(organization_id::text, user_id::text) || '/episodes/' || episode_id::text || '/' || id::text || '.' || format) OR artifact_mime_type IS DISTINCT FROM CASE format WHEN 'pdf' THEN 'application/pdf' WHEN 'zip' THEN 'application/zip' END OR artifact_size_bytes IS NULL OR artifact_size_bytes <= 0 OR completed_at IS NULL OR completed_at >= expires_at)) OR (status <> 'completed' AND (artifact_s3_key IS NOT NULL OR artifact_mime_type IS NOT NULL OR artifact_size_bytes IS NOT NULL OR artifact_deleted_at IS NOT NULL)) OR artifact_deleted_at < expires_at ORDER BY id LIMIT $1",
  },
  {
    name: 'episode_export_jobs.scope',
    sql: 'SELECT export_jobs.id::text AS id FROM episode_export_jobs AS export_jobs INNER JOIN episodes ON episodes.id = export_jobs.episode_id INNER JOIN chapters ON chapters.id = episodes.chapter_id INNER JOIN works ON works.id = chapters.work_id WHERE /* episode_export_jobs.scope */ (export_jobs.organization_id IS NULL AND (works.organization_id IS NOT NULL OR works.user_id <> export_jobs.user_id)) OR (export_jobs.organization_id IS NOT NULL AND works.organization_id IS DISTINCT FROM export_jobs.organization_id) ORDER BY export_jobs.id LIMIT $1',
  },
  {
    name: 'episode_export_jobs.processing_lease',
    sql: "SELECT id::text AS id FROM episode_export_jobs WHERE /* episode_export_jobs.processing_lease */ attempt_count NOT BETWEEN 0 AND 100 OR (status = 'processing' AND (processing_lease_token IS NULL OR processing_lease_expires_at IS NULL OR last_heartbeat_at IS NULL OR started_at IS NULL OR last_heartbeat_at < started_at OR processing_lease_expires_at <= last_heartbeat_at OR processing_lease_expires_at > last_heartbeat_at + INTERVAL '30 minutes')) OR (status <> 'processing' AND (processing_lease_token IS NOT NULL OR processing_lease_expires_at IS NOT NULL OR last_heartbeat_at IS NOT NULL)) ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_push_tokens.protection',
    sql: "SELECT id::text AS id FROM mobile_push_tokens WHERE /* mobile_push_tokens.protection */ platform NOT IN ('ios', 'android') OR locale NOT IN ('ja', 'en') OR token_hash !~ '^[0-9a-f]{64}$' OR char_length(token_ciphertext) NOT BETWEEN 64 AND 16384 OR token_ciphertext !~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22}$' OR encryption_key_id !~ '^[A-Za-z0-9._:-]{1,64}$' OR updated_at < created_at ORDER BY id LIMIT $1",
  },
  {
    name: 'mobile_push_notification_outbox.job_scope',
    sql: 'SELECT outbox.id::text AS id FROM mobile_push_notification_outbox AS outbox INNER JOIN generation_jobs ON generation_jobs.id = outbox.generation_job_id WHERE /* mobile_push_notification_outbox.job_scope */ outbox.user_id <> generation_jobs.user_id OR outbox.organization_id IS DISTINCT FROM generation_jobs.organization_id ORDER BY outbox.id LIMIT $1',
  },
  {
    name: 'mobile_push_notification_outbox.retry_snapshot',
    sql: 'SELECT outbox.id::text AS id FROM mobile_push_notification_outbox AS outbox INNER JOIN generation_jobs ON generation_jobs.id = outbox.generation_job_id WHERE /* mobile_push_notification_outbox.retry_snapshot */ outbox.generation_retry_count < 0 OR outbox.generation_retry_count > generation_jobs.retry_count ORDER BY outbox.id LIMIT $1',
  },
  {
    name: 'mobile_push_notification_deliveries.token_scope',
    sql: 'SELECT deliveries.id::text AS id FROM mobile_push_notification_deliveries AS deliveries INNER JOIN mobile_push_notification_outbox AS outbox ON outbox.id = deliveries.outbox_id INNER JOIN mobile_push_tokens ON mobile_push_tokens.id = deliveries.push_token_id WHERE /* mobile_push_notification_deliveries.token_scope */ deliveries.push_token_id IS NOT NULL AND mobile_push_tokens.user_id <> outbox.user_id ORDER BY deliveries.id LIMIT $1',
  },
  {
    name: 'mobile_push_notification_deliveries.terminal_snapshot',
    sql: "SELECT deliveries.id::text AS id FROM mobile_push_notification_deliveries AS deliveries INNER JOIN mobile_push_notification_outbox AS outbox ON outbox.id = deliveries.outbox_id INNER JOIN generation_jobs ON generation_jobs.id = outbox.generation_job_id WHERE /* mobile_push_notification_deliveries.terminal_snapshot */ deliveries.status IN ('pending', 'processing') AND (generation_jobs.status IS DISTINCT FROM outbox.terminal_status OR generation_jobs.retry_count IS DISTINCT FROM outbox.generation_retry_count OR generation_jobs.cancel_requested_at IS NOT NULL OR generation_jobs.cancelled_at IS NOT NULL) ORDER BY deliveries.id LIMIT $1",
  },
  {
    name: 'generation_jobs.cancellation_contract',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE /* generation_jobs.cancellation_contract */ (cancel_requested_at IS NULL) <> (cancel_requested_by IS NULL) OR cancel_requested_at < created_at OR commit_started_at < created_at OR (cancel_requested_at IS NOT NULL AND commit_started_at IS NOT NULL) OR (status = 'cancelled' AND (cancel_requested_at IS NULL OR cancel_requested_by IS NULL OR cancelled_at IS NULL OR completed_at IS NULL OR commit_started_at IS NOT NULL OR cancelled_at < cancel_requested_at OR completed_at < cancelled_at)) OR (status <> 'cancelled' AND cancelled_at IS NOT NULL) ORDER BY id LIMIT $1",
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
