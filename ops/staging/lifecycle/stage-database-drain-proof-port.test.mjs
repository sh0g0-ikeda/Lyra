import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  classifyDatabaseDrainProofTasks,
  createStageDatabaseDrainProofPort,
  parseDatabaseDrainProofTaskRecord,
  shouldStartDatabaseDrainProofTask,
} from './stage-database-drain-proof-port.mjs';

const region = 'ap-northeast-1';
const account = '452284481392';
const stageId = 'lyra-staging-20261003';
const clusterArn = `arn:aws:ecs:${region}:${account}:cluster/${stageId}-cluster`;
const taskDefinitionArn = `arn:aws:ecs:${region}:${account}:task-definition/${stageId}-migration:2`;
const migrationTaskRoleArn = `arn:aws:iam::${account}:role/${stageId}-migration-task`;
const executionRoleArn = `arn:aws:iam::${account}:role/${stageId}-execution`;
const imageDigest = 'c9f57110768bd77ca4ae45d117d0c9ea75f058236933cab9ef2418e517e68667';
const repositoryUri = `${account}.dkr.ecr.${region}.amazonaws.com/${stageId}-api`;
const image = `${repositoryUri}@sha256:${imageDigest}`;
const workerLogGroup = `/lyra/${stageId}/worker`;
const subnetA = 'subnet-0000000000000000a';
const subnetC = 'subnet-0000000000000000c';
const workerSecurityGroup = 'sg-00000000000000001';
const databaseHost = `${stageId}-db.abcdefghijkl.${region}.rds.amazonaws.com`;
const taskId = '0123456789abcdef0123456789abcdef';
const taskArn = `arn:aws:ecs:${region}:${account}:task/${stageId}-cluster/${taskId}`;
const now = '2026-10-09T15:03:00.000Z';
const safePoint = '2026-10-09T15:02:00.000Z';
const foundationTemplate = JSON.parse(readFileSync(new URL('../foundation.json', import.meta.url), 'utf8'));
const templateDatabaseName = foundationTemplate.Resources.StagingDatabase.Properties.DBName;

const runtimeOutputs = {
  MigrationTaskDefinitionArn: taskDefinitionArn,
  MigrationTaskRoleArn: migrationTaskRoleArn,
  ExecutionRoleArn: executionRoleArn,
};
const foundationOutputs = {
  EcsClusterArn: clusterArn,
  EcrRepositoryUri: repositoryUri,
  PublicSubnetAId: subnetA,
  PublicSubnetCId: subnetC,
  WorkerSecurityGroupId: workerSecurityGroup,
  WorkerLogGroupName: workerLogGroup,
  DatabaseEndpoint: databaseHost,
};

function stack(name, outputs) {
  return {
    Stacks: [{
      StackName: name,
      StackStatus: 'UPDATE_COMPLETE',
      Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
    }],
  };
}

function taskDefinition() {
  return {
    taskDefinition: {
      taskDefinitionArn,
      family: `${stageId}-migration`,
      revision: 2,
      taskRoleArn: migrationTaskRoleArn,
      executionRoleArn,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
      containerDefinitions: [{
        name: 'migration',
        essential: true,
        image,
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': workerLogGroup,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'migration',
          },
        },
      }],
    },
  };
}

function commands() {
  return {
    describeStacks: (input) => ({ kind: 'DescribeStacks', input }),
    describeTaskDefinition: (input) => ({ kind: 'DescribeTaskDefinition', input }),
    runTask: (input) => ({ kind: 'RunTask', input }),
    describeTasks: (input) => ({ kind: 'DescribeTasks', input }),
    getLogEvents: (input) => ({ kind: 'GetLogEvents', input }),
  };
}

function proof(observedAtUtc = '2026-10-09T15:03:31.000Z') {
  return {
    kind: 'lyra-staging-db-drain-proof',
    schemaVersion: 1,
    stageId,
    clusterId: `${stageId}-cluster`,
    databaseId: `${stageId}-db`,
    observedAtUtc,
    counters: {
      activeGenerationJobs: 0,
      pendingGenerationDispatches: 0,
      activeEpisodeExportJobs: 0,
      pendingEpisodeExportOutbox: 0,
      activeAccountDeletionRequests: 0,
      pendingPushDeliveries: 0,
      pendingCreditRefunds: 0,
    },
  };
}

