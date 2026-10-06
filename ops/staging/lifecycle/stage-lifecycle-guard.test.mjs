import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildStageDatabaseDrainDbContract } from './stage-database-drain-db-contract.mjs';
import * as lifecycleCore from './stage-lifecycle-guard-core.mjs';

const {
  DATABASE_DRAIN_CLEANUP_SQL_SHA256,
  decideLifecycleAction,
  INITIAL_STATE,
} = lifecycleCore;

const beforeDelete = '2026-10-09T15:00:00.000Z';
const afterDelete = '2026-10-09T16:31:00.000Z';
const beforeScheduleStart = '2026-10-08T16:09:59.999Z';

const drainCountNames = [
  'activeGenerationJobs',
  'pendingGenerationDispatches',
  'activeEpisodeExportJobs',
  'pendingEpisodeExportOutbox',
  'activeAccountDeletionRequests',
  'pendingPushDeliveries',
  'pendingCreditRefunds',
];

function drainProof(observedAt = beforeDelete, countOverrides = {}, overrides = {}) {
  return {
    kind: 'lyra-staging-db-drain-proof',
    schemaVersion: 1,
    stageId: 'lyra-staging-20261003',
    clusterId: 'lyra-staging-20261003-cluster',
    databaseId: 'lyra-staging-20261003-db',
    observedAtUtc: observedAt,
    counters: Object.fromEntries(drainCountNames.map((name) => [name, countOverrides[name] ?? 0])),
    ...overrides,
  };
}

function cleanupReceipt(proofObservedAtUtc = beforeDelete, cleanupObservedAtUtc = beforeDelete, overrides = {}) {
  return {
    kind: 'lyra-staging-db-drain-cleanup',
    schemaVersion: 1,
    stageId: 'lyra-staging-20261003',
    databaseId: 'lyra-staging-20261003-db',
    proofObservedAtUtc,
    cleanupObservedAtUtc,
    teardownSqlSha256: DATABASE_DRAIN_CLEANUP_SQL_SHA256,
    absent: {
      readerRole: true,
      ownerRole: true,
      schema: true,
      function: true,
    },
    ...overrides,
  };
}

function sealedState(observedAt = beforeDelete, cleanupObservedAt = beforeDelete) {
  return {
    ...INITIAL_STATE,
    apiStopRequested: true,
    apiStopRequestedAt: '2026-10-09T14:58:00.000Z',
    apiStoppedAt: '2026-10-09T14:59:00.000Z',
    zeroStreak: 3,
    scalingDeregistered: true,
    generationStopRequested: true,
    workersStoppedAt: '2026-10-09T14:59:30.000Z',
    databaseStopRequested: true,
    databaseDrainProofObservedAt: observedAt,
    databaseContractCleanupObservedAt: cleanupObservedAt,
  };
}

function inventory(overrides = {}) {
  return {
    api: { desired: 0, running: 0, pending: 0 },
    generation: { desired: 0, running: 0, pending: 0 },
    export: { desired: 0, running: 0, pending: 0 },
    deletion: { desired: 0, running: 0, pending: 0 },
    clusterTaskCount: 0,
    readOnlyProofTaskCount: 0,
    unknownClusterTaskCount: 0,
    queues: {
      generation: { visible: 0, inflight: 0, delayed: 0 },
      generationDlq: { visible: 0, inflight: 0, delayed: 0 },
      export: { visible: 0, inflight: 0, delayed: 0 },
      exportDlq: { visible: 0, inflight: 0, delayed: 0 },
    },
    scalableTarget: { exists: true, owned: true, exact: true },
    database: { exists: true, status: 'available', owned: true },
    databaseDrainProof: drainProof(),
    databaseDrainCleanupReceipt: cleanupReceipt(),
    extraOwnedDatabaseIds: [],
    runtimeStack: { exists: true, status: 'UPDATE_COMPLETE', owned: true },
    foundationStack: { exists: true, status: 'UPDATE_COMPLETE', owned: true },
    proofExecutorStack: { exists: false },
    ...overrides,
  };
}

