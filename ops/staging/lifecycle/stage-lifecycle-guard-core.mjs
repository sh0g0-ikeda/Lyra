export const RUNTIME_DELETE_AT = '2026-10-09T16:30:00.000Z';
export const GUARD_FAIL_AT = '2026-10-09T19:15:00.000Z';
export const ACTIVE_START_AT = '2026-10-08T16:10:00.000Z';
export const STAGE_ID = 'lyra-staging-20261003';
export const STAGE_CLUSTER_ID = `${STAGE_ID}-cluster`;
export const STAGE_DATABASE_ID = `${STAGE_ID}-db`;
export const STAGE_REGION = 'ap-northeast-1';
export const STAGE_ACCOUNT_ID = '452284481392';
const DRAIN_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const ZERO_OBSERVATION_INTERVAL_MS = 60 * 1000;
const DATABASE_DRAIN_PROOF_TTL_MS = 5 * 60 * 1000;
const DATABASE_DRAIN_PROOF_FUTURE_SKEW_MS = 30 * 1000;
const MAX_DATABASE_DRAIN_COUNTER = 1_000_000;
const DATABASE_DRAIN_COUNT_NAMES = Object.freeze([
  'activeGenerationJobs',
  'pendingGenerationDispatches',
  'activeEpisodeExportJobs',
  'pendingEpisodeExportOutbox',
  'activeAccountDeletionRequests',
  'pendingPushDeliveries',
  'pendingCreditRefunds',
]);

export const INITIAL_STATE = Object.freeze({
  version: 1,
  zeroStreak: 0,
  lastZeroObservedAt: null,
  apiStopRequested: false,
  apiStopRequestedAt: null,
  apiStoppedAt: null,
  scalingDeregistered: false,
  generationStopRequested: false,
  workersStoppedAt: null,
  databaseStopRequested: false,
  databaseDrainProofObservedAt: null,
  runtimeDeleteRequested: false,
  foundationDeleteRequested: false,
});

function result(action, state, details = {}) {
  return { action, mutates: !action.startsWith('wait-') && !action.startsWith('error-') && action !== 'inspect' && action !== 'success', nextState: state, details };
}

function queueTotal(queues) {
  return Object.values(queues).reduce(
    (total, queue) => total + queue.visible + queue.inflight + queue.delayed,
    0,
  );
}

function serviceStopped(service) {
  return service.desired === 0 && service.running === 0 && service.pending === 0;
}

