import { createHash } from 'node:crypto';

export const GOOGLE_EXPIRY_GROUP_NAME = 'lyra-staging-20261003-google-auth';
export const GOOGLE_EXPIRY_SCHEDULE_NAME = 'lyra-staging-20261003-google-link-expiry';
export const GOOGLE_EXPIRY_STARTED_BY = 'lyra-stage-google-expiry-v1';
const STAGE_ID = 'lyra-staging-20261003';
const REGION = 'ap-northeast-1';
const ACCOUNT = '452284481392';
const OWNERSHIP = { Owner: 'Lyra', Environment: 'staging', LyraStagingId: STAGE_ID, ExpiresAt: '2026-10-10' };

export function assessGoogleExpiryAwsInventory({ runtimeStack, foundationStack, group, groupTags, schedule, taskRecord, task, activeTasks = [], sealedCompletedAtUtc = null }) {
  const enabled = runtimeStack?.parameters?.GoogleIdentityExpiryEnabled;
  const providerEnabled = foundationStack?.parameters?.GoogleIdentityProviderEnabled;
  if (![undefined, 'false', 'true'].includes(providerEnabled)) {
    throw new Error('GOOGLE_EXPIRY_CONFIGURATION_INVALID');
  }
  if (enabled !== 'true') {
    if (![undefined, 'false'].includes(enabled) || providerEnabled === 'true') {
      throw new Error('GOOGLE_EXPIRY_CONFIGURATION_INVALID');
    }
    return { configured: false };
  }
  const outputs = runtimeStack.outputs;
  const foundation = foundationStack?.outputs;
  if (!record(outputs) || !record(foundation)) throw new Error('GOOGLE_EXPIRY_CONFIGURATION_INVALID');
  const expected = {
    groupName: GOOGLE_EXPIRY_GROUP_NAME,
    scheduleName: GOOGLE_EXPIRY_SCHEDULE_NAME,
    scheduleArn: `arn:aws:scheduler:${REGION}:${ACCOUNT}:schedule/${GOOGLE_EXPIRY_GROUP_NAME}/${GOOGLE_EXPIRY_SCHEDULE_NAME}`,
    clusterArn: `arn:aws:ecs:${REGION}:${ACCOUNT}:cluster/${STAGE_ID}-cluster`,
  };
  if (
    outputs.GoogleLinkExpiryScheduleGroupName !== expected.groupName
    || outputs.GoogleLinkExpiryScheduleName !== expected.scheduleName
    || outputs.GoogleLinkExpiryScheduleArn !== expected.scheduleArn
    || !exactTaskDefinitionArn(outputs.GoogleLinkExpiryTaskDefinitionArn)
    || outputs.GoogleLinkExpirySchedulerRoleArn !== `arn:aws:iam::${ACCOUNT}:role/${STAGE_ID}-google-link-expiry-scheduler`
    || outputs.GoogleLinkExpiryDlqArn !== `arn:aws:sqs:${REGION}:${ACCOUNT}:${STAGE_ID}-google-link-expiry-dlq`
    || foundation.EcsClusterArn !== expected.clusterArn
    || group?.Name !== expected.groupName
    || group?.Arn !== `arn:aws:scheduler:${REGION}:${ACCOUNT}:schedule-group/${expected.groupName}`
    || !tagsMatch(groupTags)
  ) throw new Error('GOOGLE_EXPIRY_CONFIGURATION_INVALID');
  const target = schedule?.Target;
  const network = target?.EcsParameters?.NetworkConfiguration?.awsvpcConfiguration;
  if (
    schedule?.Name !== expected.scheduleName
    || schedule?.GroupName !== expected.groupName
    || schedule?.Arn !== expected.scheduleArn
    || !['ENABLED', 'DISABLED'].includes(schedule?.State)
    || schedule?.ScheduleExpression !== 'rate(15 minutes)'
    || schedule?.FlexibleTimeWindow?.Mode !== 'OFF'
    || schedule?.EndDate?.toISOString?.() !== '2026-10-10T00:00:00.000Z'
    || target?.Arn !== expected.clusterArn
    || target?.RoleArn !== outputs.GoogleLinkExpirySchedulerRoleArn
    || target?.DeadLetterConfig?.Arn !== outputs.GoogleLinkExpiryDlqArn
    || target?.RetryPolicy?.MaximumEventAgeInSeconds !== 60
    || target?.RetryPolicy?.MaximumRetryAttempts !== 0
    || target?.EcsParameters?.TaskDefinitionArn !== outputs.GoogleLinkExpiryTaskDefinitionArn
    || target?.EcsParameters?.TaskCount !== 1
    || target?.EcsParameters?.LaunchType !== 'FARGATE'
    || target?.EcsParameters?.EnableECSManagedTags !== true
    || target?.EcsParameters?.PropagateTags !== 'TASK_DEFINITION'
    || network?.AssignPublicIp !== 'ENABLED'
    || !sameSet(network?.Subnets, [foundation.PublicSubnetAId, foundation.PublicSubnetCId])
    || !sameSet(network?.SecurityGroups, [foundation.WorkerSecurityGroupId])
  ) throw new Error('GOOGLE_EXPIRY_SCHEDULE_INVALID');

  if (
    !Array.isArray(activeTasks)
    || activeTasks.length > 1
    || activeTasks.some((activeTask) => (
      !exactTaskArn(activeTask?.taskArn)
      || activeTask.clusterArn !== expected.clusterArn
      || activeTask.taskDefinitionArn !== outputs.GoogleLinkExpiryTaskDefinitionArn
      || activeTask.group !== `family:${STAGE_ID}-google-link-expiry`
    ))
  ) throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
  const cleanupTask = assessTask({ taskRecord, task, taskDefinitionArn: outputs.GoogleLinkExpiryTaskDefinitionArn, clusterArn: expected.clusterArn, sealedCompletedAtUtc });
  const activeTaskCount = activeTasks.length;
  if (cleanupTask.status === 'running' && !activeTasks.some(({ taskArn }) => taskArn === cleanupTask.taskArn)) {
    throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
  }
  return {
    configured: true,
    schedule: { exists: true, owned: true, exact: true, state: schedule.State },
    cleanupTask,
    activeTaskCount,
    configuration: {
      clusterArn: expected.clusterArn,
      taskDefinitionArn: outputs.GoogleLinkExpiryTaskDefinitionArn,
      subnets: [foundation.PublicSubnetAId, foundation.PublicSubnetCId],
      securityGroups: [foundation.WorkerSecurityGroupId],
      schedule,
    },
  };
}