test('inspect mode never mutates even with a future time override', () => {
  const decision = decideLifecycleAction({
    mode: 'inspect',
    now: '2030-01-01T00:00:00.000Z',
    state: INITIAL_STATE,
    inventory: inventory(),
  });
  assert.equal(decision.action, 'inspect');
  assert.equal(decision.mutates, false);
});

test('active mode stops admission before drain work', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: beforeDelete,
    state: INITIAL_STATE,
    inventory: inventory({ api: { desired: 1, running: 1, pending: 0 } }),
  });
  assert.equal(decision.action, 'stop-api');
});

test('active mode before the configured schedule start never returns a stopping mutation', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: beforeScheduleStart,
    state: INITIAL_STATE,
    inventory: inventory({ api: { desired: 1, running: 1, pending: 0 } }),
  });
  assert.equal(decision.action, 'wait-schedule-start');
  assert.equal(decision.mutates, false);
  assert.equal(decision.nextState.apiStopRequested, false);
});

test('three consecutive all-queue-zero observations are required before deregistration', () => {
  const first = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: INITIAL_STATE, inventory: inventory() });
  assert.equal(first.action, 'wait-drain');
  assert.equal(first.nextState.zeroStreak, 1);
  const second = decideLifecycleAction({ mode: 'active', now: '2026-10-09T15:01:00.000Z', state: first.nextState, inventory: inventory() });
  assert.equal(second.action, 'wait-drain');
  assert.equal(second.nextState.zeroStreak, 2);
  const third = decideLifecycleAction({ mode: 'active', now: '2026-10-09T15:02:00.000Z', state: second.nextState, inventory: inventory() });
  assert.equal(third.action, 'deregister-scaling');
});

test('missing database drain proof blocks scaling deregistration even after three queue-zero observations', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:02:00.000Z',
    state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, zeroStreak: 2, lastZeroObservedAt: '2026-10-09T15:01:00.000Z' },
    inventory: inventory({ databaseDrainProof: null }),
  });
  assert.equal(decision.action, 'wait-db-drain');
  assert.equal(decision.mutates, false);
  assert.equal(decision.nextState.zeroStreak, 0);
});

test('stale or future database drain proof blocks scaling deregistration', () => {
  for (const observedAt of ['2026-10-09T14:50:00.000Z', '2026-10-09T15:03:00.000Z']) {
    const decision = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:02:00.000Z',
      state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, zeroStreak: 2, lastZeroObservedAt: '2026-10-09T15:01:00.000Z' },
      inventory: inventory({ databaseDrainProof: drainProof(observedAt) }),
    });
    assert.equal(decision.action, 'wait-db-drain');
  }
});

test('database drain proof must be observed after the API is confirmed at zero', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:02:00.000Z',
    state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, apiStoppedAt: '2026-10-09T15:01:00.000Z' },
    inventory: inventory({ databaseDrainProof: drainProof(beforeDelete) }),
  });
  assert.equal(decision.action, 'wait-db-drain');
  assert.equal(decision.details.reason, 'before-safe-point');
});

test('every nonzero database drain counter blocks scaling deregistration', () => {
  for (const countName of drainCountNames) {
    const decision = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:02:00.000Z',
      state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, zeroStreak: 2, lastZeroObservedAt: '2026-10-09T15:01:00.000Z' },
      inventory: inventory({ databaseDrainProof: drainProof('2026-10-09T15:02:00.000Z', { [countName]: 1 }) }),
    });
    assert.equal(decision.action, 'wait-db-drain');
    assert.equal(decision.details.reason, 'nonzero');
  }
});

