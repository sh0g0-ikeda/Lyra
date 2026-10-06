import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessGoogleExpiryLifecycle,
  GOOGLE_EXPIRY_QUIET_WINDOW_MS,
} from './stage-google-expiry-lifecycle.mjs';

const apiStoppedAt = '2026-10-09T14:00:00.000Z';
const exact = {
  configured: true,
  schedule: { exists: true, owned: true, exact: true, state: 'DISABLED' },
  cleanupTask: { status: 'absent' },
  activeTaskCount: 0,
};

test('Google未構成は既存v1 drain経路を維持する', () => {
  assert.deepEqual(assessGoogleExpiryLifecycle({
    nowUtc: apiStoppedAt,
    state: {},
    inventory: { configured: false },
    apiStoppedAt: null,
  }), { ready: true, proofSchemaVersion: 1, nextState: {} });
});

test('一度Google構成済みになったstateはv1へdowngradeできない', () => {
  const decision = assessGoogleExpiryLifecycle({
    nowUtc: apiStoppedAt,
    state: { googleExpiryConfigured: true },
    inventory: { configured: false },
    apiStoppedAt: null,
  });
  assert.equal(decision.ready, false);
  assert.equal(decision.action, 'error-google-expiry-state');
  assert.equal(decision.proofSchemaVersion, 2);
});

test('Google構成時はexact scheduleをAPI停止前に無効化する', () => {
  const decision = assessGoogleExpiryLifecycle({
    nowUtc: apiStoppedAt,
    state: {},
    inventory: { ...exact, schedule: { ...exact.schedule, state: 'ENABLED' } },
    apiStoppedAt: null,
  });
  assert.equal(decision.action, 'disable-google-expiry-schedule');
  assert.equal(decision.ready, false);
});

test('scheduleの所有・target・readbackが不明ならfail closedする', () => {
  for (const schedule of [
    { exists: false },
    { exists: true, owned: false, exact: true, state: 'DISABLED' },
    { exists: true, owned: true, exact: false, state: 'DISABLED' },
    { exists: true, owned: true, exact: true, state: 'UNKNOWN' },
  ]) {
    assert.equal(assessGoogleExpiryLifecycle({
      nowUtc: apiStoppedAt,
      state: {},
      inventory: { ...exact, schedule },
      apiStoppedAt: null,
    }).action, 'error-google-expiry-inventory');
  }
});

test('DISABLED readbackを保存するまではAPI停止へ進めない', () => {
  const decision = assessGoogleExpiryLifecycle({
    nowUtc: apiStoppedAt,
    state: {},
    inventory: exact,
    apiStoppedAt: null,
  });
  assert.equal(decision.action, 'wait-google-expiry-disabled-readback');
  assert.equal(decision.nextState.googleExpiryScheduleDisabledAt, apiStoppedAt);
});

test('API停止後はTTLとquiet windowを過ぎるまでcleanupを起動しない', () => {
  const disabledState = { googleExpiryScheduleDisabledAt: '2026-10-09T13:59:00.000Z' };
  const beforeQuiet = new Date(Date.parse(apiStoppedAt) + GOOGLE_EXPIRY_QUIET_WINDOW_MS - 1).toISOString();
  assert.equal(assessGoogleExpiryLifecycle({
    nowUtc: beforeQuiet,
    state: disabledState,
    inventory: exact,
    apiStoppedAt,
  }).action, 'wait-google-expiry-quiet-window');
  assert.equal(assessGoogleExpiryLifecycle({
    nowUtc: new Date(Date.parse(apiStoppedAt) + GOOGLE_EXPIRY_QUIET_WINDOW_MS).toISOString(),
    state: disabledState,
    inventory: exact,
    apiStoppedAt,
  }).action, 'run-google-expiry-cleanup');
});

test('cleanup taskの完了とtask-zero確認後だけv2 proofへ進む', () => {
  const startedState = {
    googleExpiryScheduleDisabledAt: '2026-10-09T13:59:00.000Z',
    googleExpiryCleanupStartedAt: '2026-10-09T14:11:00.000Z',
  };
  assert.equal(assessGoogleExpiryLifecycle({
    nowUtc: '2026-10-09T14:12:00.000Z', state: startedState,
    inventory: { ...exact, activeTaskCount: 1, cleanupTask: { status: 'running', count: 1 } }, apiStoppedAt,
  }).action, 'wait-google-expiry-cleanup');
  assert.equal(assessGoogleExpiryLifecycle({
    nowUtc: '2026-10-09T14:12:00.000Z', state: startedState,
    inventory: { ...exact, cleanupTask: { status: 'failed', count: 0 } }, apiStoppedAt,
  }).action, 'error-google-expiry-cleanup');
  const completed = assessGoogleExpiryLifecycle({
    nowUtc: '2026-10-09T14:12:00.000Z', state: startedState,
    inventory: { ...exact, cleanupTask: { status: 'completed', count: 0, completedAtUtc: '2026-10-09T14:11:30.000Z' } }, apiStoppedAt,
  });
  assert.equal(completed.ready, true);
  assert.equal(completed.proofSchemaVersion, 2);
  assert.equal(completed.nextState.googleExpiryCleanupCompletedAt, '2026-10-09T14:11:30.000Z');
});