export function buildGoogleExpiryRunTaskRequest(configuration, startedAtUtc) {
  if (!canonical(startedAtUtc) || !record(configuration) || !exactTaskDefinitionArn(configuration.taskDefinitionArn)) {
    throw new Error('GOOGLE_EXPIRY_RUN_INPUT_INVALID');
  }
  return {
    cluster: configuration.clusterArn,
    taskDefinition: configuration.taskDefinitionArn,
    count: 1,
    launchType: 'FARGATE',
    platformVersion: 'LATEST',
    startedBy: GOOGLE_EXPIRY_STARTED_BY,
    clientToken: createHash('sha256').update(`${STAGE_ID}:${startedAtUtc}`).digest('hex'),
    enableECSManagedTags: true,
    propagateTags: 'TASK_DEFINITION',
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: 'ENABLED',
        subnets: configuration.subnets,
        securityGroups: configuration.securityGroups,
      },
    },
    tags: Object.entries(OWNERSHIP).map(([key, value]) => ({ key, value })),
  };
}

export function buildGoogleExpiryTaskRecord(task, startedAtUtc, taskDefinitionArn) {
  if (
    !canonical(startedAtUtc)
    || !exactTaskArn(task?.taskArn)
    || task?.taskDefinitionArn !== taskDefinitionArn
    || task?.startedBy !== GOOGLE_EXPIRY_STARTED_BY
    || task?.group !== `family:${STAGE_ID}-google-link-expiry`
  ) throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
  return {
    kind: 'lyra-staging-google-expiry-task',
    schemaVersion: 1,
    stageId: STAGE_ID,
    taskArn: task.taskArn,
    taskDefinitionArn,
    startedAtUtc,
  };
}