test('wrong ownership or additional fields make the database drain proof invalid', () => {
  const invalidProofs = [
    drainProof('2026-10-09T15:02:00.000Z', {}, { stageId: 'other-stage' }),
    drainProof('2026-10-09T15:02:00.000Z', {}, { clusterId: 'other-cluster' }),
    drainProof('2026-10-09T15:02:00.000Z', {}, { databaseId: 'other-database' }),
    drainProof('2026-10-09T15:02:00.000Z', {}, { unexpected: true }),
    { ...drainProof('2026-10-09T15:02:00.000Z'), counters: { ...drainProof().counters, unexpected: 0 } },
  ];
  for (const databaseDrainProof of invalidProofs) {
    const decision = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:02:00.000Z',
      state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, zeroStreak: 2, lastZeroObservedAt: '2026-10-09T15:01:00.000Z' },
      inventory: inventory({ databaseDrainProof }),
    });
    assert.equal(decision.action, 'wait-db-drain');
  }
});

test('database drain counters reject negative, fractional, and unbounded values', () => {
  for (const invalidCount of [-1, 0.5, 1_000_001]) {
    const proof = drainProof('2026-10-09T15:02:00.000Z', { activeGenerationJobs: invalidCount });
    const decision = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:02:00.000Z',
      state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: beforeDelete, apiStoppedAt: beforeDelete },
      inventory: inventory({ databaseDrainProof: proof }),
    });
    assert.equal(decision.action, 'wait-db-drain');
    assert.equal(decision.details.reason, 'invalid-schema');
  }
});

test('only the exact CloudFormation stack-not-found validation is classified as absent', () => {
  const classify = lifecycleCore.isCloudFormationStackNotFound;
  const stackName = 'lyra-staging-20261003-runtime';
  assert.equal(classify?.({ name: 'ValidationError', message: `Stack with id ${stackName} does not exist`, $metadata: { httpStatusCode: 400 } }, stackName), true);
  assert.equal(classify?.({ name: 'ValidationError', message: 'Template format error: unsupported property', $metadata: { httpStatusCode: 400 } }, stackName), false);
  assert.equal(classify?.({ name: 'ValidationError', message: 'Stack with id another-stack does not exist', $metadata: { httpStatusCode: 400 } }, stackName), false);
  assert.equal(classify?.({ name: 'ValidationError', message: `Stack with id ${stackName} does not exist` }, stackName), false);
  assert.equal(classify?.({ name: 'ValidationError', message: `Stack with id arn:aws:cloudformation:us-east-1:999999999999:stack/${stackName}/deadbeef does not exist`, $metadata: { httpStatusCode: 400 } }, stackName), false);
});

test('same-time zero observations cannot advance the three-observation drain gate', () => {
  const first = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: INITIAL_STATE, inventory: inventory() });
  const second = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: first.nextState, inventory: inventory() });
  const third = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: second.nextState, inventory: inventory() });
  assert.equal(second.action, 'wait-drain');
  assert.equal(third.action, 'wait-drain');
  assert.equal(third.nextState.zeroStreak, 1);
});

test('a backwards clock cannot reuse a proof from before the confirmed API stop', () => {
  const first = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: INITIAL_STATE, inventory: inventory() });
  const backwards = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T14:59:00.000Z',
    state: first.nextState,
    inventory: inventory({ databaseDrainProof: drainProof('2026-10-09T14:59:00.000Z') }),
  });
  assert.equal(backwards.action, 'wait-db-drain');
  assert.equal(backwards.nextState.zeroStreak, 0);
  assert.equal(backwards.nextState.lastZeroObservedAt, null);
});

test('legacy state without a zero-observation timestamp resets the drain gate fail closed', () => {
  const { lastZeroObservedAt: _legacyMissingField, ...legacyState } = {
    ...INITIAL_STATE,
    zeroStreak: 2,
  };
  const decision = decideLifecycleAction({
    mode: 'active',
    now: beforeDelete,
    state: legacyState,
    inventory: inventory(),
  });
  assert.equal(decision.action, 'wait-drain');
  assert.equal(decision.nextState.zeroStreak, 1);
  assert.equal(decision.nextState.lastZeroObservedAt, beforeDelete);
});

