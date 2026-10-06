const GOOGLE_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_EXPIRY_DELAYED_START_QUIET_MS = 60 * 1000;
export const GOOGLE_EXPIRY_QUIET_WINDOW_MS = GOOGLE_CHALLENGE_TTL_MS + GOOGLE_EXPIRY_DELAYED_START_QUIET_MS;

export function assessGoogleExpiryLifecycle({
  nowUtc,
  state,
  inventory,
  apiStoppedAt,
}) {
  if (!isCanonicalTimestamp(nowUtc) || !isPlainRecord(state) || !isPlainRecord(inventory)) {
    return failure(state, 'error-google-expiry-inventory');
  }
  if (inventory.configured === false) {
    if (state.googleExpiryConfigured === true) return failure(state, 'error-google-expiry-state');
    return { ready: true, proofSchemaVersion: 1, nextState: state };
  }
  if (inventory.configured !== true || !validSchedule(inventory.schedule)) {
    return failure(state, 'error-google-expiry-inventory');
  }
  if (inventory.schedule.state === 'ENABLED') {
    return {
      ready: false,
      action: 'disable-google-expiry-schedule',
      proofSchemaVersion: 2,
      nextState: state,
    };
  }
  if (inventory.schedule.state !== 'DISABLED') {
    return failure(state, 'error-google-expiry-inventory');
  }

  if (state.googleExpiryScheduleDisabledAt === undefined || state.googleExpiryScheduleDisabledAt === null) {
    return {
      ready: false,
      action: 'wait-google-expiry-disabled-readback',
      proofSchemaVersion: 2,
      nextState: { ...state, googleExpiryScheduleDisabledAt: nowUtc },
    };
  }
  if (
    !isCanonicalTimestamp(state.googleExpiryScheduleDisabledAt)
    || Date.parse(state.googleExpiryScheduleDisabledAt) > Date.parse(nowUtc)
  ) return failure(state, 'error-google-expiry-state');

  if (apiStoppedAt === null) {
    return { ready: true, proofSchemaVersion: 2, nextState: state };
  }
  if (
    !isCanonicalTimestamp(apiStoppedAt)
    || Date.parse(apiStoppedAt) < Date.parse(state.googleExpiryScheduleDisabledAt)
  ) return failure(state, 'error-google-expiry-state');

  const cleanup = inventory.cleanupTask;
  if (!validCleanupTask(cleanup) || !Number.isSafeInteger(inventory.activeTaskCount) || inventory.activeTaskCount < 0 || inventory.activeTaskCount > 1) {
    return failure(state, 'error-google-expiry-inventory');
  }

  if (state.googleExpiryCleanupCompletedAt !== undefined && state.googleExpiryCleanupCompletedAt !== null) {
    if (
      !isCanonicalTimestamp(state.googleExpiryCleanupCompletedAt)
      || cleanup.status !== 'completed'
      || cleanup.count !== 0
      || cleanup.completedAtUtc !== state.googleExpiryCleanupCompletedAt
    ) return failure(state, 'error-google-expiry-state');
    return { ready: true, proofSchemaVersion: 2, nextState: state };
  }

  const cleanupStartedAt = state.googleExpiryCleanupStartedAt;
  if (cleanupStartedAt === undefined || cleanupStartedAt === null) {
    if (cleanup.status !== 'absent') return failure(state, 'error-google-expiry-state');
    if (inventory.activeTaskCount !== 0) {
      return { ready: false, action: 'wait-google-expiry-task-zero', proofSchemaVersion: 2, nextState: state };
    }
    const cleanupNotBefore = Date.parse(apiStoppedAt) + GOOGLE_EXPIRY_QUIET_WINDOW_MS;
    if (Date.parse(nowUtc) < cleanupNotBefore) {
      return {
        ready: false,
        action: 'wait-google-expiry-quiet-window',
        proofSchemaVersion: 2,
        nextState: state,
        notBeforeUtc: new Date(cleanupNotBefore).toISOString(),
      };
    }
    return {
      ready: false,
      action: 'run-google-expiry-cleanup',
      proofSchemaVersion: 2,
      nextState: { ...state, googleExpiryCleanupStartedAt: nowUtc },
    };
  }

  if (
    !isCanonicalTimestamp(cleanupStartedAt)
    || Date.parse(cleanupStartedAt) < Date.parse(apiStoppedAt)
    || Date.parse(cleanupStartedAt) > Date.parse(nowUtc)
  ) return failure(state, 'error-google-expiry-state');
  if (cleanup.status === 'running' && cleanup.count === 1 && inventory.activeTaskCount === 1) {
    return {
      ready: false,
      action: 'wait-google-expiry-cleanup',
      proofSchemaVersion: 2,
      nextState: state,
    };
  }
  if (cleanup.status === 'absent' && inventory.activeTaskCount === 0) {
    return { ready: false, action: 'run-google-expiry-cleanup', proofSchemaVersion: 2, nextState: state };
  }
  if (cleanup.status === 'failed') {
    return failure(state, 'error-google-expiry-cleanup');
  }
  if (
    cleanup.status !== 'completed'
    || cleanup.count !== 0
    || inventory.activeTaskCount !== 0
    || !isCanonicalTimestamp(cleanup.completedAtUtc)
    || Date.parse(cleanup.completedAtUtc) < Date.parse(cleanupStartedAt)
    || Date.parse(cleanup.completedAtUtc) > Date.parse(nowUtc)
  ) return failure(state, 'error-google-expiry-inventory');
  return {
    ready: true,
    proofSchemaVersion: 2,
    nextState: { ...state, googleExpiryCleanupCompletedAt: cleanup.completedAtUtc },
  };
}

function validSchedule(schedule) {
  return isPlainRecord(schedule)
    && schedule.exists === true
    && schedule.owned === true
    && schedule.exact === true
    && (schedule.state === 'ENABLED' || schedule.state === 'DISABLED');
}

function validCleanupTask(task) {
  if (!isPlainRecord(task) || !['absent', 'running', 'completed', 'failed'].includes(task.status)) return false;
  if (task.status === 'absent') return Object.keys(task).length === 1;
  if (!Number.isSafeInteger(task.count) || task.count < 0 || task.count > 1) return false;
  if (task.status === 'running') return task.count === 1;
  if (task.status === 'failed') return task.count === 0;
  return task.count === 0 && isCanonicalTimestamp(task.completedAtUtc);
}

function failure(state, action) {
  return { ready: false, action, proofSchemaVersion: 2, nextState: isPlainRecord(state) ? state : {} };
}

function isCanonicalTimestamp(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
