import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  buildStageDatabaseDrainProofBunSource,
  collectStageDatabaseDrainProof,
  DATABASE_DRAIN_PROOF_LOG_PREFIX,
  DATABASE_DRAIN_PROOF_QUERY,
  parseStageDatabaseDrainProofRow,
} from './stage-database-drain-proof.mjs';
import { assessDatabaseDrainProof } from './stage-lifecycle-guard-core.mjs';

const identity = Object.freeze({
  stageId: 'lyra-staging-20261003',
  clusterId: 'lyra-staging-20261003-cluster',
  databaseId: 'lyra-staging-20261003-db',
});

const zeroRow = Object.freeze({
  observed_at: new Date('2026-10-09T15:00:00.000Z'),
  active_generation_jobs: '0',
  pending_generation_dispatches: '0',
  active_episode_export_jobs: '0',
  pending_episode_export_outbox: '0',
  active_account_deletion_requests: '0',
  pending_push_deliveries: '0',
  pending_credit_refunds: '0',
});

test('collector sets a short read-only transaction before the single aggregate query', async () => {
  const statements = [];
  const database = {
    async transaction(work) {
      return work({
        async query(sql) {
          statements.push(sql);
          return sql === DATABASE_DRAIN_PROOF_QUERY ? { rows: [zeroRow] } : { rows: [] };
        },
      });
    },
  };

  const proof = await collectStageDatabaseDrainProof(database, identity, { statementTimeoutMs: 4_000 });

  assert.deepEqual(statements, [
    'SET TRANSACTION READ ONLY',
    "SET LOCAL statement_timeout = '4000ms'",
    DATABASE_DRAIN_PROOF_QUERY,
  ]);
  assert.deepEqual(proof, {
    kind: 'lyra-staging-db-drain-proof',
    schemaVersion: 1,
    ...identity,
    observedAtUtc: '2026-10-09T15:00:00.000Z',
    counters: {
      activeGenerationJobs: 0,
      pendingGenerationDispatches: 0,
      activeEpisodeExportJobs: 0,
      pendingEpisodeExportOutbox: 0,
      activeAccountDeletionRequests: 0,
      pendingPushDeliveries: 0,
      pendingCreditRefunds: 0,
    },
  });
  assert.deepEqual(
    assessDatabaseDrainProof({
      proof,
      nowEpoch: Date.parse('2026-10-09T15:01:00.000Z'),
      notBefore: '2026-10-09T14:59:00.000Z',
      expectedObservedAt: null,
      requireFresh: true,
    }),
    { ready: true, reason: 'ready', observedAtUtc: proof.observedAtUtc },
  );
});

test('strict result parser rejects extra, missing, malformed, and unbounded count fields', () => {
  const invalidRows = [
    { ...zeroRow, extra: '0' },
    Object.fromEntries(Object.entries(zeroRow).filter(([name]) => name !== 'pending_push_deliveries')),
    { ...zeroRow, pending_push_deliveries: '-1' },
    { ...zeroRow, pending_push_deliveries: '0.5' },
    { ...zeroRow, pending_push_deliveries: '1000001' },
    { ...zeroRow, observed_at: 'not-a-date' },
    { ...zeroRow, observed_at: 0 },
  ];
  for (const row of invalidRows) {
    assert.throws(() => parseStageDatabaseDrainProofRow(row, identity));
  }
});

test('Bun override source guards the exact stage database and emits only the prefixed proof JSON', () => {
  const source = buildStageDatabaseDrainProofBunSource({
    ...identity,
    databaseHost: 'lyra-staging-20261003-db.example.ap-northeast-1.rds.amazonaws.com',
    databaseName: 'lyrastaging',
    statementTimeoutMs: 4_000,
  });

  assert.match(source, /dist\/src\/lib\/runtimeSecretEnv\.js/u);
  assert.match(source, /dist\/src\/lib\/db\.js/u);
  assert.match(source, /SET TRANSACTION READ ONLY/u);
  assert.match(source, /SET LOCAL statement_timeout = '4000ms'/u);
  assert.match(source, new RegExp(DATABASE_DRAIN_PROOF_LOG_PREFIX, 'u'));
  assert.match(source, /DATABASE_HOST_MISMATCH/u);
  assert.match(source, /DATABASE_NAME_MISMATCH/u);
  assert.doesNotMatch(source, /@aws-sdk|PutObject|GetSecretValueCommand/u);
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(source));
  assert.throws(() => buildStageDatabaseDrainProofBunSource({
    ...identity,
    databaseHost: 'production.example.invalid',
    databaseName: 'lyrastaging',
  }));
});