function createMockPort() {
  const calls = [];
  let runInput;
  let describedTask;
  let logResponses = [];
  let definitionResponse = taskDefinition();
  let includeRunResponseEvidence = true;
  const cfn = {
    async send(command) {
      calls.push(command);
      if (command.input.StackName === `${stageId}-runtime`) return stack(command.input.StackName, runtimeOutputs);
      if (command.input.StackName === `${stageId}-foundation`) return stack(command.input.StackName, foundationOutputs);
      throw new Error('unexpected stack');
    },
  };
  const ecs = {
    async send(command) {
      calls.push(command);
      if (command.kind === 'DescribeTaskDefinition') return definitionResponse;
      if (command.kind === 'RunTask') {
        runInput = command.input;
        const task = {
          taskArn,
          clusterArn,
          taskDefinitionArn,
          startedBy: command.input.startedBy,
          group: `family:${stageId}-migration`,
          launchType: 'FARGATE',
          lastStatus: 'PROVISIONING',
          createdAt: new Date(now),
          attachments: [{ type: 'ElasticNetworkInterface', details: [{ name: 'subnetId', value: subnetA }] }],
          containers: [{ name: 'migration' }],
        };
        if (includeRunResponseEvidence) {
          task.tags = command.input.tags;
          task.overrides = command.input.overrides;
        }
        return {
          failures: [],
          tasks: [task],
        };
      }
      if (command.kind === 'DescribeTasks') return { failures: [], tasks: [describedTask] };
      throw new Error(`unexpected ECS command ${command.kind}`);
    },
  };
  const logs = {
    async send(command) {
      calls.push(command);
      if (command.kind !== 'GetLogEvents') throw new Error('unexpected logs command');
      return logResponses.shift() ?? { events: [], nextForwardToken: command.input.nextToken ?? 'end' };
    },
  };
  return {
    calls,
    port: createStageDatabaseDrainProofPort({ cfn, ecs, logs, commands: commands() }),
    runInput: () => runInput,
    setDescribedTask: (task) => { describedTask = task; },
    setLogResponses: (responses) => { logResponses = [...responses]; },
    setTaskDefinitionResponse: (response) => { definitionResponse = response; },
    omitRunResponseEvidence: () => { includeRunResponseEvidence = false; },
  };
}

test('start validates exact CFN outputs and task definition before one bounded RunTask', async () => {
  const mock = createMockPort();
  const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'first' });
  const input = mock.runInput();

  assert.equal(input.cluster, clusterArn);
  assert.equal(input.taskDefinition, taskDefinitionArn);
  assert.equal(input.count, 1);
  assert.equal(input.launchType, 'FARGATE');
  assert.deepEqual(input.networkConfiguration.awsvpcConfiguration, {
    assignPublicIp: 'ENABLED',
    subnets: [subnetA, subnetC],
    securityGroups: [workerSecurityGroup],
  });
  assert.equal(input.overrides.containerOverrides[0].name, 'migration');
  assert.deepEqual(input.overrides.containerOverrides[0].command.slice(0, 2), ['/usr/local/bin/bun', '-e']);
  assert.ok(JSON.stringify(input.overrides).length <= 8_192);
  assert.equal(record.taskArn, taskArn);
  assert.equal(record.taskDefinitionArn, taskDefinitionArn);
  assert.equal(record.imageDigest, imageDigest);
  assert.equal(record.safePointAtUtc, safePoint);
  assert.deepEqual(parseDatabaseDrainProofTaskRecord(record), record);
  assert.equal(mock.calls.filter(({ kind }) => kind === 'RunTask').length, 1);
});

test('the generated reader targets the database name declared by the stage foundation template', async () => {
  assert.equal(templateDatabaseName, 'lyrastaging');
  const mock = createMockPort();
  await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'template-db-name' });
  const source = mock.runInput().overrides.containerOverrides[0].command[2];
  assert.match(source, new RegExp(`!==${JSON.stringify(templateDatabaseName)}`, 'u'));
});

test('RunTask may omit response tags and overrides because polling revalidates persisted runtime evidence', async () => {
  const mock = createMockPort();
  mock.omitRunResponseEvidence();
  const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'response-shape' });
  assert.equal(record.taskArn, taskArn);
});

test('the same persisted safe point produces the same ECS idempotency token', async () => {
  const mock = createMockPort();
  const first = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: safePoint });
  const second = await mock.port.start({ nowUtc: '2026-10-09T15:04:00.000Z', safePointAtUtc: safePoint, attemptKey: safePoint });
  const runCalls = mock.calls.filter(({ kind }) => kind === 'RunTask');
  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].input.clientToken, runCalls[1].input.clientToken);
  assert.equal(first.nonce, second.nonce);
  assert.equal(first.sourceSha256, second.sourceSha256);
  assert.equal(first.startedAtUtc, second.startedAtUtc);
});

