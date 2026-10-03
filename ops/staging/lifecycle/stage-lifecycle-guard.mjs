import {
  ApplicationAutoScalingClient,
  DeregisterScalableTargetCommand,
  DescribeScalableTargetsCommand,
  ListTagsForResourceCommand as ListScalingTagsCommand,
} from '@aws-sdk/client-application-auto-scaling';
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  DescribeServicesCommand,
  ECSClient,
  ListTagsForResourceCommand as ListEcsTagsCommand,
  ListTasksCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import { DescribeDBInstancesCommand, RDSClient, StopDBInstanceCommand } from '@aws-sdk/client-rds';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand, ListQueueTagsCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import {
  ACTIVE_START_AT,
  decideLifecycleAction,
  INITIAL_STATE,
  isCloudFormationStackNotFound,
  STAGE_CLUSTER_ID,
  STAGE_DATABASE_ID,
  STAGE_ID,
} from './stage-lifecycle-guard-core.mjs';
import { createStageDatabaseDrainInvokePort } from './stage-database-drain-invoke-port.mjs';
import { performLifecycleDecision, shouldCollectDatabaseDrainProof } from './stage-lifecycle-effects.mjs';

const account = '452284481392';
const region = 'ap-northeast-1';
const prefix = STAGE_ID;
const cluster = STAGE_CLUSTER_ID;
const baseDatabase = STAGE_DATABASE_ID;
const bucket = `${prefix}-build-${account}`;
const stateKey = 'lifecycle/guard-state.json';
const successKey = 'lifecycle/guard-success.json';
const errorKey = 'lifecycle/guard-last-error.json';
const databaseDrainProofKey = 'lifecycle/database-drain-proof.json';
const databaseDrainCleanupReceiptKey = 'lifecycle/database-drain-cleanup.json';
const dlqUrl = `https://sqs.${region}.amazonaws.com/${account}/${prefix}-lifecycle-dlq`;
const exactTargetArn = 'arn:aws:application-autoscaling:ap-northeast-1:452284481392:scalable-target/0ec516a28b068004442db2e9a491f8726c9b';
const services = ['api', 'generation', 'export', 'deletion'];
const queues = {
  generation: `${prefix}-generation`,
  generationDlq: `${prefix}-generation-dlq`,
  export: `${prefix}-export`,
  exportDlq: `${prefix}-export-dlq`,
};
const ownership = { Owner: 'Lyra', Environment: 'staging', LyraStagingId: prefix, ExpiresAt: '2026-10-10' };

const ecs = new ECSClient({ region });
const sqs = new SQSClient({ region });
const scaling = new ApplicationAutoScalingClient({ region });
const rds = new RDSClient({ region });
const cfn = new CloudFormationClient({ region });
const s3 = new S3Client({ region });
const tagging = new ResourceGroupsTaggingAPIClient({ region });
const proofLambda = new LambdaClient({ region });
const databaseDrainProofPort = createStageDatabaseDrainInvokePort({
  functionArn: process.env.DATABASE_DRAIN_EXECUTOR_ARN,
  lambda: proofLambda,
  invokeCommand: (input) => new InvokeCommand(input),
});

function tagsMatch(tags) {
  const tagMap = Array.isArray(tags)
    ? Object.fromEntries(tags.map(({ Key, key, Value, value }) => [Key ?? key, Value ?? value]))
    : tags;
  return Object.entries(ownership).every(([key, value]) => tagMap?.[key] === value);
}

function queueUrl(name) {
  return `https://sqs.${region}.amazonaws.com/${account}/${name}`;
}