function assessTask({ taskRecord, task, taskDefinitionArn, clusterArn, sealedCompletedAtUtc }) {
  if (taskRecord === null) {
    if (task !== null) throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
    return { status: 'absent' };
  }
  if (
    sealedCompletedAtUtc !== null
    && canonical(sealedCompletedAtUtc)
    && record(taskRecord)
    && Object.keys(taskRecord).sort().join(',') === 'kind,schemaVersion,stageId,startedAtUtc,taskArn,taskDefinitionArn'
    && taskRecord.kind === 'lyra-staging-google-expiry-task'
    && taskRecord.schemaVersion === 1
    && taskRecord.stageId === STAGE_ID
    && canonical(taskRecord.startedAtUtc)
    && Date.parse(sealedCompletedAtUtc) >= Date.parse(taskRecord.startedAtUtc)
    && exactTaskArn(taskRecord.taskArn)
    && taskRecord.taskDefinitionArn === taskDefinitionArn
    && task === null
  ) return { status: 'completed', count: 0, completedAtUtc: sealedCompletedAtUtc };
  if (
    !record(taskRecord)
    || Object.keys(taskRecord).sort().join(',') !== 'kind,schemaVersion,stageId,startedAtUtc,taskArn,taskDefinitionArn'
    || taskRecord.kind !== 'lyra-staging-google-expiry-task'
    || taskRecord.schemaVersion !== 1
    || taskRecord.stageId !== STAGE_ID
    || !canonical(taskRecord.startedAtUtc)
    || !exactTaskArn(taskRecord.taskArn)
    || taskRecord.taskDefinitionArn !== taskDefinitionArn
    || task?.taskArn !== taskRecord.taskArn
    || task?.clusterArn !== clusterArn
    || task?.taskDefinitionArn !== taskDefinitionArn
    || task?.startedBy !== GOOGLE_EXPIRY_STARTED_BY
    || task?.group !== `family:${STAGE_ID}-google-link-expiry`
  ) throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
  if (['PROVISIONING', 'PENDING', 'ACTIVATING', 'RUNNING', 'DEACTIVATING', 'STOPPING'].includes(task.lastStatus)) {
    return { status: 'running', count: 1, taskArn: task.taskArn };
  }
  const container = task.containers?.length === 1 ? task.containers[0] : null;
  const completedAtUtc = task.stoppedAt instanceof Date ? task.stoppedAt.toISOString() : task.stoppedAt;
  if (task.lastStatus !== 'STOPPED' || task.desiredStatus !== 'STOPPED' || !canonical(completedAtUtc)) {
    throw new Error('GOOGLE_EXPIRY_TASK_INVALID');
  }
  if (task.stopCode !== 'EssentialContainerExited' || container?.name !== 'google-link-expiry' || container?.exitCode !== 0) {
    return { status: 'failed', count: 0 };
  }
  return { status: 'completed', count: 0, completedAtUtc };
}

function exactTaskDefinitionArn(value) {
  return typeof value === 'string' && new RegExp(`^arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/${STAGE_ID}-google-link-expiry:[1-9][0-9]*$`, 'u').test(value);
}
function exactTaskArn(value) {
  return typeof value === 'string' && new RegExp(`^arn:aws:ecs:${REGION}:${ACCOUNT}:task/${STAGE_ID}-cluster/[0-9a-f]{32}$`, 'u').test(value);
}
function tagsMatch(tags) {
  const values = Object.fromEntries((tags?.Tags ?? tags ?? []).map(({ Key, Value }) => [Key, Value]));
  return Object.entries(OWNERSHIP).every(([key, value]) => values[key] === value);
}
function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}
function canonical(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