test('any queue residue resets the drain streak and blocks deletion', () => {
  const state = { ...INITIAL_STATE, zeroStreak: 2 };
  const queues = inventory().queues;
  queues.exportDlq.visible = 1;
  const decision = decideLifecycleAction({ mode: 'active', now: afterDelete, state, inventory: inventory({ queues }) });
  assert.equal(decision.action, 'wait-drain');
  assert.equal(decision.nextState.zeroStreak, 0);
});

test('sealed proof and cleanup are discarded when any queue counter reappears', () => {
  const proofObservedAt = '2026-10-09T15:04:00.000Z';
  const cleanupObservedAt = '2026-10-09T15:04:30.000Z';
  for (const counter of ['visible', 'inflight', 'delayed']) {
    const queues = inventory().queues;
    queues.generation[counter] = 1;
    const reappeared = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:06:00.000Z',
      state: sealedState(proofObservedAt, cleanupObservedAt),
      inventory: inventory({
        queues,
        scalableTarget: { exists: false },
        databaseDrainProof: drainProof(proofObservedAt),
        databaseDrainCleanupReceipt: cleanupReceipt(proofObservedAt, cleanupObservedAt),
      }),
    });
    assert.equal(reappeared.action, 'error-queue-after-deregister');
    assert.equal(reappeared.nextState.databaseStopRequested, false);
    assert.equal(reappeared.nextState.databaseDrainProofObservedAt, null);
    assert.equal(reappeared.nextState.databaseContractCleanupObservedAt, null);

    const afterQueueClears = decideLifecycleAction({
      mode: 'active',
      now: '2026-10-09T15:20:00.000Z',
      state: reappeared.nextState,
      inventory: inventory({
        scalableTarget: { exists: false },
        databaseDrainProof: drainProof(proofObservedAt),
        databaseDrainCleanupReceipt: cleanupReceipt(proofObservedAt, cleanupObservedAt),
      }),
    });
    assert.equal(afterQueueClears.action, 'wait-db-drain');
    assert.equal(afterQueueClears.details.reason, 'stale');
  }
});
test('queue drain that exceeds the bounded window fails closed', () => {
  const queues = inventory().queues;
  queues.generation.inflight = 1;
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-08T20:11:00.000Z',
    state: { ...INITIAL_STATE, apiStopRequested: true, apiStopRequestedAt: '2026-10-08T17:10:00.000Z' },
    inventory: inventory({ queues }),
  });
  assert.equal(decision.action, 'error-drain-timeout');
  assert.equal(decision.mutates, false);
});

test('database stop waits for all four services and all cluster tasks', () => {
  const state = { ...INITIAL_STATE, zeroStreak: 3, scalingDeregistered: true };
  const decision = decideLifecycleAction({
    mode: 'active',
    now: beforeDelete,
    state,
    inventory: inventory({
      scalableTarget: { exists: false },
      export: { desired: 0, running: 1, pending: 0 },
      clusterTaskCount: 1,
      unknownClusterTaskCount: 1,
    }),
  });
  assert.equal(decision.action, 'wait-services');
});