const databaseUrl = process.env.DATABASE_URL;
const runPostgres = process.env.APP_ENV === 'test'
  && typeof databaseUrl === 'string'
  && /^postgres(?:ql)?:\/\/[^/]+@(?:127\.0\.0\.1|localhost):15433\/lyra_test(?:[?]|$)/u.test(databaseUrl);

test('schema 047 fixtures produce the exact seven fail-closed counters without persisting data', {
  skip: !runPostgres,
  timeout: 30_000,
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const ids = Array.from({ length: 40 }, () => randomUUID());
  const [
    owner, deletionOwnerA, deletionOwnerB, organizationA, organizationB,
    activeQueued, activeProcessing, uncertainFailed, quotedJob, completedPushJob,
    settledFailed, pendingCancelled, missingConsumeFailed, incompleteBucketsFailed,
    workId, chapterId, episodeId, exportA, exportB,
    pushTokenA, pushTokenB, pushOutbox, pushDelivery,
  ] = ids;
  try {
    await client.query('BEGIN');
    const baselineResult = await client.query(DATABASE_DRAIN_PROOF_QUERY);
    const baseline = parseStageDatabaseDrainProofRow(baselineResult.rows[0], identity);
    await client.query(
      `INSERT INTO users (id,supabase_id,email) VALUES
       ($1::uuid,$1::text,$2),($3::uuid,$3::text,$4),($5::uuid,$5::text,$6)`,
      [owner, `${owner}@example.invalid`, deletionOwnerA, `${deletionOwnerA}@example.invalid`, deletionOwnerB, `${deletionOwnerB}@example.invalid`],
    );
    await client.query(
      `INSERT INTO organizations (id,name,created_by_user_id) VALUES ($1,'Drain A',$3),($2,'Drain B',$3)`,
      [organizationA, organizationB, owner],
    );

    const insertJob = async (jobId, status, creditCost, organizationId = null, commitStarted = false) => {
      await client.query(
        `INSERT INTO generation_jobs
          (id,user_id,organization_id,job_type,status,generation_mode,credit_cost,params,commit_started_at,completed_at)
         VALUES ($1,$2,$3,'page_generate',$4,'standard',$5,$6::jsonb,
           CASE WHEN $7 THEN NOW() ELSE NULL END,
           CASE WHEN $4 IN ('completed','failed') THEN NOW() ELSE NULL END)`,
        [jobId, owner, organizationId, status, creditCost, JSON.stringify({ page_id: randomUUID() }), commitStarted],
      );
    };
    await insertJob(activeQueued, 'queued', 0);
    await insertJob(activeProcessing, 'processing', 0, organizationA);
    await insertJob(uncertainFailed, 'failed', 0, null, true);
    await insertJob(quotedJob, 'queued', 0);
    await insertJob(completedPushJob, 'completed', 0);
    await insertJob(settledFailed, 'failed', 4);
    await insertJob(pendingCancelled, 'failed', 4, organizationA);
    await insertJob(missingConsumeFailed, 'failed', 3);
    await insertJob(incompleteBucketsFailed, 'failed', 2);

    await client.query(
      `INSERT INTO generation_quotes
        (id,token_hash,user_id,operation,target_id,request,plan,expires_at,accepted_job_id,request_key,accepted_at,dispatch_state)
       VALUES ($1,$2,$3,'page_generate',$4,'{}'::jsonb,'{}'::jsonb,NOW()+INTERVAL '5 minutes',$5,$6,NOW(),'pending')`,
      [randomUUID(), randomUUID().replaceAll('-', '').repeat(2), owner, randomUUID(), quotedJob, randomUUID()],
    );

    await client.query("INSERT INTO works(id,user_id,title) VALUES($1,$2,'Drain proof')", [workId, owner]);
    await client.query('INSERT INTO chapters(id,work_id,"order") VALUES($1,$2,1)', [chapterId, workId]);
    await client.query('INSERT INTO episodes(id,chapter_id,"order") VALUES($1,$2,1)', [episodeId, chapterId]);
    for (const [index, exportId] of [exportA, exportB].entries()) {
      await client.query(
        `INSERT INTO episode_export_jobs
          (id,user_id,episode_id,format,filename,page_ids,page_snapshot,request_fingerprint,idempotency_key,expires_at)
         VALUES($1,$2,$3,'pdf',$4,ARRAY[$5::uuid],'[{}]'::jsonb,$6,$7,NOW()+INTERVAL '1 hour')`,
        [exportId, owner, episodeId, `drain-${index}.pdf`, randomUUID(), `${index + 1}`.repeat(64), `drain-key-${index}`],
      );
    }
    await client.query(
      'INSERT INTO episode_export_job_outbox(export_job_id) VALUES($1)',
      [exportA],
    );

    await client.query(
      `INSERT INTO account_deletion_requests(user_id,identity_id,status)
       VALUES($1,$2,'blocked'),($3,$4,'pending_external_action')`,
      [deletionOwnerA, `identity-${deletionOwnerA}`, deletionOwnerB, `identity-${deletionOwnerB}`],
    );

    const tokenCiphertext = `v1.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`;
    for (const tokenId of [pushTokenA, pushTokenB]) {
      await client.query(
        `INSERT INTO mobile_push_tokens
          (id,user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id)
         VALUES($1,$2,$3,'android','ja',$4,$5,'drain-test')`,
        [tokenId, owner, randomUUID(), tokenId.replaceAll('-', '').repeat(2), tokenCiphertext],
      );
    }
    await client.query(
      `INSERT INTO mobile_push_notification_outbox
        (id,generation_job_id,user_id,terminal_status,generation_retry_count)
       VALUES($1,$2,$3,'completed',0)`,
      [pushOutbox, completedPushJob, owner],
    );
    await client.query(
      `INSERT INTO mobile_push_notification_deliveries(id,outbox_id,push_token_id)
       VALUES($1,$2,$3)`,
      [pushDelivery, pushOutbox, pushTokenA],
    );

    const ledger = async (jobId, organizationId, type, amount, monthlyDelta, purchasedDelta) => {
      await client.query(
        `INSERT INTO credit_ledger
          (user_id,organization_id,type,amount,monthly_after,purchased_after,job_id,monthly_delta,purchased_delta)
         VALUES($1,$2,$3,$4,0,0,$5,$6,$7)`,
        [owner, organizationId, type, amount, jobId, monthlyDelta, purchasedDelta],
      );
    };
    await ledger(settledFailed, null, 'consume', -4, 0, -4);
    await ledger(settledFailed, null, 'refund', 4, 0, 4);
    await ledger(pendingCancelled, organizationA, 'consume', -4, -1, -3);
    await ledger(pendingCancelled, organizationA, 'refund', 2, 0, 2);
    await ledger(pendingCancelled, organizationB, 'refund', 2, 0, 2);
    await client.query(
      `UPDATE generation_jobs SET status='cancelled',cancel_requested_at=NOW(),cancel_requested_by=$2,
       cancelled_at=NOW(),completed_at=NOW() WHERE id=$1`,
      [pendingCancelled, owner],
    );
    await ledger(incompleteBucketsFailed, null, 'consume', -2, null, null);
    await ledger(incompleteBucketsFailed, null, 'refund', 2, null, null);

    const result = await client.query(DATABASE_DRAIN_PROOF_QUERY);
    const proof = parseStageDatabaseDrainProofRow(result.rows[0], identity);
    const fixtureDelta = {
      activeGenerationJobs: 4,
      pendingGenerationDispatches: 1,
      activeEpisodeExportJobs: 2,
      pendingEpisodeExportOutbox: 2,
      activeAccountDeletionRequests: 2,
      pendingPushDeliveries: 2,
      pendingCreditRefunds: 3,
    };
    assert.deepEqual(
      proof.counters,
      Object.fromEntries(Object.entries(fixtureDelta).map(([name, count]) => [
        name,
        baseline.counters[name] + count,
      ])),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
