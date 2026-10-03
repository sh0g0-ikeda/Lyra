import { createHash } from 'node:crypto';

import {
  buildStageDatabaseDrainProofBunSource,
  DATABASE_DRAIN_PROOF_LOG_PREFIX,
} from './stage-database-drain-proof.mjs';
import {
  ACTIVE_START_AT,
  assessDatabaseDrainProof,
  STAGE_ACCOUNT_ID,
  STAGE_CLUSTER_ID,
  STAGE_DATABASE_ID,
  STAGE_ID,
  STAGE_REGION,
} from './stage-lifecycle-guard-core.mjs';

const TASK_RECORD_KIND = 'lyra-staging-db-drain-proof-task';
const TASK_RECORD_VERSION = 1;
const TASK_DEFINITION_REVISION = 2;
const CONTAINER_NAME = 'migration';
const STARTED_BY = 'lyra-stage-db-proof-v1';
const DATABASE_NAME = 'lyrastaging';
const TASK_DEADLINE_MS = 10 * 60 * 1000;
const STOPPED_LOG_QUIET_MS = 30 * 1000;
const IMAGE_DIGEST = 'c9f57110768bd77ca4ae45d117d0c9ea75f058236933cab9ef2418e517e68667';
const TASK_DEFINITION_ARN = `arn:aws:ecs:${STAGE_REGION}:${STAGE_ACCOUNT_ID}:task-definition/${STAGE_ID}-migration:${TASK_DEFINITION_REVISION}`;
const CLUSTER_ARN = `arn:aws:ecs:${STAGE_REGION}:${STAGE_ACCOUNT_ID}:cluster/${STAGE_CLUSTER_ID}`;
const MIGRATION_TASK_ROLE_ARN = `arn:aws:iam::${STAGE_ACCOUNT_ID}:role/${STAGE_ID}-migration-task`;
const EXECUTION_ROLE_ARN = `arn:aws:iam::${STAGE_ACCOUNT_ID}:role/${STAGE_ID}-execution`;
const RECORD_KEYS = Object.freeze([
  'kind', 'schemaVersion', 'stageId', 'clusterArn', 'taskArn', 'taskDefinitionArn',
  'taskRoleArn', 'executionRoleArn', 'imageDigest', 'startedBy', 'nonce', 'sourceSha256',
  'safePointAtUtc', 'startedAtUtc', 'deadlineAtUtc', 'subnets', 'securityGroups',
  'logGroupName', 'logStreamName', 'containerName', 'status', 'completedAtUtc',
  'proofObservedAtUtc',
]);

export function createStageDatabaseDrainProofPort({ cfn, ecs, logs, commands }) {
  requirePortDependencies({ cfn, ecs, logs, commands });
  return Object.freeze({
    start: (input) => startTask({ ...input, cfn, ecs, commands }),
    poll: (input) => pollTask({ ...input, cfn, ecs, logs, commands }),
  });
}

export function shouldStartDatabaseDrainProofTask({
  mode,
  nowUtc,
  action,
  state,
  inventory,
  taskRecord,
}) {
  if (mode !== 'active' || !isCanonicalTimestamp(nowUtc) || Date.parse(nowUtc) < Date.parse(ACTIVE_START_AT)) return false;
  if (action !== 'wait-db-drain' || state?.databaseStopRequested !== false) return false;
  if (
    inventory?.api?.desired !== 0
    || inventory?.api?.running !== 0
    || inventory?.api?.pending !== 0
    || inventory?.database?.exists !== true
    || inventory.database.owned !== true
    || inventory.database.status !== 'available'
    || inventory.readOnlyProofTaskCount !== 0
  ) return false;
  return taskRecord === null || taskRecord?.status === 'completed';
}