async function readJson(key) {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error('STATE_BODY_MISSING');
    return JSON.parse(await response.Body.transformToString());
  } catch (error) {
    if (error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

async function writeJson(key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(value, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

async function describeStack(name) {
  try {
    const response = await cfn.send(new DescribeStacksCommand({ StackName: name }));
    const stack = response.Stacks?.[0];
    if (!stack?.StackStatus) throw new Error('STACK_INVENTORY_INCOMPLETE');
    return { exists: true, status: stack.StackStatus, owned: tagsMatch(stack.Tags) };
  } catch (error) {
    if (isCloudFormationStackNotFound(error, name)) return { exists: false };
    throw error;
  }
}

async function serviceInventory(runtimeExists) {
  if (!runtimeExists) {
    return Object.fromEntries(services.map((name) => [name, { desired: 0, running: 0, pending: 0, owned: true }]));
  }
  const response = await ecs.send(new DescribeServicesCommand({
    cluster,
    services: services.map((name) => `${prefix}-${name}`),
  }));
  if (response.services?.length !== services.length || response.failures?.length) throw new Error('SERVICE_INVENTORY_INCOMPLETE');
  const result = {};
  for (const service of response.services) {
    if (!service.serviceName?.startsWith(`${prefix}-`)) throw new Error('SERVICE_NAME_MISMATCH');
    const desired = requireNonNegativeCount(service.desiredCount, 'SERVICE_DESIRED_INVALID');
    const running = requireNonNegativeCount(service.runningCount, 'SERVICE_RUNNING_INVALID');
    const pending = requireNonNegativeCount(service.pendingCount, 'SERVICE_PENDING_INVALID');
    const name = service.serviceName.slice(`${prefix}-`.length);
    const tags = await ecs.send(new ListEcsTagsCommand({ resourceArn: service.serviceArn }));
    result[name] = {
      desired,
      running,
      pending,
      owned: tagsMatch(tags.tags),
    };
  }
  return result;
}

async function queueInventory(foundationExists) {
  if (!foundationExists) {
    return Object.fromEntries(Object.keys(queues).map((name) => [name, { visible: 0, inflight: 0, delayed: 0, owned: true }]));
  }
  const result = {};
  for (const [key, name] of Object.entries(queues)) {
    const QueueUrl = queueUrl(name);
    const [attributes, tags] = await Promise.all([
      sqs.send(new GetQueueAttributesCommand({
        QueueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      })),
      sqs.send(new ListQueueTagsCommand({ QueueUrl })),
    ]);
    result[key] = {
      visible: requireQueueCount(attributes.Attributes, 'ApproximateNumberOfMessages'),
      inflight: requireQueueCount(attributes.Attributes, 'ApproximateNumberOfMessagesNotVisible'),
      delayed: requireQueueCount(attributes.Attributes, 'ApproximateNumberOfMessagesDelayed'),
      owned: tagsMatch(tags.Tags),
    };
  }
  return result;
}

async function targetInventory(runtimeExists) {
  if (!runtimeExists) return { exists: false };
  const response = await scaling.send(new DescribeScalableTargetsCommand({
    ServiceNamespace: 'ecs',
    ResourceIds: [`service/${cluster}/${prefix}-generation`],
    ScalableDimension: 'ecs:service:DesiredCount',
  }));
  if (response.ScalableTargets?.length === 0) return { exists: false };
  if (response.ScalableTargets?.length !== 1) throw new Error('SCALABLE_TARGET_INVENTORY_MISMATCH');
  const target = response.ScalableTargets[0];
  const tags = await scaling.send(new ListScalingTagsCommand({ ResourceARN: target.ScalableTargetARN }));
  return {
    exists: true,
    owned: tagsMatch(tags.Tags),
    exact: target.ScalableTargetARN === exactTargetArn && target.MinCapacity === 0 && target.MaxCapacity === 1,
  };
}

async function databaseInventory(foundationExists) {
  if (!foundationExists) return { database: { exists: false }, extraOwnedDatabaseIds: [] };
  const ownedArns = await listOwnedDatabaseArns();
  const extraOwnedDatabaseIds = ownedArns
    .map((arn) => arn.slice(arn.lastIndexOf(':') + 1))
    .filter((identifier) => identifier !== baseDatabase);
  try {
    const response = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: baseDatabase }));
    const instance = response.DBInstances?.[0];
    if (!instance?.DBInstanceArn || !instance.DBInstanceStatus) throw new Error('DATABASE_INVENTORY_INCOMPLETE');
    return {
      database: { exists: true, status: instance.DBInstanceStatus, owned: ownedArns.includes(instance.DBInstanceArn) },
      extraOwnedDatabaseIds,
    };
  } catch (error) {
    if (error?.name === 'DBInstanceNotFound' || error?.name === 'DBInstanceNotFoundFault') {
      return { database: { exists: false }, extraOwnedDatabaseIds };
    }
    throw error;
  }
}

async function listOwnedDatabaseArns() {
  const result = [];
  let PaginationToken;
  do {
    const response = await tagging.send(new GetResourcesCommand({
      ResourceTypeFilters: ['rds:db'],
      TagFilters: [{ Key: 'LyraStagingId', Values: [prefix] }],
      PaginationToken,
    }));
    for (const mapping of response.ResourceTagMappingList ?? []) {
      if (!mapping.ResourceARN) throw new Error('DATABASE_TAG_INVENTORY_INCOMPLETE');
      if (!tagsMatch(mapping.Tags)) throw new Error('DATABASE_TAG_MISMATCH');
      result.push(mapping.ResourceARN);
    }
    PaginationToken = response.PaginationToken || undefined;
  } while (PaginationToken);
  return result;
}

async function collectInventory() {
  const [runtimeStack, foundationStack, proofExecutorStack] = await Promise.all([
    describeStack(`${prefix}-runtime`),
    describeStack(`${prefix}-foundation`),
    describeStack(`${prefix}-database-drain-proof`),
  ]);
  const [
    serviceState,
    queueState,
    scalableTarget,
    databaseState,
    runningTasks,
    pendingTasks,
    databaseDrainProof,
    databaseDrainCleanupReceipt,
  ] = await Promise.all([
    serviceInventory(runtimeStack.exists),
    queueInventory(foundationStack.exists),
    targetInventory(runtimeStack.exists),
    databaseInventory(foundationStack.exists),
    foundationStack.exists
      ? ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'RUNNING' }))
      : { taskArns: [] },
    foundationStack.exists
      ? ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'PENDING' }))
      : { taskArns: [] },
    readJson(databaseDrainProofKey),
    readJson(databaseDrainCleanupReceiptKey),
  ]);
  if (runningTasks.nextToken || pendingTasks.nextToken) throw new Error('TASK_INVENTORY_PAGINATED');
  if (!Array.isArray(runningTasks.taskArns) || !Array.isArray(pendingTasks.taskArns)) {
    throw new Error('TASK_INVENTORY_INCOMPLETE');
  }
  const taskArns = [...runningTasks.taskArns, ...pendingTasks.taskArns];
  if (taskArns.some((arn) => typeof arn !== 'string' || !arn.startsWith(`arn:aws:ecs:${region}:${account}:task/${cluster}/`) || !/^[0-9a-f]{32}$/u.test(arn.split('/').at(-1)))) throw new Error('TASK_INVENTORY_IDENTITY_INVALID');
  const totalTaskCount = new Set(taskArns).size;
  const taskCounts = { clusterTaskCount: totalTaskCount, readOnlyProofTaskCount: 0, unknownClusterTaskCount: totalTaskCount };
  for (const [name, service] of Object.entries(serviceState)) {
    if (!service.owned) throw new Error(`SERVICE_NOT_OWNED_${name}`);
  }
  for (const [name, queue] of Object.entries(queueState)) {
    if (!queue.owned) throw new Error(`QUEUE_NOT_OWNED_${name}`);
  }
  return {
    taskArns,
    inventory: {
      ...serviceState,
      queues: queueState,
      scalableTarget,
      database: databaseState.database,
      extraOwnedDatabaseIds: databaseState.extraOwnedDatabaseIds,
      runtimeStack,
      foundationStack,
      proofExecutorStack,
      databaseDrainProof,
      databaseDrainCleanupReceipt,
      ...taskCounts,
    },
  };
}

