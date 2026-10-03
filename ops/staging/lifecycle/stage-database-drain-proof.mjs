const STAGE_ID = 'lyra-staging-20261003';
const STAGE_CLUSTER_ID = `${STAGE_ID}-cluster`;
const STAGE_DATABASE_ID = `${STAGE_ID}-db`;
const PROOF_KIND = 'lyra-staging-db-drain-proof';
const PROOF_SCHEMA_VERSION = 1;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
const MAX_STATEMENT_TIMEOUT_MS = 10_000;
const MAX_COUNTER = 1_000_000;

export const DATABASE_DRAIN_PROOF_LOG_PREFIX = 'LYRA_STAGE_DATABASE_DRAIN_PROOF ';

const RESULT_COUNTERS = Object.freeze({
  active_generation_jobs: 'activeGenerationJobs',
  pending_generation_dispatches: 'pendingGenerationDispatches',
  active_episode_export_jobs: 'activeEpisodeExportJobs',
  pending_episode_export_outbox: 'pendingEpisodeExportOutbox',
  active_account_deletion_requests: 'activeAccountDeletionRequests',
  pending_push_deliveries: 'pendingPushDeliveries',
  pending_credit_refunds: 'pendingCreditRefunds',
});

const RESULT_KEYS = Object.freeze(['observed_at', ...Object.keys(RESULT_COUNTERS)]);

export const DATABASE_DRAIN_PROOF_QUERY = `WITH
active_generation AS (
  SELECT COUNT(*)::text AS count
  FROM generation_jobs
  WHERE status IN ('queued', 'processing')
     OR (status = 'failed' AND commit_started_at IS NOT NULL)
),
pending_generation_dispatch AS (
  SELECT COUNT(*)::text AS count
  FROM generation_quotes
  WHERE dispatch_state IN ('pending', 'dispatching')
),
active_episode_export AS (
  SELECT COUNT(*)::text AS count
  FROM episode_export_jobs
  WHERE status IN ('queued', 'processing')
),
pending_episode_export_dispatch AS (
  SELECT COUNT(*)::text AS count
  FROM (
    SELECT episode_export_job_outbox.export_job_id
    FROM episode_export_job_outbox
    WHERE episode_export_job_outbox.dispatched_at IS NULL
    UNION
    SELECT episode_export_jobs.id
    FROM episode_export_jobs
    LEFT JOIN episode_export_job_outbox
      ON episode_export_job_outbox.export_job_id = episode_export_jobs.id
    WHERE episode_export_jobs.status IN ('queued', 'processing')
      AND episode_export_job_outbox.export_job_id IS NULL
  ) AS pending_export_jobs
),
active_account_deletion AS (
  SELECT COUNT(*)::text AS count
  FROM account_deletion_requests
  WHERE status <> 'completed'
),
pending_push AS (
  SELECT COUNT(*)::text AS count
  FROM (
    SELECT mobile_push_notification_deliveries.id::text AS pending_key
    FROM mobile_push_notification_deliveries
    WHERE mobile_push_notification_deliveries.status IN ('pending', 'processing')
    UNION ALL
    SELECT mobile_push_notification_outbox.id::text || ':' || mobile_push_tokens.id::text
    FROM mobile_push_notification_outbox
    INNER JOIN mobile_push_tokens
      ON mobile_push_tokens.user_id = mobile_push_notification_outbox.user_id
     AND mobile_push_tokens.created_at <= mobile_push_notification_outbox.created_at
    LEFT JOIN mobile_push_notification_deliveries
      ON mobile_push_notification_deliveries.outbox_id = mobile_push_notification_outbox.id
     AND mobile_push_notification_deliveries.push_token_id = mobile_push_tokens.id
    WHERE mobile_push_notification_deliveries.id IS NULL
  ) AS pending_push_work
),
terminal_credit_settlement AS (
  SELECT
    generation_jobs.id,
    generation_jobs.credit_cost,
    COUNT(credit_ledger.id) FILTER (WHERE credit_ledger.type = 'consume') AS consume_count,
    COUNT(credit_ledger.id) FILTER (
      WHERE credit_ledger.type = 'consume'
        AND credit_ledger.monthly_delta IS NOT NULL
        AND credit_ledger.purchased_delta IS NOT NULL
    ) AS complete_consume_count,
    COUNT(credit_ledger.id) FILTER (WHERE credit_ledger.type = 'refund') AS refund_count,
    COUNT(credit_ledger.id) FILTER (
      WHERE credit_ledger.type = 'refund'
        AND credit_ledger.monthly_delta IS NOT NULL
        AND credit_ledger.purchased_delta IS NOT NULL
    ) AS complete_refund_count,
    -COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_amount,
    -COALESCE(SUM(credit_ledger.monthly_delta) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_monthly,
    -COALESCE(SUM(credit_ledger.purchased_delta) FILTER (WHERE credit_ledger.type = 'consume'), 0) AS consumed_purchased,
    COALESCE(SUM(credit_ledger.amount) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_amount,
    COALESCE(SUM(credit_ledger.monthly_delta) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_monthly,
    COALESCE(SUM(credit_ledger.purchased_delta) FILTER (WHERE credit_ledger.type = 'refund'), 0) AS refunded_purchased
  FROM generation_jobs
  LEFT JOIN credit_ledger
    ON credit_ledger.job_id = generation_jobs.id
   AND credit_ledger.type IN ('consume', 'refund')
   AND (
     (
       generation_jobs.organization_id IS NULL
       AND credit_ledger.organization_id IS NULL
       AND credit_ledger.user_id = generation_jobs.user_id
     )
     OR (
       generation_jobs.organization_id IS NOT NULL
       AND credit_ledger.organization_id = generation_jobs.organization_id
     )
   )
  WHERE generation_jobs.status IN ('failed', 'cancelled')
    AND generation_jobs.credit_cost > 0
  GROUP BY generation_jobs.id, generation_jobs.credit_cost
),
pending_credit_settlement AS (
  SELECT COUNT(*)::text AS count
  FROM terminal_credit_settlement
  WHERE consume_count = 0
     OR complete_consume_count <> consume_count
     OR complete_refund_count <> refund_count
     OR consumed_amount <> credit_cost
     OR consumed_amount <> consumed_monthly + consumed_purchased
     OR refunded_amount <> consumed_amount
     OR refunded_amount <> refunded_monthly + refunded_purchased
)
SELECT
  clock_timestamp() AS observed_at,
  active_generation.count AS active_generation_jobs,
  pending_generation_dispatch.count AS pending_generation_dispatches,
  active_episode_export.count AS active_episode_export_jobs,
  pending_episode_export_dispatch.count AS pending_episode_export_outbox,
  active_account_deletion.count AS active_account_deletion_requests,
  pending_push.count AS pending_push_deliveries,
  pending_credit_settlement.count AS pending_credit_refunds
FROM active_generation
CROSS JOIN pending_generation_dispatch
CROSS JOIN active_episode_export
CROSS JOIN pending_episode_export_dispatch
CROSS JOIN active_account_deletion
CROSS JOIN pending_push
CROSS JOIN pending_credit_settlement`;