test('pending task is polled without starting another task', async () => {
  const mock = createMockPort();
  const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'pending' });
  mock.setDescribedTask({
    taskArn,
    clusterArn,
    taskDefinitionArn,
    startedBy: record.startedBy,
    group: `family:${stageId}-migration`,
    launchType: 'FARGATE',
    lastStatus: 'RUNNING',
    tags: mock.runInput().tags,
    overrides: mock.runInput().overrides,
    attachments: [{ type: 'ElasticNetworkInterface', details: [{ name: 'subnetId', value: subnetA }] }],
    containers: [{ name: 'migration', lastStatus: 'RUNNING' }],
  });

  const result = await mock.port.poll({ record, nowUtc: '2026-10-09T15:04:00.000Z' });

  assert.equal(result.status, 'pending');
  assert.equal(mock.calls.filter(({ kind }) => kind === 'RunTask').length, 1);
  assert.equal(mock.calls.filter(({ kind }) => kind === 'GetLogEvents').length, 0);
});

test('poll rejects a task record created from any other proof source', async () => {
  const mock = createMockPort();
  const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'old-source' });
  await assert.rejects(() => mock.port.poll({
    record: { ...record, sourceSha256: 'a'.repeat(64) },
    nowUtc: '2026-10-09T15:04:00.000Z',
  }), /DATABASE_DRAIN_PROOF_TASK_RECORD_CONFIGURATION_MISMATCH/u);
});

test('only the exact task validated by the proof port is excluded from unknown cluster work', () => {
  const otherTaskArn = `arn:aws:ecs:${region}:${account}:task/${stageId}-cluster/fedcba9876543210fedcba9876543210`;
  assert.deepEqual(classifyDatabaseDrainProofTasks([taskArn, otherTaskArn], taskArn), {
    clusterTaskCount: 2,
    readOnlyProofTaskCount: 1,
    unknownClusterTaskCount: 1,
  });
  assert.deepEqual(classifyDatabaseDrainProofTasks([taskArn], null), {
    clusterTaskCount: 1,
    readOnlyProofTaskCount: 0,
    unknownClusterTaskCount: 1,
  });
  assert.throws(() => classifyDatabaseDrainProofTasks([taskArn, taskArn], taskArn));
  assert.throws(() => classifyDatabaseDrainProofTasks([
    `arn:aws:ecs:us-east-1:${account}:task/${stageId}-cluster/${taskId}`,
  ], null));
});

test('stopped exit-zero exact task accepts one bounded proof log after quiet confirmation', async () => {
  const mock = createMockPort();
  const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: 'complete' });
  mock.setDescribedTask({
    taskArn,
    clusterArn,
    taskDefinitionArn,
    startedBy: record.startedBy,
    group: `family:${stageId}-migration`,
    launchType: 'FARGATE',
    lastStatus: 'STOPPED',
    desiredStatus: 'STOPPED',
    stopCode: 'EssentialContainerExited',
    stoppedAt: new Date('2026-10-09T15:03:20.000Z'),
    tags: mock.runInput().tags,
    overrides: {
      ...mock.runInput().overrides,
      containerOverrides: [{
        ...mock.runInput().overrides.containerOverrides[0],
        environment: [],
        environmentFiles: [],
        resourceRequirements: [],
      }],
      taskRoleArn: migrationTaskRoleArn,
      executionRoleArn,
      inferenceAcceleratorOverrides: [],
    },
    attachments: [{ type: 'ElasticNetworkInterface', details: [{ name: 'subnetId', value: subnetA }] }],
    containers: [{ name: 'migration', lastStatus: 'STOPPED', exitCode: 0 }],
  });
  mock.setLogResponses([
    { events: [{ message: `LYRA_STAGE_DATABASE_DRAIN_PROOF ${JSON.stringify(proof())}` }], nextForwardToken: 'end' },
    { events: [], nextForwardToken: 'end' },
  ]);

  const result = await mock.port.poll({ record, nowUtc: '2026-10-09T15:04:00.000Z' });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.proof, proof());
  assert.equal(mock.calls.filter(({ kind }) => kind === 'RunTask').length, 1);
  assert.equal(mock.calls.filter(({ kind }) => kind === 'GetLogEvents').length, 2);
});