function requireQueueCount(attributes, name) {
  const raw = attributes?.[name];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error(`QUEUE_ATTRIBUTE_INVALID_${name}`);
  return requireNonNegativeCount(Number(raw), `QUEUE_ATTRIBUTE_INVALID_${name}`);
}

function requireNonNegativeCount(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function parseState(value) {
  if (value === null) return { ...INITIAL_STATE };
  if (typeof value !== 'object' || value.version !== 1) throw new Error('STATE_INVALID');
  const merged = { ...INITIAL_STATE, ...value };
  const booleanNames = [
    'apiStopRequested',
    'scalingDeregistered',
    'generationStopRequested',
    'databaseStopRequested',
    'runtimeDeleteRequested',
    'foundationDeleteRequested',
  ];
  if (!Number.isSafeInteger(merged.zeroStreak) || merged.zeroStreak < 0) throw new Error('STATE_INVALID');
  if (booleanNames.some((name) => typeof merged[name] !== 'boolean')) throw new Error('STATE_INVALID');
  for (const name of [
    'apiStopRequestedAt',
    'apiStoppedAt',
    'workersStoppedAt',
    'databaseDrainProofObservedAt',
    'databaseContractCleanupObservedAt',
  ]) {
    if (merged[name] !== null && (
      typeof merged[name] !== 'string' ||
      !Number.isFinite(Date.parse(merged[name])) ||
      new Date(Date.parse(merged[name])).toISOString() !== merged[name]
    )) throw new Error('STATE_INVALID');
  }
  return Object.fromEntries(Object.keys(INITIAL_STATE).map((name) => [name, merged[name]]));
}

async function perform(action) {
  if (action === 'stop-api') {
    await ecs.send(new UpdateServiceCommand({ cluster, service: `${prefix}-api`, desiredCount: 0 }));
  } else if (action === 'deregister-scaling') {
    await scaling.send(new DeregisterScalableTargetCommand({
      ServiceNamespace: 'ecs',
      ResourceId: `service/${cluster}/${prefix}-generation`,
      ScalableDimension: 'ecs:service:DesiredCount',
    }));
  } else if (action === 'stop-generation') {
    await ecs.send(new UpdateServiceCommand({ cluster, service: `${prefix}-generation`, desiredCount: 0 }));
  } else if (action === 'stop-database') {
    await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: baseDatabase }));
  } else if (action === 'delete-runtime') {
    await cfn.send(new DeleteStackCommand({ StackName: `${prefix}-runtime` }));
  } else if (action === 'delete-proof-executor') {
    await cfn.send(new DeleteStackCommand({ StackName: `${prefix}-database-drain-proof` }));
  } else if (action === 'delete-foundation') {
    await cfn.send(new DeleteStackCommand({ StackName: `${prefix}-foundation` }));
  }
}