export async function collectStageDatabaseDrainProof(
  transactionRunner,
  identity,
  options = {},
) {
  assertIdentity(identity);
  const timeout = statementTimeout(options.statementTimeoutMs);
  return transactionRunner.transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${timeout}ms'`);
    const result = await client.query(DATABASE_DRAIN_PROOF_QUERY);
    if (!isPlainRecord(result) || !Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
    }
    return parseStageDatabaseDrainProofRow(result.rows[0], identity);
  });
}

export function parseStageDatabaseDrainProofRow(row, identity) {
  assertIdentity(identity);
  if (!isPlainRecord(row) || !hasExactKeys(row, RESULT_KEYS)) {
    throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  }
  const observedAtUtc = canonicalTimestamp(row.observed_at);
  const counters = {};
  for (const [databaseName, proofName] of Object.entries(RESULT_COUNTERS)) {
    counters[proofName] = parseCounter(row[databaseName]);
  }
  return {
    kind: PROOF_KIND,
    schemaVersion: PROOF_SCHEMA_VERSION,
    ...identity,
    observedAtUtc,
    counters,
  };
}

export function buildStageDatabaseDrainProofBunSource(input) {
  assertIdentity(input);
  const timeout = statementTimeout(input?.statementTimeoutMs);
  const databaseHost = requireDatabaseHost(input?.databaseHost, input.databaseId);
  const databaseName = requireDatabaseName(input?.databaseName);
  const serializedIdentity = JSON.stringify({
    stageId: input.stageId,
    clusterId: input.clusterId,
    databaseId: input.databaseId,
  });
  const serializedCounterMap = JSON.stringify(RESULT_COUNTERS);
  const serializedResultKeys = JSON.stringify(RESULT_KEYS);
  // ECS containerOverrides are limited to 8 KiB. Preserve the query semantics
  // while removing formatting whitespace before embedding the one-off source.
  const serializedQuery = JSON.stringify(DATABASE_DRAIN_PROOF_QUERY.replace(/\s+/gu, ' ').trim());

  return `const E=new Set(['DATABASE_URL_MISSING','DATABASE_URL_INVALID','DATABASE_HOST_MISMATCH','DATABASE_NAME_MISMATCH','DATABASE_DRAIN_PROOF_RESULT_INVALID']);
let z;
try {
  const {loadRuntimeSecretEnv:L}=await import('./dist/src/lib/runtimeSecretEnv.js');
  await L();
  const u=process.env.DATABASE_URL;
  if(typeof u!=='string'||u.length===0)throw new Error('DATABASE_URL_MISSING');
  let x;
  try{x=new URL(u);}catch{throw new Error('DATABASE_URL_INVALID');}
  if(x.protocol!=='postgres:'&&x.protocol!=='postgresql:')throw new Error('DATABASE_URL_INVALID');
  if(x.hostname.toLowerCase()!==${JSON.stringify(databaseHost)})throw new Error('DATABASE_HOST_MISMATCH');
  let n;
  try{n=decodeURIComponent(x.pathname.slice(1));}catch{throw new Error('DATABASE_URL_INVALID');}
  if(n!==${JSON.stringify(databaseName)})throw new Error('DATABASE_NAME_MISMATCH');
  const m=await import('./dist/src/lib/db.js');
  z=m.closeDatabasePool;
  const r=await m.db.transaction(async(q)=>{
    await q.query('SET TRANSACTION READ ONLY');
    await q.query(${JSON.stringify(`SET LOCAL statement_timeout = '${timeout}ms'`)});
    const s=await q.query(${serializedQuery});
    if(!s||!Array.isArray(s.rows)||s.rows.length!==1)throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
    return s.rows[0];
  });
  const e=${serializedResultKeys}.slice().sort(),a=Object.keys(r??{}).sort();
  if(a.length!==e.length||a.some((k,i)=>k!==e[i]))throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  const o=r.observed_at instanceof Date?r.observed_at:new Date(r.observed_at);
  if(!Number.isFinite(o.getTime()))throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  const c={};
  for(const [d,k] of Object.entries(${serializedCounterMap})){
    const v=r[d];
    if(typeof v!=='string'||!/^(?:0|[1-9][0-9]{0,6})$/.test(v))throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
    const n=Number(v);
    if(!Number.isSafeInteger(n)||n<0||n>${MAX_COUNTER})throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
    c[k]=n;
  }
  const p={kind:${JSON.stringify(PROOF_KIND)},schemaVersion:${PROOF_SCHEMA_VERSION},...${serializedIdentity},observedAtUtc:o.toISOString(),counters:c};
  await z();z=undefined;
  console.log(${JSON.stringify(DATABASE_DRAIN_PROOF_LOG_PREFIX)}+JSON.stringify(p));
}catch(x){
  const e=x instanceof Error&&E.has(x.message)?x.message:'DATABASE_DRAIN_PROOF_GENERATION_FAILED';
  console.error('LYRA_STAGE_DATABASE_DRAIN_PROOF_ERROR '+e);
  process.exitCode=1;
}finally{
  if(z!==undefined){try{await z();}catch{process.exitCode=1;}}
}`.replace(/\n\s*/gu, '');
}