test('v2 proofはGoogle encrypted challenge counterを必須にする', async () => {
  const { parseStageDatabaseDrainProofRow, DATABASE_DRAIN_PROOF_QUERY_V2 } = await import('./stage-database-drain-proof.mjs');
  const { assessDatabaseDrainProof } = await import('./stage-lifecycle-guard-core.mjs');
  const observedAtUtc = '2026-10-09T15:00:00.000Z';
  const row = {
    observed_at: new Date(observedAtUtc),
    active_generation_jobs: '0',
    pending_generation_dispatches: '0',
    active_episode_export_jobs: '0',
    pending_episode_export_outbox: '0',
    active_account_deletion_requests: '0',
    pending_push_deliveries: '0',
    pending_credit_refunds: '0',
    pending_google_identity_link_challenges: '1',
  };
  assert.match(DATABASE_DRAIN_PROOF_QUERY_V2, /oauth_link_challenges/u);
  assert.match(DATABASE_DRAIN_PROOF_QUERY_V2, /exchange_material IS NOT NULL/u);
  const proof = parseStageDatabaseDrainProofRow(row, {
    stageId: 'lyra-staging-20261003',
    clusterId: 'lyra-staging-20261003-cluster',
    databaseId: 'lyra-staging-20261003-db',
  }, 2);
  assert.equal(proof.schemaVersion, 2);
  assert.deepEqual(assessDatabaseDrainProof({
    proof,
    nowEpoch: Date.parse('2026-10-09T15:01:00.000Z'),
    notBefore: '2026-10-09T14:59:00.000Z',
    expectedObservedAt: null,
    requireFresh: true,
    expectedSchemaVersion: 2,
  }), {
    ready: false,
    reason: 'nonzero',
    nonzero: ['pendingGoogleIdentityLinkChallenges'],
  });
  assert.equal(assessDatabaseDrainProof({
    proof: { ...proof, schemaVersion: 1 },
    nowEpoch: Date.parse('2026-10-09T15:01:00.000Z'),
    notBefore: '2026-10-09T14:59:00.000Z',
    expectedObservedAt: null,
    requireFresh: true,
    expectedSchemaVersion: 2,
  }).ready, false);
});

test('v2 DB contractだけがGoogle challenge列をleast-privilegeで公開する', async () => {
  const { buildStageDatabaseDrainDbContract } = await import('./stage-database-drain-db-contract.mjs');
  const v1 = buildStageDatabaseDrainDbContract('0'.repeat(64));
  const v2 = buildStageDatabaseDrainDbContract('0'.repeat(64), { proofSchemaVersion: 2 });
  assert.equal(v1.schemaVersion, 1);
  assert.doesNotMatch(v1.installSql, /oauth_link_challenges/u);
  assert.equal(v2.schemaVersion, 2);
  assert.match(v2.installSql, /GRANT SELECT \(status, exchange_material\) ON TABLE public\.oauth_link_challenges/u);
  assert.match(v2.installSql, /pending_google_identity_link_challenges text/u);
  assert.match(v2.verifySql, /oauth_link_challenges/u);
  assert.match(v2.teardownSql, /REVOKE SELECT \(status, exchange_material\) ON TABLE public\.oauth_link_challenges/u);
  assert.throws(
    () => buildStageDatabaseDrainDbContract('0'.repeat(64), { proofSchemaVersion: 3 }),
    /STAGE_DATABASE_DRAIN_SCHEMA_INVALID/u,
  );
});