test('database stop requires a new proof and trusted cleanup after every worker is confirmed stopped', () => {
  const state = {
    ...INITIAL_STATE,
    apiStopRequested: true,
    apiStopRequestedAt: '2026-10-09T14:58:00.000Z',
    apiStoppedAt: '2026-10-09T14:59:00.000Z',
    zeroStreak: 3,
    scalingDeregistered: true,
    generationStopRequested: true,
  };
  const first = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:03:00.000Z',
    state,
    inventory: inventory({
      scalableTarget: { exists: false },
      databaseDrainProof: drainProof('2026-10-09T15:02:00.000Z'),
      databaseDrainCleanupReceipt: null,
    }),
  });
  assert.equal(first.action, 'wait-db-drain');
  assert.equal(first.details.reason, 'before-safe-point');
  assert.equal(first.nextState.workersStoppedAt, '2026-10-09T15:03:00.000Z');

  const proofObservedAt = '2026-10-09T15:04:00.000Z';
  const withoutCleanup = decideLifecycleAction({
    mode: 'active',
    now: proofObservedAt,
    state: first.nextState,
    inventory: inventory({
      scalableTarget: { exists: false },
      databaseDrainProof: drainProof(proofObservedAt),
      databaseDrainCleanupReceipt: null,
    }),
  });
  assert.equal(withoutCleanup.action, 'wait-db-contract-cleanup');
  assert.equal(withoutCleanup.mutates, false);
  assert.equal(withoutCleanup.nextState.databaseDrainProofObservedAt, proofObservedAt);

  const delayedCleanup = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:20:00.000Z',
    state: withoutCleanup.nextState,
    inventory: inventory({
      scalableTarget: { exists: false },
      databaseDrainProof: drainProof(proofObservedAt),
      databaseDrainCleanupReceipt: null,
    }),
  });
  assert.equal(delayedCleanup.action, 'wait-db-contract-cleanup');
  assert.equal(delayedCleanup.details.reason, 'missing');

  const cleanupObservedAt = '2026-10-09T15:04:30.000Z';
  const afterCleanup = decideLifecycleAction({
    mode: 'active',
    now: cleanupObservedAt,
    state: withoutCleanup.nextState,
    inventory: inventory({
      scalableTarget: { exists: false },
      databaseDrainProof: drainProof(proofObservedAt),
      databaseDrainCleanupReceipt: cleanupReceipt(proofObservedAt, cleanupObservedAt),
    }),
  });
  assert.equal(afterCleanup.action, 'stop-database');
  assert.equal(afterCleanup.nextState.databaseDrainProofObservedAt, proofObservedAt);
  assert.equal(afterCleanup.nextState.databaseContractCleanupObservedAt, cleanupObservedAt);
});

test('cleanup receipt is exact, fresh, bound to the sealed proof, and confirms all four objects absent', () => {
  const proofObservedAt = '2026-10-09T15:04:00.000Z';
  const now = '2026-10-09T15:04:30.000Z';
  const state = {
    ...sealedState(proofObservedAt, null),
    databaseStopRequested: false,
  };
  const invalidReceipts = [
    null,
    cleanupReceipt(proofObservedAt, now, { stageId: 'production' }),
    cleanupReceipt(proofObservedAt, now, { databaseId: 'other-db' }),
    cleanupReceipt('2026-10-09T15:03:59.000Z', now),
    cleanupReceipt(proofObservedAt, now, { teardownSqlSha256: '0'.repeat(64) }),
    cleanupReceipt(proofObservedAt, '2026-10-09T15:05:01.000Z'),
    cleanupReceipt(proofObservedAt, now, { absent: { readerRole: true, ownerRole: true, schema: true, function: false } }),
    cleanupReceipt(proofObservedAt, now, { unexpected: true }),
  ];
  for (const databaseDrainCleanupReceipt of invalidReceipts) {
    const decision = decideLifecycleAction({
      mode: 'active',
      now,
      state,
      inventory: inventory({
        scalableTarget: { exists: false },
        databaseDrainProof: drainProof(proofObservedAt),
        databaseDrainCleanupReceipt,
      }),
    });
    assert.equal(decision.action, 'wait-db-contract-cleanup');
    assert.equal(decision.mutates, false);
  }
});

test('cleanup SQL hash stays bound to the audited teardown contract', () => {
  const teardownSql = buildStageDatabaseDrainDbContract('0'.repeat(64)).teardownSql;
  assert.equal(createHash('sha256').update(teardownSql).digest('hex'), DATABASE_DRAIN_CLEANUP_SQL_SHA256);
});