function assertIdentity(value) {
  if (
    !isPlainRecord(value)
    || value.stageId !== STAGE_ID
    || value.clusterId !== STAGE_CLUSTER_ID
    || value.databaseId !== STAGE_DATABASE_ID
  ) {
    throw new Error('DATABASE_DRAIN_PROOF_IDENTITY_INVALID');
  }
}

function statementTimeout(value) {
  const timeout = value ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_STATEMENT_TIMEOUT_MS) {
    throw new Error('DATABASE_DRAIN_PROOF_TIMEOUT_INVALID');
  }
  return timeout;
}

function requireDatabaseHost(value, databaseId) {
  if (
    typeof value !== 'string'
    || value !== value.toLowerCase()
    || !value.startsWith(`${databaseId}.`)
    || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.rds\.amazonaws\.com$/u.test(value)
  ) {
    throw new Error('DATABASE_DRAIN_PROOF_HOST_INVALID');
  }
  return value;
}

function requireDatabaseName(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error('DATABASE_DRAIN_PROOF_DATABASE_NAME_INVALID');
  }
  return value;
}

function parseCounter(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,6})$/u.test(value)) {
    throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_COUNTER) {
    throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  }
  return parsed;
}

function canonicalTimestamp(value) {
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  const canonical = parsed.toISOString();
  if (typeof value === 'string' && value !== canonical) {
    throw new Error('DATABASE_DRAIN_PROOF_RESULT_INVALID');
  }
  return canonical;
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