test('source hash, task role, network, exit, or additional log mismatch fails closed', async () => {
  const cases = [
    { name: 'source hash', mutate: ({ task }) => { task.overrides.containerOverrides[0].command[2] += ' '; } },
    { name: 'tag', mutate: ({ task }) => { task.tags.find(({ key }) => key === 'LyraProofNonce').value = '0'.repeat(32); } },
    { name: 'task definition role', mutate: ({ definition }) => { definition.taskDefinition.taskRoleArn = executionRoleArn; } },
    { name: 'task role override', mutate: ({ task }) => { task.overrides.taskRoleArn = executionRoleArn; } },
    { name: 'execution role override', mutate: ({ task }) => { task.overrides.executionRoleArn = migrationTaskRoleArn; } },
    {
      name: 'accelerator override',
      mutate: ({ task }) => { task.overrides.inferenceAcceleratorOverrides = [{ deviceName: 'device0', deviceType: 'eia1.medium' }]; },
    },
    {
      name: 'environment override',
      mutate: ({ task }) => { task.overrides.containerOverrides[0].environment = [{ name: 'DATABASE_URL', value: 'unexpected' }]; },
    },
    { name: 'network', mutate: ({ task }) => { task.attachments[0].details[0].value = 'subnet-foreign'; } },
    { name: 'exit', mutate: ({ task }) => { task.containers[0].exitCode = 1; } },
    { name: 'logs', mutate: ({ logs }) => { logs.push({ message: 'unexpected output' }); } },
  ];
  for (const entry of cases) {
    const mock = createMockPort();
    const record = await mock.port.start({ nowUtc: now, safePointAtUtc: safePoint, attemptKey: entry.name.replaceAll(' ', '-') });
    const definition = taskDefinition();
    const task = {
      taskArn,
      clusterArn,
      taskDefinitionArn,
      startedBy: record.startedBy,
      group: `family:${stageId}-migration`,
      launchType: 'FARGATE',
      lastStatus: 'STOPPED',
      desiredStatus: 'STOPPED',
      stopCode: 'EssentialContainerExited',
      stoppedAt: new Date('2026-10-09T15:03:20.000Z'),
      tags: structuredClone(mock.runInput().tags),
      overrides: structuredClone(mock.runInput().overrides),
      attachments: [{ type: 'ElasticNetworkInterface', details: [{ name: 'subnetId', value: subnetA }] }],
      containers: [{ name: 'migration', lastStatus: 'STOPPED', exitCode: 0 }],
    };
    const logEvents = [{ message: `LYRA_STAGE_DATABASE_DRAIN_PROOF ${JSON.stringify(proof())}` }];
    entry.mutate({ definition, task, logs: logEvents });
    if (entry.name === 'task definition role') {
      mock.setTaskDefinitionResponse(definition);
    }
    mock.setDescribedTask(task);
    mock.setLogResponses([
      { events: logEvents, nextForwardToken: 'end' },
      { events: [], nextForwardToken: 'end' },
    ]);
    await assert.rejects(() => mock.port.poll({ record, nowUtc: '2026-10-09T15:04:00.000Z' }), undefined, entry.name);
  }
});

test('start predicate forbids inspect, pre-schedule, sealed database, and pending task retries', () => {
  const base = {
    mode: 'active',
    nowUtc: '2026-10-08T16:11:00.000Z',
    action: 'wait-db-drain',
    state: { databaseStopRequested: false },
    inventory: {
      api: { desired: 0, running: 0, pending: 0 },
      database: { exists: true, owned: true, status: 'available' },
      readOnlyProofTaskCount: 0,
    },
    taskRecord: null,
  };
  assert.equal(shouldStartDatabaseDrainProofTask(base), true);
  assert.equal(shouldStartDatabaseDrainProofTask({ ...base, mode: 'inspect' }), false);
  assert.equal(shouldStartDatabaseDrainProofTask({ ...base, nowUtc: '2026-10-08T16:09:59.999Z' }), false);
  assert.equal(shouldStartDatabaseDrainProofTask({ ...base, state: { databaseStopRequested: true } }), false);
  assert.equal(shouldStartDatabaseDrainProofTask({
    ...base,
    inventory: { ...base.inventory, database: { exists: true, owned: true, status: 'stopped' } },
  }), false);
  assert.equal(shouldStartDatabaseDrainProofTask({ ...base, taskRecord: { status: 'pending' } }), false);
  assert.equal(shouldStartDatabaseDrainProofTask({ ...base, inventory: { ...base.inventory, readOnlyProofTaskCount: 1 } }), false);
});
