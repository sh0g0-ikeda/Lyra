import assert from 'node:assert/strict';
import test from 'node:test';

import { decideLifecycleAction, INITIAL_STATE } from './stage-lifecycle-guard-core.mjs';

const beforeDelete = '2026-10-09T15:00:00.000Z';
const afterDelete = '2026-10-09T16:31:00.000Z';
const beforeScheduleStart = '2026-10-08T16:09:59.999Z';

function inventory(overrides = {}) {
  return {
    api: { desired: 0, running: 0, pending: 0 },
    generation: { desired: 0, running: 0, pending: 0 },
    export: { desired: 0, running: 0, pending: 0 },
    deletion: { desired: 0, running: 0, pending: 0 },
    clusterTaskCount: 0,
    queues: {
      generation: { visible: 0, inflight: 0, delayed: 0 },
      generationDlq: { visible: 0, inflight: 0, delayed: 0 },
      export: { visible: 0, inflight: 0, delayed: 0 },
      exportDlq: { visible: 0, inflight: 0, delayed: 0 },
    },
    scalableTarget: { exists: true, owned: true, exact: true },
    database: { exists: true, status: 'available', owned: true },
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

test('same-time zero observations cannot advance the three-observation drain gate', () => {
  const first = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: INITIAL_STATE, inventory: inventory() });
  const second = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: first.nextState, inventory: inventory() });
  const third = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: second.nextState, inventory: inventory() });
  assert.equal(second.action, 'wait-drain');
  assert.equal(third.action, 'wait-drain');
  assert.equal(third.nextState.zeroStreak, 1);
});

test('a backwards zero observation resets rather than advancing the drain gate', () => {
  const first = decideLifecycleAction({ mode: 'active', now: beforeDelete, state: INITIAL_STATE, inventory: inventory() });
  const backwards = decideLifecycleAction({
    mode: 'active',
    now: '2026-10-09T14:59:00.000Z',
    state: first.nextState,
    inventory: inventory(),
  });
  assert.equal(backwards.action, 'wait-drain');
  assert.equal(backwards.nextState.zeroStreak, 1);
  assert.equal(backwards.nextState.lastZeroObservedAt, '2026-10-09T14:59:00.000Z');
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
    }),
  });
  assert.equal(decision.action, 'wait-services');
});

test('runtime deletion cannot start before its deadline or before database stop', () => {
  const state = { ...INITIAL_STATE, zeroStreak: 3, scalingDeregistered: true, generationStopRequested: true };
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
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: true, status: 'available', owned: true } }),
  });
  assert.equal(notStopped.action, 'stop-database');
});

test('foundation deletion is blocked until runtime is absent and M2 databases are absent', () => {
  const state = { ...INITIAL_STATE, zeroStreak: 3, scalingDeregistered: true, generationStopRequested: true, runtimeDeleteRequested: true };
  const runtimePresent = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: false }, runtimeStack: { exists: true, status: 'DELETE_IN_PROGRESS', owned: true } }),
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
  const state = { ...INITIAL_STATE, zeroStreak: 3, scalingDeregistered: true, generationStopRequested: true, runtimeDeleteRequested: true };
  const decision = decideLifecycleAction({
    mode: 'active',
    now: afterDelete,
    state,
    inventory: inventory({ scalableTarget: { exists: false }, database: { exists: false }, runtimeStack: { exists: false } }),
  });
  assert.equal(decision.action, 'delete-foundation');
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

