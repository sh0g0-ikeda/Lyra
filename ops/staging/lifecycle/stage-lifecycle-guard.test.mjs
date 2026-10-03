import assert from 'node:assert/strict';
import test from 'node:test';

import * as lifecycleCore from './stage-lifecycle-guard-core.mjs';

const { decideLifecycleAction, INITIAL_STATE } = lifecycleCore;

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

function sealedState(observedAt = beforeDelete) {
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
    extraOwnedDatabaseIds: [],
    runtimeStack: { exists: true, status: 'UPDATE_COMPLETE', owned: true },
    foundationStack: { exists: true, status: 'UPDATE_COMPLETE', owned: true },
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

test('database stop requires a new proof after every worker is confirmed stopped', () => {
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
    }),
  });
  assert.equal(first.action, 'wait-db-drain');
  assert.equal(first.details.reason, 'before-safe-point');
  assert.equal(first.nextState.workersStoppedAt, '2026-10-09T15:03:00.000Z');

  const proofObservedAt = '2026-10-09T15:04:00.000Z';
  const second = decideLifecycleAction({
    mode: 'active',
    now: proofObservedAt,
    state: first.nextState,
    inventory: inventory({
      scalableTarget: { exists: false },
      databaseDrainProof: drainProof(proofObservedAt),
    }),
  });
  assert.equal(second.action, 'stop-database');
  assert.equal(second.nextState.databaseDrainProofObservedAt, proofObservedAt);
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