export function decideLifecycleAction({ mode, now, state, inventory }) {
  const currentState = { ...INITIAL_STATE, ...state };
  if (mode === 'inspect') return result('inspect', currentState, { inventory });
  if (mode !== 'active') return result('error-mode', currentState, { mode });
  const nowEpoch = Date.parse(now);
  if (!Number.isFinite(nowEpoch)) return result('error-time', currentState);
  if (nowEpoch < Date.parse(ACTIVE_START_AT)) return result('wait-schedule-start', currentState);

  if (typeof inventory.proofExecutorStack?.exists !== 'boolean') return result('error-proof-executor-inventory', currentState);
  if (inventory.proofExecutorStack.exists && !inventory.proofExecutorStack.owned) return result('error-proof-executor-ownership', currentState);
  if (!inventory.foundationStack.exists) {
    if (inventory.proofExecutorStack.exists) return result('error-proof-executor-orphaned', currentState);
    const sealedProof = assessDatabaseDrainProof({
      proof: inventory.databaseDrainProof,
      nowEpoch,
      notBefore: currentState.workersStoppedAt ?? currentState.apiStoppedAt,
      expectedObservedAt: currentState.databaseDrainProofObservedAt,
      requireFresh: false,
    });
    if (
      !currentState.databaseStopRequested ||
      !currentState.runtimeDeleteRequested ||
      !currentState.foundationDeleteRequested
    ) {
      return waitForDatabaseDrain(currentState, {
        ready: false,
        reason: sealedProof.ready ? 'lifecycle-not-sealed' : sealedProof.reason,
      });
    }
    if (!sealedProof.ready) return waitForDatabaseDrain(currentState, sealedProof);
    return result('success', currentState);
  }
  if (!inventory.foundationStack.owned) return result('error-foundation-ownership', currentState);
  if (inventory.runtimeStack.exists && !inventory.runtimeStack.owned) return result('error-runtime-ownership', currentState);
  if (Date.parse(now) >= Date.parse(GUARD_FAIL_AT)) {
    return result('error-lifecycle-timeout', currentState);
  }

  if (!inventory.runtimeStack.exists && currentState.runtimeDeleteRequested) {
    const sealedProof = assessDatabaseDrainProof({
      proof: inventory.databaseDrainProof,
      nowEpoch,
      notBefore: currentState.workersStoppedAt ?? currentState.apiStoppedAt,
      expectedObservedAt: currentState.databaseDrainProofObservedAt,
      requireFresh: false,
    });
    if (!currentState.databaseStopRequested || !sealedProof.ready) {
      return waitForDatabaseDrain(currentState, sealedProof);
    }
    if (inventory.extraOwnedDatabaseIds.length > 0) {
      return result('error-m2-dependency', currentState, { databaseIds: inventory.extraOwnedDatabaseIds });
    }
    // Remove VPC Lambda ENIs/security groups before deleting their foundation VPC.
    // The DB has already been sealed and stopped, so no further proof collection is needed.
    if (inventory.proofExecutorStack.exists) {
      if (inventory.proofExecutorStack.status === 'DELETE_IN_PROGRESS') return result('wait-proof-executor-delete', currentState);
      if (inventory.proofExecutorStack.status === 'DELETE_FAILED') return result('error-proof-executor-delete', currentState);
      if (!['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(inventory.proofExecutorStack.status)) return result('error-proof-executor-status', currentState);
      return result('delete-proof-executor', currentState);
    }
    if (inventory.foundationStack.status === 'DELETE_IN_PROGRESS') {
      return result('wait-foundation-delete', currentState);
    }
    if (inventory.foundationStack.status === 'DELETE_FAILED') {
      return result('error-foundation-delete', currentState);
    }
    return result('delete-foundation', { ...currentState, foundationDeleteRequested: true });
  }

  if (currentState.foundationDeleteRequested) {
    if (inventory.foundationStack.status === 'DELETE_IN_PROGRESS') return result('wait-foundation-delete', currentState);
    if (inventory.foundationStack.status === 'DELETE_FAILED') return result('error-foundation-delete', currentState);
  }

  if (inventory.api.desired > 0) {
    return result('stop-api', {
      ...currentState,
      apiStopRequested: true,
      apiStopRequestedAt: currentState.apiStopRequestedAt ?? now,
      apiStoppedAt: null,
      zeroStreak: 0,
      lastZeroObservedAt: null,
      workersStoppedAt: null,
      databaseDrainProofObservedAt: null,
    });
  }
  if (inventory.api.running > 0 || inventory.api.pending > 0) {
    return result('wait-api-stop', {
      ...currentState,
      apiStopRequested: true,
      apiStopRequestedAt: currentState.apiStopRequestedAt ?? now,
      apiStoppedAt: null,
      zeroStreak: 0,
      lastZeroObservedAt: null,
      workersStoppedAt: null,
      databaseDrainProofObservedAt: null,
    });
  }

  const drainState = {
    ...currentState,
    apiStopRequested: true,
    apiStopRequestedAt: currentState.apiStopRequestedAt ?? now,
    apiStoppedAt: currentState.apiStoppedAt ?? now,
  };
  const totalMessages = queueTotal(inventory.queues);
  if (totalMessages > 0) {
    if (drainState.scalingDeregistered) {
      return result('error-queue-after-deregister', { ...drainState, zeroStreak: 0, lastZeroObservedAt: null }, { totalMessages });
    }
    if (Date.parse(now) - Date.parse(drainState.apiStopRequestedAt) > DRAIN_TIMEOUT_MS) {
      return result('error-drain-timeout', { ...drainState, zeroStreak: 0, lastZeroObservedAt: null }, { totalMessages });
    }
    return result('wait-drain', { ...drainState, zeroStreak: 0, lastZeroObservedAt: null }, { totalMessages });
  }

  const databaseAlreadySealed = currentState.databaseStopRequested && (
    !inventory.database.exists ||
    inventory.database.status === 'stopping' ||
    inventory.database.status === 'stopped'
  );
  if (!drainState.scalingDeregistered) {
    const preWorkerProof = assessPreWorkerProof(inventory, currentState, drainState, nowEpoch, databaseAlreadySealed);
    if (!preWorkerProof.ready) return waitForDatabaseDrain(drainState, preWorkerProof);
    if (!inventory.scalableTarget.exists) return result('error-target-missing', drainState);
    if (!inventory.scalableTarget.owned || !inventory.scalableTarget.exact) {
      return result('error-target-ownership', drainState);
    }
    const nextState = recordZeroObservation(drainState, now, nowEpoch);
    if (nextState.zeroStreak < 3) return result('wait-drain', nextState, { totalMessages: 0 });
    return result('deregister-scaling', { ...nextState, scalingDeregistered: true }, { totalMessages: 0 });
  }

  if (inventory.scalableTarget.exists) return result('error-target-still-present', currentState);
  if (inventory.generation.desired > 0) {
    const preWorkerProof = assessPreWorkerProof(inventory, currentState, drainState, nowEpoch, databaseAlreadySealed);
    if (!preWorkerProof.ready) return waitForDatabaseDrain(drainState, preWorkerProof);
    return result('stop-generation', {
      ...drainState,
      generationStopRequested: true,
      workersStoppedAt: null,
      databaseDrainProofObservedAt: null,
    });
  }

  const servicesStopped = ['api', 'generation', 'export', 'deletion']
    .every((name) => serviceStopped(inventory[name]));
  const taskCounts = readClusterTaskCounts(inventory);
  if (taskCounts === null) return result('error-task-inventory', drainState);
  if (!servicesStopped || taskCounts.unknown > 0) {
    return result('wait-services', {
      ...drainState,
      workersStoppedAt: null,
      databaseDrainProofObservedAt: null,
    }, {
      servicesStopped,
      clusterTaskCount: inventory.clusterTaskCount,
      unknownClusterTaskCount: taskCounts.unknown,
    });
  }

  const workersStoppedState = {
    ...drainState,
    workersStoppedAt: drainState.workersStoppedAt ?? now,
  };
  if (taskCounts.proof > 0) {
    return waitForDatabaseDrain(workersStoppedState, { ready: false, reason: 'proof-task-running' });
  }
  const databaseIsSealed = databaseAlreadySealed;
  const postWorkerProof = assessDatabaseDrainProof({
    proof: inventory.databaseDrainProof,
    nowEpoch,
    notBefore: workersStoppedState.workersStoppedAt,
    expectedObservedAt: databaseIsSealed ? currentState.databaseDrainProofObservedAt : null,
    requireFresh: !databaseIsSealed,
  });
  if (!postWorkerProof.ready) return waitForDatabaseDrain(workersStoppedState, postWorkerProof);

  if (inventory.database.exists) {
    if (!inventory.database.owned) return result('error-database-ownership', workersStoppedState);
    if (inventory.database.status === 'available') {
      return result('stop-database', {
        ...workersStoppedState,
        databaseStopRequested: true,
        databaseDrainProofObservedAt: postWorkerProof.observedAtUtc,
      });
    }
    if (inventory.database.status !== 'stopped') {
      return result('wait-database-stop', workersStoppedState, { status: inventory.database.status });
    }
  }

  if (!currentState.databaseStopRequested || currentState.databaseDrainProofObservedAt === null) {
    return waitForDatabaseDrain(workersStoppedState, { ready: false, reason: 'database-not-sealed' });
  }
  if (Date.parse(now) < Date.parse(RUNTIME_DELETE_AT)) return result('wait-runtime-deadline', workersStoppedState);
  if (inventory.runtimeStack.status === 'DELETE_IN_PROGRESS') return result('wait-runtime-delete', workersStoppedState);
  if (inventory.runtimeStack.status === 'DELETE_FAILED') return result('error-runtime-delete', workersStoppedState);
  return result('delete-runtime', { ...workersStoppedState, runtimeDeleteRequested: true });
}

export function assessDatabaseDrainProof({
  proof,
  nowEpoch,
  notBefore,
  expectedObservedAt,
  requireFresh,
}) {
  if (proof === null || proof === undefined) return { ready: false, reason: 'missing' };
  if (!isPlainObject(proof) || !hasExactKeys(proof, [
    'kind', 'schemaVersion', 'stageId', 'clusterId', 'databaseId', 'observedAtUtc', 'counters',
  ])) return { ready: false, reason: 'invalid-schema' };
  if (
    proof.kind !== 'lyra-staging-db-drain-proof' ||
    proof.schemaVersion !== 1 ||
    proof.stageId !== STAGE_ID ||
    proof.clusterId !== STAGE_CLUSTER_ID ||
    proof.databaseId !== STAGE_DATABASE_ID
  ) return { ready: false, reason: 'ownership' };
  if (!isPlainObject(proof.counters) || !hasExactKeys(proof.counters, DATABASE_DRAIN_COUNT_NAMES)) {
    return { ready: false, reason: 'invalid-schema' };
  }
  for (const name of DATABASE_DRAIN_COUNT_NAMES) {
    const count = proof.counters[name];
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_DATABASE_DRAIN_COUNTER) {
      return { ready: false, reason: 'invalid-schema' };
    }
  }
  if (typeof proof.observedAtUtc !== 'string') return { ready: false, reason: 'invalid-schema' };
  const observedEpoch = Date.parse(proof.observedAtUtc);
  if (!Number.isFinite(observedEpoch) || new Date(observedEpoch).toISOString() !== proof.observedAtUtc) {
    return { ready: false, reason: 'invalid-schema' };
  }
  if (typeof notBefore !== 'string' || !Number.isFinite(Date.parse(notBefore)) || observedEpoch < Date.parse(notBefore)) {
    return { ready: false, reason: 'before-safe-point' };
  }
  if (observedEpoch > nowEpoch + DATABASE_DRAIN_PROOF_FUTURE_SKEW_MS) {
    return { ready: false, reason: 'future' };
  }
  if (requireFresh && nowEpoch - observedEpoch > DATABASE_DRAIN_PROOF_TTL_MS) {
    return { ready: false, reason: 'stale' };
  }
  if (expectedObservedAt !== null && proof.observedAtUtc !== expectedObservedAt) {
    return { ready: false, reason: 'sealed-proof-mismatch' };
  }
  const nonzero = DATABASE_DRAIN_COUNT_NAMES.filter((name) => proof.counters[name] !== 0);
  if (nonzero.length > 0) return { ready: false, reason: 'nonzero', nonzero };
  return { ready: true, reason: 'ready', observedAtUtc: proof.observedAtUtc };
}

export function isCloudFormationStackNotFound(error, stackName) {
  if (
    !isPlainObject(error) ||
    error.name !== 'ValidationError' ||
    error.$metadata?.httpStatusCode !== 400 ||
    typeof error.message !== 'string'
  ) return false;
  const escapedName = escapeRegularExpression(stackName);
  return new RegExp(
    `^Stack with id (?:${escapedName}|arn:aws:cloudformation:${STAGE_REGION}:${STAGE_ACCOUNT_ID}:stack/${escapedName}/[^ ]+) does not exist$`,
    'u',
  ).test(error.message);
}

function assessPreWorkerProof(inventory, currentState, drainState, nowEpoch, databaseAlreadySealed) {
  return assessDatabaseDrainProof({
    proof: inventory.databaseDrainProof,
    nowEpoch,
    notBefore: databaseAlreadySealed
      ? currentState.workersStoppedAt ?? drainState.apiStoppedAt
      : drainState.apiStoppedAt,
    expectedObservedAt: databaseAlreadySealed ? currentState.databaseDrainProofObservedAt : null,
    requireFresh: !databaseAlreadySealed,
  });
}

function readClusterTaskCounts(inventory) {
  const total = inventory.clusterTaskCount;
  const proof = inventory.readOnlyProofTaskCount ?? 0;
  const unknown = inventory.unknownClusterTaskCount ?? total - proof;
  if (
    !Number.isSafeInteger(total) || total < 0
    || !Number.isSafeInteger(proof) || proof < 0
    || !Number.isSafeInteger(unknown) || unknown < 0
    || proof + unknown !== total
  ) return null;
  return { proof, unknown };
}

function waitForDatabaseDrain(state, assessment) {
  return result('wait-db-drain', {
    ...state,
    zeroStreak: 0,
    lastZeroObservedAt: null,
  }, {
    reason: assessment.reason,
    ...(assessment.nonzero === undefined ? {} : { nonzero: assessment.nonzero }),
  });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function recordZeroObservation(state, now, nowEpoch) {
  const previousAt = state.lastZeroObservedAt;
  if (typeof previousAt !== 'string') {
    return { ...state, zeroStreak: 1, lastZeroObservedAt: now };
  }
  const previousEpoch = Date.parse(previousAt);
  if (!Number.isFinite(previousEpoch) || nowEpoch < previousEpoch) {
    return { ...state, zeroStreak: 1, lastZeroObservedAt: now };
  }
  if (nowEpoch - previousEpoch < ZERO_OBSERVATION_INTERVAL_MS) {
    return { ...state, zeroStreak: Math.max(1, state.zeroStreak), lastZeroObservedAt: previousAt };
  }
  return { ...state, zeroStreak: Math.max(1, state.zeroStreak + 1), lastZeroObservedAt: now };
}
