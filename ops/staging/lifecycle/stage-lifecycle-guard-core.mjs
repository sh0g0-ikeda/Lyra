export const RUNTIME_DELETE_AT = '2026-10-09T16:30:00.000Z';
export const GUARD_FAIL_AT = '2026-10-09T19:15:00.000Z';
export const ACTIVE_START_AT = '2026-10-08T16:10:00.000Z';
const DRAIN_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const ZERO_OBSERVATION_INTERVAL_MS = 60 * 1000;

export const INITIAL_STATE = Object.freeze({
  version: 1,
  zeroStreak: 0,
  lastZeroObservedAt: null,
  apiStopRequested: false,
  apiStopRequestedAt: null,
  scalingDeregistered: false,
  generationStopRequested: false,
  databaseStopRequested: false,
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

  if (!inventory.foundationStack.exists) return result('success', currentState);
  if (!inventory.foundationStack.owned) return result('error-foundation-ownership', currentState);
  if (inventory.runtimeStack.exists && !inventory.runtimeStack.owned) return result('error-runtime-ownership', currentState);
  if (Date.parse(now) >= Date.parse(GUARD_FAIL_AT)) {
    return result('error-lifecycle-timeout', currentState);
  }

  if (!inventory.runtimeStack.exists && currentState.runtimeDeleteRequested) {
    if (inventory.extraOwnedDatabaseIds.length > 0) {
      return result('error-m2-dependency', currentState, { databaseIds: inventory.extraOwnedDatabaseIds });
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
      zeroStreak: 0,
      lastZeroObservedAt: null,
    });
  }
  if (inventory.api.running > 0 || inventory.api.pending > 0) {
    return result('wait-api-stop', {
      ...currentState,
      apiStopRequested: true,
      apiStopRequestedAt: currentState.apiStopRequestedAt ?? now,
      zeroStreak: 0,
      lastZeroObservedAt: null,
    });
  }

  const drainState = {
    ...currentState,
    apiStopRequested: true,
    apiStopRequestedAt: currentState.apiStopRequestedAt ?? now,
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

  if (!drainState.scalingDeregistered) {
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
    return result('stop-generation', { ...currentState, generationStopRequested: true });
  }

  const servicesStopped = ['api', 'generation', 'export', 'deletion']
    .every((name) => serviceStopped(inventory[name]));
  if (!servicesStopped || inventory.clusterTaskCount > 0) {
    return result('wait-services', currentState, {
      servicesStopped,
      clusterTaskCount: inventory.clusterTaskCount,
    });
  }

  if (inventory.database.exists) {
    if (!inventory.database.owned) return result('error-database-ownership', currentState);
    if (inventory.database.status === 'available') {
      return result('stop-database', { ...currentState, databaseStopRequested: true });
    }
    if (inventory.database.status !== 'stopped') {
      return result('wait-database-stop', currentState, { status: inventory.database.status });
    }
  }

  if (Date.parse(now) < Date.parse(RUNTIME_DELETE_AT)) return result('wait-runtime-deadline', currentState);
  if (inventory.runtimeStack.status === 'DELETE_IN_PROGRESS') return result('wait-runtime-delete', currentState);
  if (inventory.runtimeStack.status === 'DELETE_FAILED') return result('error-runtime-delete', currentState);
  return result('delete-runtime', { ...currentState, runtimeDeleteRequested: true });
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