export function parseDatabaseDrainProofTaskRecord(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, RECORD_KEYS)) throw new Error('DATABASE_DRAIN_PROOF_TASK_RECORD_INVALID');
  if (
    value.kind !== TASK_RECORD_KIND
    || value.schemaVersion !== TASK_RECORD_VERSION
    || value.stageId !== STAGE_ID
    || value.clusterArn !== CLUSTER_ARN
    || value.taskDefinitionArn !== TASK_DEFINITION_ARN
    || value.taskRoleArn !== MIGRATION_TASK_ROLE_ARN
    || value.executionRoleArn !== EXECUTION_ROLE_ARN
    || value.imageDigest !== IMAGE_DIGEST
    || value.startedBy !== STARTED_BY
    || value.containerName !== CONTAINER_NAME
    || !/^[0-9a-f]{32}$/u.test(value.nonce)
    || !/^[0-9a-f]{64}$/u.test(value.sourceSha256)
    || !exactTaskArn(value.taskArn)
    || !isCanonicalTimestamp(value.safePointAtUtc)
    || !isCanonicalTimestamp(value.startedAtUtc)
    || !isCanonicalTimestamp(value.deadlineAtUtc)
    || Date.parse(value.deadlineAtUtc) !== Date.parse(value.startedAtUtc) + TASK_DEADLINE_MS
    || typeof value.logGroupName !== 'string'
    || value.logGroupName !== `/lyra/${STAGE_ID}/worker`
    || value.logStreamName !== `migration/${CONTAINER_NAME}/${taskIdFromArn(value.taskArn)}`
    || !Array.isArray(value.subnets)
    || value.subnets.length !== 2
    || value.subnets.some((subnet) => typeof subnet !== 'string' || !/^subnet-[0-9a-f]+$/u.test(subnet))
    || new Set(value.subnets).size !== 2
    || !Array.isArray(value.securityGroups)
    || value.securityGroups.length !== 1
    || !/^sg-[0-9a-f]+$/u.test(value.securityGroups[0])
    || !['pending', 'completed'].includes(value.status)
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_RECORD_INVALID');
  if (value.status === 'pending') {
    if (value.completedAtUtc !== null || value.proofObservedAtUtc !== null) throw new Error('DATABASE_DRAIN_PROOF_TASK_RECORD_INVALID');
  } else if (
    !isCanonicalTimestamp(value.completedAtUtc)
    || !isCanonicalTimestamp(value.proofObservedAtUtc)
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_RECORD_INVALID');
  return structuredClone(value);
}

export function classifyDatabaseDrainProofTasks(taskArns, verifiedTaskArn = null) {
  if (
    !Array.isArray(taskArns)
    || taskArns.some((taskArn) => !exactTaskArn(taskArn))
    || new Set(taskArns).size !== taskArns.length
    || (verifiedTaskArn !== null && !exactTaskArn(verifiedTaskArn))
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_INVENTORY_INVALID');
  const readOnlyProofTaskCount = verifiedTaskArn !== null && taskArns.includes(verifiedTaskArn) ? 1 : 0;
  return {
    clusterTaskCount: taskArns.length,
    readOnlyProofTaskCount,
    unknownClusterTaskCount: taskArns.length - readOnlyProofTaskCount,
  };
}

async function startTask({ nowUtc, safePointAtUtc, attemptKey, cfn, ecs, commands }) {
  requireTimestamp(nowUtc, 'DATABASE_DRAIN_PROOF_START_TIME_INVALID');
  requireTimestamp(safePointAtUtc, 'DATABASE_DRAIN_PROOF_SAFE_POINT_INVALID');
  if (Date.parse(safePointAtUtc) > Date.parse(nowUtc)) throw new Error('DATABASE_DRAIN_PROOF_SAFE_POINT_INVALID');
  if (typeof attemptKey !== 'string' || !/^[A-Za-z0-9:._-]{1,160}$/u.test(attemptKey)) {
    throw new Error('DATABASE_DRAIN_PROOF_ATTEMPT_INVALID');
  }
  const configuration = await loadAndValidateConfiguration(cfn, ecs, commands);
  const source = buildProofSource(configuration);
  const sourceSha256 = sha256(source);
  const nonce = sha256(`${safePointAtUtc}:${attemptKey}:${sourceSha256}`).slice(0, 32);
  const tags = proofTaskTags(nonce, sourceSha256);
  const command = ['/usr/local/bin/bun', '-e', source];
  const overrides = { containerOverrides: [{ name: CONTAINER_NAME, command }] };
  if (JSON.stringify(overrides).length > 8_192) throw new Error('DATABASE_DRAIN_PROOF_OVERRIDE_TOO_LARGE');
  const runInput = {
    cluster: configuration.clusterArn,
    taskDefinition: configuration.taskDefinitionArn,
    count: 1,
    launchType: 'FARGATE',
    platformVersion: 'LATEST',
    startedBy: STARTED_BY,
    clientToken: sha256(`${STAGE_ID}:${nonce}`),
    enableECSManagedTags: true,
    propagateTags: 'TASK_DEFINITION',
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: 'ENABLED',
        subnets: configuration.subnets,
        securityGroups: configuration.securityGroups,
      },
    },
    overrides,
    tags,
  };
  const response = await ecs.send(commands.runTask(runInput));
  if (!isPlainRecord(response) || !Array.isArray(response.failures) || response.failures.length !== 0 || response.tasks?.length !== 1) {
    throw new Error('DATABASE_DRAIN_PROOF_RUN_TASK_FAILED');
  }
  const task = response.tasks[0];
  const taskArn = requireTaskIdentity(task, {
    configuration,
    startedBy: STARTED_BY,
    sourceSha256,
    nonce,
    requireNetwork: false,
    requireRuntimeEvidence: false,
  });
  const startedAtUtc = canonicalAwsTimestamp(task.createdAt, 'DATABASE_DRAIN_PROOF_TASK_START_TIME_INVALID');
  if (
    Date.parse(startedAtUtc) < Date.parse(safePointAtUtc)
    || Date.parse(startedAtUtc) > Date.parse(nowUtc) + 30_000
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_START_TIME_INVALID');
  const record = {
    kind: TASK_RECORD_KIND,
    schemaVersion: TASK_RECORD_VERSION,
    stageId: STAGE_ID,
    clusterArn: configuration.clusterArn,
    taskArn,
    taskDefinitionArn: configuration.taskDefinitionArn,
    taskRoleArn: configuration.taskRoleArn,
    executionRoleArn: configuration.executionRoleArn,
    imageDigest: IMAGE_DIGEST,
    startedBy: STARTED_BY,
    nonce,
    sourceSha256,
    safePointAtUtc,
    startedAtUtc,
    deadlineAtUtc: new Date(Date.parse(startedAtUtc) + TASK_DEADLINE_MS).toISOString(),
    subnets: configuration.subnets,
    securityGroups: configuration.securityGroups,
    logGroupName: configuration.logGroupName,
    logStreamName: `migration/${CONTAINER_NAME}/${taskIdFromArn(taskArn)}`,
    containerName: CONTAINER_NAME,
    status: 'pending',
    completedAtUtc: null,
    proofObservedAtUtc: null,
  };
  return parseDatabaseDrainProofTaskRecord(record);
}

async function pollTask({ record: rawRecord, nowUtc, cfn, ecs, logs, commands }) {
  const record = parseDatabaseDrainProofTaskRecord(rawRecord);
  requireTimestamp(nowUtc, 'DATABASE_DRAIN_PROOF_POLL_TIME_INVALID');
  if (record.status === 'completed') return { status: 'completed', record };
  if (Date.parse(nowUtc) > Date.parse(record.deadlineAtUtc)) throw new Error('DATABASE_DRAIN_PROOF_TASK_TIMEOUT');
  const configuration = await loadAndValidateConfiguration(cfn, ecs, commands);
  assertRecordMatchesConfiguration(record, configuration, sha256(buildProofSource(configuration)));
  const response = await ecs.send(commands.describeTasks({
    cluster: configuration.clusterArn,
    tasks: [record.taskArn],
    include: ['TAGS'],
  }));
  if (!isPlainRecord(response) || !Array.isArray(response.failures) || response.failures.length !== 0 || response.tasks?.length !== 1) {
    throw new Error('DATABASE_DRAIN_PROOF_TASK_INVENTORY_INVALID');
  }
  const task = response.tasks[0];
  requireTaskIdentity(task, {
    configuration,
    startedBy: record.startedBy,
    sourceSha256: record.sourceSha256,
    nonce: record.nonce,
    taskArn: record.taskArn,
    requireNetwork: true,
    requireRuntimeEvidence: true,
  });
  if (['PROVISIONING', 'PENDING', 'ACTIVATING', 'RUNNING', 'DEACTIVATING', 'STOPPING'].includes(task.lastStatus)) {
    return { status: 'pending', record };
  }
  if (task.lastStatus !== 'STOPPED' || task.desiredStatus !== 'STOPPED' || task.stopCode !== 'EssentialContainerExited') {
    throw new Error('DATABASE_DRAIN_PROOF_TASK_STATUS_INVALID');
  }
  const stoppedAt = canonicalAwsTimestamp(task.stoppedAt, 'DATABASE_DRAIN_PROOF_TASK_STOP_TIME_INVALID');
  if (Date.parse(nowUtc) - Date.parse(stoppedAt) < STOPPED_LOG_QUIET_MS) return { status: 'pending', record };
  if (
    !Array.isArray(task.containers)
    || task.containers.length !== 1
    || task.containers[0]?.name !== CONTAINER_NAME
    || task.containers[0]?.lastStatus !== 'STOPPED'
    || task.containers[0]?.exitCode !== 0
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_EXIT_INVALID');

  const first = await logs.send(commands.getLogEvents({
    logGroupName: record.logGroupName,
    logStreamName: record.logStreamName,
    startFromHead: true,
    limit: 10,
  }));
  if (!Array.isArray(first?.events) || first.events.length === 0) return { status: 'pending', record };
  if (first.events.length !== 1 || typeof first.nextForwardToken !== 'string') {
    throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  }
  const second = await logs.send(commands.getLogEvents({
    logGroupName: record.logGroupName,
    logStreamName: record.logStreamName,
    startFromHead: true,
    limit: 10,
    nextToken: first.nextForwardToken,
  }));
  if (!Array.isArray(second?.events) || second.events.length !== 0 || second.nextForwardToken !== first.nextForwardToken) {
    throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  }
  const message = first.events[0]?.message;
  if (typeof message !== 'string' || !message.startsWith(DATABASE_DRAIN_PROOF_LOG_PREFIX)) {
    throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  }
  let proof;
  try {
    proof = JSON.parse(message.slice(DATABASE_DRAIN_PROOF_LOG_PREFIX.length));
  } catch {
    throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  }
  const assessment = assessDatabaseDrainProof({
    proof,
    nowEpoch: Date.parse(nowUtc),
    notBefore: record.safePointAtUtc,
    expectedObservedAt: null,
    requireFresh: true,
  });
  if (!assessment.ready && assessment.reason !== 'nonzero') throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  if (
    Date.parse(proof.observedAtUtc) < Date.parse(record.startedAtUtc)
    || Date.parse(proof.observedAtUtc) > Date.parse(stoppedAt) + 30_000
  ) throw new Error('DATABASE_DRAIN_PROOF_LOG_INVALID');
  const completedRecord = parseDatabaseDrainProofTaskRecord({
    ...record,
    status: 'completed',
    completedAtUtc: nowUtc,
    proofObservedAtUtc: proof.observedAtUtc,
  });
  return { status: 'completed', record: completedRecord, proof };
}

async function loadAndValidateConfiguration(cfn, ecs, commands) {
  const [runtimeResponse, foundationResponse] = await Promise.all([
    cfn.send(commands.describeStacks({ StackName: `${STAGE_ID}-runtime` })),
    cfn.send(commands.describeStacks({ StackName: `${STAGE_ID}-foundation` })),
  ]);
  const runtime = stackOutputs(runtimeResponse, `${STAGE_ID}-runtime`);
  const foundation = stackOutputs(foundationResponse, `${STAGE_ID}-foundation`);
  const configuration = {
    clusterArn: requiredOutput(foundation, 'EcsClusterArn'),
    taskDefinitionArn: requiredOutput(runtime, 'MigrationTaskDefinitionArn'),
    taskRoleArn: requiredOutput(runtime, 'MigrationTaskRoleArn'),
    executionRoleArn: requiredOutput(runtime, 'ExecutionRoleArn'),
    repositoryUri: requiredOutput(foundation, 'EcrRepositoryUri'),
    databaseHost: requiredOutput(foundation, 'DatabaseEndpoint').toLowerCase(),
    subnets: [requiredOutput(foundation, 'PublicSubnetAId'), requiredOutput(foundation, 'PublicSubnetCId')],
    securityGroups: [requiredOutput(foundation, 'WorkerSecurityGroupId')],
    logGroupName: requiredOutput(foundation, 'WorkerLogGroupName'),
  };
  const expectedRepository = `${STAGE_ACCOUNT_ID}.dkr.ecr.${STAGE_REGION}.amazonaws.com/${STAGE_ID}-api`;
  if (
    configuration.clusterArn !== CLUSTER_ARN
    || configuration.taskDefinitionArn !== TASK_DEFINITION_ARN
    || configuration.taskRoleArn !== MIGRATION_TASK_ROLE_ARN
    || configuration.executionRoleArn !== EXECUTION_ROLE_ARN
    || configuration.repositoryUri !== expectedRepository
    || configuration.logGroupName !== `/lyra/${STAGE_ID}/worker`
    || !configuration.databaseHost.startsWith(`${STAGE_DATABASE_ID}.`)
    || !configuration.databaseHost.endsWith(`.${STAGE_REGION}.rds.amazonaws.com`)
    || configuration.subnets.some((value) => !/^subnet-[0-9a-f]+$/u.test(value))
    || new Set(configuration.subnets).size !== 2
    || !/^sg-[0-9a-f]+$/u.test(configuration.securityGroups[0])
  ) throw new Error('DATABASE_DRAIN_PROOF_CONFIGURATION_INVALID');
  const definitionResponse = await ecs.send(commands.describeTaskDefinition({ taskDefinition: configuration.taskDefinitionArn }));
  validateTaskDefinition(definitionResponse?.taskDefinition, configuration);
  return configuration;
}

function validateTaskDefinition(taskDefinition, configuration) {
  const containers = taskDefinition?.containerDefinitions;
  const container = Array.isArray(containers) && containers.length === 1 ? containers[0] : null;
  if (
    taskDefinition?.taskDefinitionArn !== TASK_DEFINITION_ARN
    || taskDefinition?.family !== `${STAGE_ID}-migration`
    || taskDefinition?.revision !== TASK_DEFINITION_REVISION
    || taskDefinition?.taskRoleArn !== configuration.taskRoleArn
    || taskDefinition?.executionRoleArn !== configuration.executionRoleArn
    || taskDefinition?.networkMode !== 'awsvpc'
    || !Array.isArray(taskDefinition?.requiresCompatibilities)
    || taskDefinition.requiresCompatibilities.length !== 1
    || taskDefinition.requiresCompatibilities[0] !== 'FARGATE'
    || taskDefinition?.runtimePlatform?.cpuArchitecture !== 'ARM64'
    || taskDefinition?.runtimePlatform?.operatingSystemFamily !== 'LINUX'
    || container?.name !== CONTAINER_NAME
    || container?.essential !== true
    || container?.image !== `${configuration.repositoryUri}@sha256:${IMAGE_DIGEST}`
    || container?.logConfiguration?.logDriver !== 'awslogs'
    || container?.logConfiguration?.options?.['awslogs-group'] !== configuration.logGroupName
    || container?.logConfiguration?.options?.['awslogs-region'] !== STAGE_REGION
    || container?.logConfiguration?.options?.['awslogs-stream-prefix'] !== 'migration'
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_DEFINITION_INVALID');
}

function requireTaskIdentity(task, expected) {
  const actualArn = task?.taskArn;
  if (
    !exactTaskArn(actualArn)
    || (expected.taskArn !== undefined && actualArn !== expected.taskArn)
    || task?.clusterArn !== expected.configuration.clusterArn
    || task?.taskDefinitionArn !== expected.configuration.taskDefinitionArn
    || task?.startedBy !== expected.startedBy
    || task?.group !== `family:${STAGE_ID}-migration`
    || task?.launchType !== 'FARGATE'
    || !Array.isArray(task?.containers)
    || task.containers.length !== 1
    || task.containers[0]?.name !== CONTAINER_NAME
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_IDENTITY_INVALID');
  if (expected.requireRuntimeEvidence) {
    if (!Array.isArray(task.tags)) throw new Error('DATABASE_DRAIN_PROOF_TASK_TAG_INVALID');
    const tags = Object.fromEntries(task.tags.map(({ key, value }) => [key, value]));
    for (const tag of proofTaskTags(expected.nonce, expected.sourceSha256)) {
      if (tags[tag.key] !== tag.value) throw new Error('DATABASE_DRAIN_PROOF_TASK_TAG_INVALID');
    }
    const overrides = task.overrides;
    if (
      !isPlainRecord(overrides)
      || Object.keys(overrides).some((key) => ![
        'containerOverrides', 'taskRoleArn', 'executionRoleArn', 'inferenceAcceleratorOverrides',
      ].includes(key))
      || (overrides.taskRoleArn !== undefined && overrides.taskRoleArn !== expected.configuration.taskRoleArn)
      || (overrides.executionRoleArn !== undefined && overrides.executionRoleArn !== expected.configuration.executionRoleArn)
      || (overrides.inferenceAcceleratorOverrides !== undefined && (
        !Array.isArray(overrides.inferenceAcceleratorOverrides) || overrides.inferenceAcceleratorOverrides.length !== 0
      ))
    ) throw new Error('DATABASE_DRAIN_PROOF_TASK_ROLE_OVERRIDE_INVALID');
    const containerOverride = overrides.containerOverrides?.[0];
    const command = containerOverride?.command;
    if (
      overrides.containerOverrides?.length !== 1
      || containerOverride?.name !== CONTAINER_NAME
      || Object.keys(containerOverride).some((key) => ![
        'name', 'command', 'environment', 'environmentFiles', 'resourceRequirements',
      ].includes(key))
      || (containerOverride.environment !== undefined && (
        !Array.isArray(containerOverride.environment) || containerOverride.environment.length !== 0
      ))
      || (containerOverride.environmentFiles !== undefined && (
        !Array.isArray(containerOverride.environmentFiles) || containerOverride.environmentFiles.length !== 0
      ))
      || (containerOverride.resourceRequirements !== undefined && (
        !Array.isArray(containerOverride.resourceRequirements) || containerOverride.resourceRequirements.length !== 0
      ))
      || !Array.isArray(command)
      || command.length !== 3
      || command[0] !== '/usr/local/bin/bun'
      || command[1] !== '-e'
      || sha256(command[2]) !== expected.sourceSha256
    ) throw new Error('DATABASE_DRAIN_PROOF_TASK_SOURCE_INVALID');
  }
  if (expected.requireNetwork) {
    const eni = task.attachments?.filter(({ type }) => type === 'ElasticNetworkInterface');
    const subnet = eni?.[0]?.details?.find(({ name }) => name === 'subnetId')?.value;
    if (eni?.length !== 1 || !expected.configuration.subnets.includes(subnet)) {
      throw new Error('DATABASE_DRAIN_PROOF_TASK_NETWORK_INVALID');
    }
  }
  return actualArn;
}

function assertRecordMatchesConfiguration(record, configuration, expectedSourceSha256) {
  if (
    record.clusterArn !== configuration.clusterArn
    || record.taskDefinitionArn !== configuration.taskDefinitionArn
    || record.taskRoleArn !== configuration.taskRoleArn
    || record.executionRoleArn !== configuration.executionRoleArn
    || record.sourceSha256 !== expectedSourceSha256
    || record.logGroupName !== configuration.logGroupName
    || JSON.stringify(record.subnets) !== JSON.stringify(configuration.subnets)
    || JSON.stringify(record.securityGroups) !== JSON.stringify(configuration.securityGroups)
  ) throw new Error('DATABASE_DRAIN_PROOF_TASK_RECORD_CONFIGURATION_MISMATCH');
}

function buildProofSource(configuration) {
  return buildStageDatabaseDrainProofBunSource({
    stageId: STAGE_ID,
    clusterId: STAGE_CLUSTER_ID,
    databaseId: STAGE_DATABASE_ID,
    databaseHost: configuration.databaseHost,
    databaseName: DATABASE_NAME,
    statementTimeoutMs: 4_000,
  });
}

function stackOutputs(response, stackName) {
  const stack = response?.Stacks?.length === 1 ? response.Stacks[0] : null;
  if (stack?.StackName !== stackName || typeof stack.StackStatus !== 'string' || stack.StackStatus.includes('DELETE')) {
    throw new Error('DATABASE_DRAIN_PROOF_STACK_INVALID');
  }
  if (!Array.isArray(stack.Outputs)) throw new Error('DATABASE_DRAIN_PROOF_STACK_INVALID');
  const outputs = {};
  for (const output of stack.Outputs) {
    if (typeof output?.OutputKey !== 'string' || typeof output.OutputValue !== 'string' || output.OutputValue.length === 0) {
      throw new Error('DATABASE_DRAIN_PROOF_STACK_INVALID');
    }
    if (Object.hasOwn(outputs, output.OutputKey)) throw new Error('DATABASE_DRAIN_PROOF_STACK_INVALID');
    outputs[output.OutputKey] = output.OutputValue;
  }
  return outputs;
}

function requiredOutput(outputs, name) {
  const value = outputs[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error('DATABASE_DRAIN_PROOF_STACK_OUTPUT_INVALID');
  return value;
}

function proofTaskTags(nonce, sourceSha256) {
  return [
    { key: 'Owner', value: 'Lyra' },
    { key: 'Environment', value: 'staging' },
    { key: 'LyraStagingId', value: STAGE_ID },
    { key: 'ExpiresAt', value: '2026-10-10' },
    { key: 'LyraProofNonce', value: nonce },
    { key: 'LyraProofSourceSha256', value: sourceSha256 },
  ];
}

function exactTaskArn(value) {
  return typeof value === 'string'
    && new RegExp(`^arn:aws:ecs:${STAGE_REGION}:${STAGE_ACCOUNT_ID}:task/${STAGE_CLUSTER_ID}/[0-9a-f]{32}$`, 'u').test(value);
}

function taskIdFromArn(value) {
  return value.slice(value.lastIndexOf('/') + 1);
}

function requirePortDependencies({ cfn, ecs, logs, commands }) {
  if (
    typeof cfn?.send !== 'function'
    || typeof ecs?.send !== 'function'
    || typeof logs?.send !== 'function'
    || ['describeStacks', 'describeTaskDefinition', 'runTask', 'describeTasks', 'getLogEvents']
      .some((name) => typeof commands?.[name] !== 'function')
  ) throw new Error('DATABASE_DRAIN_PROOF_PORT_INVALID');
}

function canonicalAwsTimestamp(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(code);
  return date.toISOString();
}

function requireTimestamp(value, code) {
  if (!isCanonicalTimestamp(value)) throw new Error(code);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(Date.parse(value)).toISOString() === value;
}

function sha256(value) {
  if (typeof value !== 'string') throw new Error('DATABASE_DRAIN_PROOF_SOURCE_INVALID');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