test('a failed StopDB can retry from sealed proof and cleanup without invoking the removed DB contract', () => {
  const proofObservedAt = '2026-10-09T15:04:00.000Z';
  const cleanupObservedAt = '2026-10-09T15:04:30.000Z';
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:06:00.000Z',
    state: sealedState(proofObservedAt, cleanupObservedAt),
    inventory: inventory({
      scalableTarget: { exists: false },
      database: { exists: true, status: 'available', owned: true },
      databaseDrainProof: drainProof(proofObservedAt),
      databaseDrainCleanupReceipt: cleanupReceipt(proofObservedAt, cleanupObservedAt),
    }),
  });
  assert.equal(decision.action, 'stop-database');
  assert.equal(decision.nextState.databaseDrainProofObservedAt, proofObservedAt);
  assert.equal(decision.nextState.databaseContractCleanupObservedAt, cleanupObservedAt);
});
test('the recorded read-only proof task preserves the worker stop safe point while it runs', () => {
  const state = {
    ...INITIAL_STATE,
    apiStopRequested: true,
    apiStopRequestedAt: '2026-10-09T14:58:00.000Z',
    apiStoppedAt: '2026-10-09T14:59:00.000Z',
    zeroStreak: 3,
    scalingDeregistered: true,
    generationStopRequested: true,
  };
  const first = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:03:00.000Z',
    state,
    inventory: inventory({
      scalableTarget: { exists: false },
      clusterTaskCount: 1,
      readOnlyProofTaskCount: 1,
      databaseDrainProof: null,
    }),
  });
  assert.equal(first.action, 'wait-db-drain');
  assert.equal(first.details.reason, 'proof-task-running');
  assert.equal(first.nextState.workersStoppedAt, '2026-10-09T15:03:00.000Z');

  const second = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:04:00.000Z',
    state: first.nextState,
    inventory: inventory({
      scalableTarget: { exists: false },
      clusterTaskCount: 1,
      readOnlyProofTaskCount: 1,
      databaseDrainProof: null,
    }),
  });
  assert.equal(second.action, 'wait-db-drain');
  assert.equal(second.nextState.workersStoppedAt, first.nextState.workersStoppedAt);
});

test('an unknown cluster task resets the worker safe point and blocks proof acceptance', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T15:04:00.000Z',
    state: {
      ...sealedState('2026-10-09T15:03:30.000Z'),
      databaseStopRequested: false,
      databaseDrainProofObservedAt: null,
    },
    inventory: inventory({
      scalableTarget: { exists: false },
      clusterTaskCount: 1,
      unknownClusterTaskCount: 1,
      databaseDrainProof: drainProof('2026-10-09T15:03:30.000Z'),
    }),
  });
  assert.equal(decision.action, 'wait-services');
  assert.equal(decision.nextState.workersStoppedAt, null);
  assert.equal(decision.nextState.databaseDrainProofObservedAt, null);
});

test('runtime and foundation deletion reject a replacement for the sealed drain proof', () => {
  const state = { ...sealedState(), runtimeDeleteRequested: true };
  const decision = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({
      database: { exists: false },
      runtimeStack: { exists: false },
      databaseDrainProof: drainProof('2026-10-09T15:00:30.000Z'),
    }),
  });
  assert.equal(decision.action, 'wait-db-drain');
  assert.equal(decision.details.reason, 'sealed-proof-mismatch');
});

test('runtime deletion cannot start before its deadline or before database stop', () => {
  const state = sealedState();
  const before = decideLifecycleAction({
    mode: 'active',
    now: beforeDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: true, status: 'stopped', owned: true } }),
  });
  assert.equal(before.action, 'wait-runtime-deadline');
  const notStopped = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state: {
      ...state,
      apiStoppedAt: '2026-10-09T16:29:00.000Z',
      workersStoppedAt: '2026-10-09T16:30:00.000Z',
      databaseStopRequested: false,
      databaseDrainProofObservedAt: null,
    },
    inventory: inventory({
      scalableTarget: { exists: false },
      database: { exists: true, status: 'available', owned: true },
      databaseDrainProof: drainProof(afterDelete),
      databaseDrainCleanupReceipt: cleanupReceipt(afterDelete, afterDelete),
    }),
  });
  assert.equal(notStopped.action, 'stop-database');
});

test('foundation deletion is blocked until runtime is absent and M2 databases are absent', () => {
  const state = { ...sealedState(), runtimeDeleteRequested: true };
  const runtimePresent = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: true, status: 'stopped', owned: true }, runtimeStack: { exists: true, status: 'DELETE_IN_PROGRESS', owned: true } }),
  });
  assert.equal(runtimePresent.action, 'wait-runtime-delete');
  const m2Present = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: false }, runtimeStack: { exists: false }, extraOwnedDatabaseIds: ['m2-rehearsal'] }),
  });
  assert.equal(m2Present.action, 'error-m2-dependency');
});