async function recordFailure(error, context) {
  const safe = {
    at: new Date().toISOString(),
    code: error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256),
    requestId: context?.awsRequestId,
    stageId: prefix,
  };
  await Promise.allSettled([
    writeJson(errorKey, safe),
    sqs.send(new SendMessageCommand({ QueueUrl: dlqUrl, MessageBody: JSON.stringify(safe) })),
  ]);
}

export async function handler(event = {}, context = {}) {
  const mode = event?.mode === 'inspect' || event?.mode === 'active' ? event.mode : 'invalid';
  try {
    if (mode === 'invalid') throw new Error('MODE_UNSUPPORTED');
    const expectedFunctionArn = `arn:aws:lambda:${region}:${account}:function:${prefix}-lifecycle-guard`;
    if (
      context.invokedFunctionArn !== expectedFunctionArn &&
      !new RegExp(`^${expectedFunctionArn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+$`).test(context.invokedFunctionArn ?? '')
    ) {
      throw new Error('FUNCTION_IDENTITY_MISMATCH');
    }
    const now = mode === 'inspect' && event.now ? event.now : new Date().toISOString();
    const state = mode === 'inspect' ? { ...INITIAL_STATE } : parseState(await readJson(stateKey));
    const collected = await collectInventory();
    const inventory = collected.inventory;
    const decision = decideLifecycleAction({ mode, now, state, inventory });
    if (mode === 'inspect') return { mode, now, decision, inventory, mutated: false };
    if (decision.action.startsWith('error-')) throw new Error(decision.action.toUpperCase());
    let action = decision.action;
    let mutated = decision.mutates;
    let details = decision.details;
    if (shouldCollectDatabaseDrainProof({ action, nowUtc: now, state: decision.nextState, inventory })) {
      const safePointAtUtc = decision.nextState.workersStoppedAt ?? decision.nextState.apiStoppedAt;
      if (safePointAtUtc === null) throw new Error('DATABASE_DRAIN_PROOF_SAFE_POINT_MISSING');
      await writeJson(stateKey, { ...decision.nextState, lastAction: action, lastCheckedAt: now });
      const proof = await databaseDrainProofPort.collect({ nowUtc: now, safePointAtUtc });
      await writeJson(databaseDrainProofKey, proof);
      action = 'collect-db-drain-proof';
      mutated = true;
      details = { ...details, safePointAtUtc, observedAtUtc: proof.observedAtUtc };
    } else if (decision.mutates) {
      await performLifecycleDecision({ decision, now, writeState: (value) => writeJson(stateKey, value), perform });
    }
    const recorded = { ...decision.nextState, lastAction: action, lastCheckedAt: now };
    if (action === 'success') {
      await writeJson(successKey, {
        completedAt: now,
        stageId: prefix,
        retainedResourcesRequireReview: ['kms-key', 'assets-bucket', 'build-bucket', 'rds-final-snapshot', 'runtime-secret', 'iam-resources', 'lifecycle-guard-resources'],
        statement: 'Stack deletion completed; retained-resource deletion and zero ongoing cost are not asserted.',
      });
    }
    await writeJson(stateKey, recorded);
    return { mode, now, action, mutated, details };
  } catch (error) {
    if (mode === 'active') await recordFailure(error, context);
    throw error;
  }
}