test('v2 cleanup receiptはv1と異なるschema/hashへ固定される', async () => {
  const {
    assessDatabaseDrainCleanup,
    DATABASE_DRAIN_CLEANUP_SQL_SHA256_V2,
  } = await import('./stage-lifecycle-guard-core.mjs');
  const proofObservedAtUtc = '2026-10-09T15:00:00.000Z';
  const receipt = {
    kind: 'lyra-staging-db-drain-cleanup',
    schemaVersion: 2,
    stageId: 'lyra-staging-20261003',
    databaseId: 'lyra-staging-20261003-db',
    proofObservedAtUtc,
    cleanupObservedAtUtc: '2026-10-09T15:00:30.000Z',
    teardownSqlSha256: DATABASE_DRAIN_CLEANUP_SQL_SHA256_V2,
    absent: { readerRole: true, ownerRole: true, schema: true, function: true },
  };
  assert.equal(assessDatabaseDrainCleanup({
    receipt,
    nowEpoch: Date.parse('2026-10-09T15:01:00.000Z'),
    expectedProofObservedAt: proofObservedAtUtc,
    expectedCleanupObservedAt: null,
    requireFresh: true,
    expectedSchemaVersion: 2,
  }).ready, true);
  assert.equal(assessDatabaseDrainCleanup({
    receipt: { ...receipt, schemaVersion: 1 },
    nowEpoch: Date.parse('2026-10-09T15:01:00.000Z'),
    expectedProofObservedAt: proofObservedAtUtc,
    expectedCleanupObservedAt: null,
    requireFresh: true,
    expectedSchemaVersion: 2,
  }).ready, false);
});

test('one-off cleanupはintent保存後だけ実行する', async () => {
  const { performLifecycleDecision } = await import('./stage-lifecycle-effects.mjs');
  const events = [];
  await performLifecycleDecision({
    decision: {
      action: 'run-google-expiry-cleanup',
      mutates: true,
      nextState: { googleExpiryCleanupStartedAt: '2026-10-09T14:11:00.000Z' },
    },
    now: '2026-10-09T14:11:00.000Z',
    writeState: async () => events.push('write'),
    perform: async () => events.push('run'),
  });
  assert.deepEqual(events, ['write', 'run']);
});

test('v2 executor/invokeは明示schemaVersion=2だけを往復する', async () => {
  const { createHash } = await import('node:crypto');
  const { executeDatabaseDrain, DATABASE_DRAIN_EXECUTOR_QUERY } = await import('./stage-database-drain-executor.mjs');
  const { createStageDatabaseDrainInvokePort } = await import('./stage-database-drain-invoke-port.mjs');
  const cert = 'test-ca';
  const env = {
    STAGE_ID: 'lyra-staging-20261003',
    AWS_REGION: 'ap-northeast-1',
    AWS_ACCOUNT_ID: '452284481392',
    DB_HOST: 'lyra-staging-20261003-db.abc.ap-northeast-1.rds.amazonaws.com',
    DB_NAME: 'lyrastaging',
    DB_USER: 'lyra_stage_drain_reader',
    DB_PASSWORD: 'a'.repeat(64),
    RDS_CA_FILE: '/var/task/rds-ca-rsa2048-g1.pem',
    RDS_CA_SHA256: createHash('sha256').update(cert).digest('hex'),
  };
  const row = {
    observed_at: new Date('2026-10-09T15:00:00.000Z'),
    active_generation_jobs: '0', pending_generation_dispatches: '0',
    active_episode_export_jobs: '0', pending_episode_export_outbox: '0',
    active_account_deletion_requests: '0', pending_push_deliveries: '0',
    pending_credit_refunds: '0', pending_google_identity_link_challenges: '0',
  };
  const proof = await executeDatabaseDrain({
    event: { schemaVersion: 2 },
    env,
    readCaFile: async () => cert,
    createClient: () => ({
      connect: async () => {},
      query: async (sql) => sql === DATABASE_DRAIN_EXECUTOR_QUERY ? { rows: [row] } : { rows: [] },
      end: async () => {},
    }),
  });
  assert.equal(proof.schemaVersion, 2);
  const calls = [];
  const port = createStageDatabaseDrainInvokePort({
    functionArn: 'arn:aws:lambda:ap-northeast-1:452284481392:function:lyra-staging-20261003-database-drain-proof:2',
    lambda: { send: async (command) => {
      calls.push(command);
      return { StatusCode: 200, ExecutedVersion: '2', Payload: Buffer.from(JSON.stringify({ ok: true, proof })) };
    } },
    invokeCommand: (value) => value,
  });
  await port.collect({
    nowUtc: '2026-10-09T15:01:00.000Z',
    safePointAtUtc: '2026-10-09T14:59:00.000Z',
    proofSchemaVersion: 2,
  });
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].Payload).toString()), { schemaVersion: 2 });
});