test('foundation is deleted only after runtime is absent and every guard is clear', () => {
  const state = { ...sealedState(), runtimeDeleteRequested: true };
  const decision = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: false }, runtimeStack: { exists: false } }),
  });
  assert.equal(decision.action, 'delete-foundation');
});

test('foundation absence is not success without the sealed database drain proof', () => {
  const state = {
    ...sealedState(),
    runtimeDeleteRequested: true,
    foundationDeleteRequested: true,
  };
  const missingProof = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({
      database: { exists: false },
      databaseDrainProof: null,
      runtimeStack: { exists: false },
      foundationStack: { exists: false },
    }),
  });
  assert.equal(missingProof.action, 'wait-db-drain');
  assert.equal(missingProof.details.reason, 'missing');

  const verified = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({
      database: { exists: false },
      runtimeStack: { exists: false },
      foundationStack: { exists: false },
    }),
  });
  assert.equal(verified.action, 'success');
});

test('unfinished lifecycle at final monitoring cutoff fails and cannot mutate', () => {
  const decision = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T19:15:00.000Z',
    state: INITIAL_STATE,
    inventory: inventory({ api: { desired: 1, running: 1, pending: 0 } }),
  });
  assert.equal(decision.action, 'error-lifecycle-timeout');
  assert.equal(decision.mutates, false);
});


function afterRuntimeRemoved(proofExecutorStack,overrides={}) { return decideLifecycleAction({mode:'active',now:afterDelete,state:{...sealedState(),runtimeDeleteRequested:true},inventory:inventory({runtimeStack:{exists:false},database:{exists:true,status:'stopped',owned:true},scalableTarget:{exists:false},proofExecutorStack,...overrides})}); }
test('集計Lambdaが残る場合はVPC削除より先に専用stackを削除する',()=>{assert.equal(afterRuntimeRemoved({exists:true,owned:true,status:'CREATE_COMPLETE'}).action,'delete-proof-executor');});
test('集計Lambda削除中はVPC削除を待つ',()=>{assert.equal(afterRuntimeRemoved({exists:true,owned:true,status:'DELETE_IN_PROGRESS'}).action,'wait-proof-executor-delete');});
test('集計Lambda削除失敗はVPC削除へ進めない',()=>{assert.equal(afterRuntimeRemoved({exists:true,owned:true,status:'DELETE_FAILED'}).action,'error-proof-executor-delete');});
test('集計Lambdaが自分の検証環境所有でなければ削除しない',()=>{assert.equal(afterRuntimeRemoved({exists:true,owned:false,status:'CREATE_COMPLETE'}).action,'error-proof-executor-ownership');});
test('集計Lambdaの存在確認が不明なら停止も削除も進めない',()=>{assert.equal(afterRuntimeRemoved(undefined).action,'error-proof-executor-inventory');});
test('集計Lambda不在を確認できればVPC削除へ進める',()=>{assert.equal(afterRuntimeRemoved({exists:false}).action,'delete-foundation');});
test('DBの停止証明がない場合は集計Lambdaを先に削除しない',()=>{assert.equal(afterRuntimeRemoved({exists:true,owned:true,status:'CREATE_COMPLETE'},{databaseDrainProof:null}).action,'wait-db-drain');});
test('VPC不在でも集計Lambdaが残っていれば完了と報告しない',()=>{const r=decideLifecycleAction({mode:'active',now:afterDelete,state:{...sealedState(),runtimeDeleteRequested:true,foundationDeleteRequested:true},inventory:inventory({foundationStack:{exists:false},runtimeStack:{exists:false},proofExecutorStack:{exists:true,owned:true,status:'CREATE_COMPLETE'}})});assert.equal(r.action,'error-proof-executor-orphaned');});
