import { z } from 'zod';

const awsAccountIdSchema = z.string().regex(/^\d{12}$/u);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const taskDefinitionSchema = z.string().regex(/^[A-Za-z0-9_-]+:\d+$/u);
const migrationFilenameSchema = z.string().min(1).max(200).regex(/^\d{3}_[A-Za-z0-9_]+\.sql$/u);

const scheduledActionSchema = z
  .object({
    name: z.string().min(1).max(256),
    schedule: z.string().min(1).max(256),
    minCapacity: z.number().int().min(0).max(100),
    maxCapacity: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((value) => value.minCapacity <= value.maxCapacity, {
    message: 'Scheduled action minCapacity must not exceed maxCapacity',
  });

const stepAdjustmentSchema = z
  .object({
    metricIntervalLowerBound: z.number().finite().optional(),
    metricIntervalUpperBound: z.number().finite().optional(),
    scalingAdjustment: z.number().int().min(-100).max(100),
  })
  .strict()
  .refine(
    (value) =>
      value.metricIntervalLowerBound === undefined ||
      value.metricIntervalUpperBound === undefined ||
      value.metricIntervalLowerBound < value.metricIntervalUpperBound,
    { message: 'Scaling policy lower bound must be below upper bound' },
  );

const scalingPolicySchema = z
  .object({
    name: z.string().min(1).max(256),
    policyType: z.literal('StepScaling'),
    adjustmentType: z.enum([
      'ChangeInCapacity',
      'ExactCapacity',
      'PercentChangeInCapacity',
    ]),
    cooldown: z.number().int().min(0).max(86_400),
    metricAggregationType: z.enum(['Average', 'Minimum', 'Maximum']),
    stepAdjustments: z.array(stepAdjustmentSchema).min(1).max(20),
  })
  .strict();

const scalingSuspendedStateSchema = z
  .object({
    dynamicScalingInSuspended: z.boolean(),
    dynamicScalingOutSuspended: z.boolean(),
    scheduledScalingSuspended: z.boolean(),
  })
  .strict();

const serviceCheckpointSchema = z
  .object({
    serviceName: z.string().min(1).max(255),
    taskDefinition: taskDefinitionSchema,
    containerName: z.string().min(1).max(255),
    desiredCount: z.number().int().min(0).max(100),
    imageUri: z.string().min(1).max(2048),
    cpuArchitecture: z.literal('ARM64').default('ARM64'),
  })
  .strict();

const ecrCheckpointSchema = z
  .object({
    repositoryName: z.string().min(2).max(256),
    releaseTag: z.string().min(1).max(300),
    checkpointTag: z.string().min(1).max(300).startsWith('checkpoint-'),
    digest: sha256DigestSchema,
  })
  .strict();

export const rollbackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkpointId: z.string().min(1).max(80),
    confirmationToken: z.string().min(8).max(80),
    capturedAt: z.string().datetime({ offset: true }),
    git: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/u),
      })
      .strict(),
    aws: z
      .object({
        accountId: awsAccountIdSchema,
        region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/u),
        clusterName: z.string().min(1).max(255),
        services: z
          .object({
            api: serviceCheckpointSchema,
            worker: serviceCheckpointSchema,
          })
          .strict(),
        ecrImages: z
          .object({
            api: ecrCheckpointSchema,
            worker: ecrCheckpointSchema,
          })
          .strict(),
        secret: z
          .object({
            secretId: z.string().min(1).max(512),
            versionId: z.string().uuid(),
            checkpointStage: z.string().min(1).max(256).startsWith('LYRA_CHECKPOINT_'),
          })
          .strict(),
        queue: z
          .object({
            name: z.string().min(1).max(80),
          })
          .strict(),
        cloudFront: z
          .object({
            distributionId: z.string().regex(/^[A-Z0-9]+$/u),
            healthUrl: z.string().url().startsWith('https://'),
            readinessUrl: z.string().url().startsWith('https://'),
          })
          .strict(),
        workerScaling: z
          .object({
            serviceNamespace: z.literal('ecs'),
            scalableDimension: z.literal('ecs:service:DesiredCount'),
            resourceId: z.string().startsWith('service/').max(1600),
            minCapacity: z.number().int().min(0).max(100),
            maxCapacity: z.number().int().min(1).max(100),
            suspendedState: scalingSuspendedStateSchema,
            policies: z
              .array(scalingPolicySchema)
              .min(1)
              .max(20)
              .refine(
                (policies) => new Set(policies.map((policy) => policy.name)).size === policies.length,
                { message: 'Worker scaling policy names must be unique' },
              ),
            scheduledActions: z.array(scheduledActionSchema).max(20),
          })
          .strict()
          .refine((value) => value.minCapacity <= value.maxCapacity, {
            message: 'Worker scaling minCapacity must not exceed maxCapacity',
          }),
      })
      .strict(),
    database: z
      .object({
        checkpointMigrations: z.array(migrationFilenameSchema).min(1).max(500),
        allowedForwardCompatibleMigrations: z.array(migrationFilenameSchema).max(100),
      })
      .strict(),
  })
  .strict();

export type RollbackManifest = z.infer<typeof rollbackManifestSchema>;
export type ScheduledScalingAction = z.infer<typeof scheduledActionSchema>;
export type ScalingSuspendedState = z.infer<typeof scalingSuspendedStateSchema>;
export type ScalingPolicyConfiguration = z.infer<typeof scalingPolicySchema>;

export interface ObservedTaskDefinition {
  status: string;
  containerName: string;
  imageUri: string;
  cpuArchitecture: string;
}

export interface RollbackObservation {
  accountId: string;
  region: string;
  ecrDigests: {
    api: {
      checkpoint: string;
      release: string;
    };
    worker: {
      checkpoint: string;
      release: string;
    };
  };
  taskDefinitions: {
    api: ObservedTaskDefinition;
    worker: ObservedTaskDefinition;
  };
  checkpointSecretVersionId: string | null;
  queue: {
    visibleMessages: number;
    inFlightMessages: number;
    delayedMessages: number;
  };
  appliedMigrations: string[];
  activeGenerationJobs: number;
}

interface RuntimeServiceObservation {
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
}

export interface CheckpointRuntimeObservation {
  ecrDigests: RollbackObservation['ecrDigests'];
  api: RuntimeServiceObservation;
  worker: RuntimeServiceObservation;
  secretCurrentVersionId: string | null;
  workerScaling: {
    minCapacity: number;
    maxCapacity: number;
    suspendedState: ScalingSuspendedState;
    scheduledActions: ScheduledScalingAction[];
    policies: ScalingPolicyConfiguration[];
  };
}

export interface ProductionSnapshot {
  capturedAt: string;
  apiTaskDefinition: string;
  workerTaskDefinition: string;
  apiDesiredCount: number;
  workerDesiredCount: number;
  secretCurrentVersionId: string;
  workerScaling: {
    minCapacity: number;
    maxCapacity: number;
    suspendedState: ScalingSuspendedState;
    scheduledActions: ScheduledScalingAction[];
    policies: ScalingPolicyConfiguration[];
  };
}

export interface RollbackReceipt {
  schemaVersion: 1;
  checkpointId: string;
  createdAt: string;
  previous: ProductionSnapshot;
}

export type RollbackAction =
  | { kind: 'quiesce-worker-scaling'; maxCapacity: number }
  | { kind: 'stop-worker'; desiredCount: 0 }
  | { kind: 'wait-worker-stopped' }
  | { kind: 'stop-api'; desiredCount: 0 }
  | { kind: 'wait-api-stopped' }
  | { kind: 'verify-generation-quiescence' }
  | { kind: 'activate-checkpoint-secret'; versionId: string }
  | { kind: 'update-worker-task-definition'; taskDefinition: string }
  | { kind: 'update-api-task-definition'; taskDefinition: string; desiredCount: number }
  | { kind: 'wait-api-stable' }
  | { kind: 'invalidate-cloudfront'; distributionId: string }
  | {
      kind: 'restore-checkpoint-worker-scaling';
      minCapacity: number;
      maxCapacity: number;
      suspendedState: ScalingSuspendedState;
      policies: ScalingPolicyConfiguration[];
    }
  | { kind: 'start-checkpoint-worker'; desiredCount: number }
  | { kind: 'wait-worker-stable' }
  | { kind: 'verify-checkpoint-runtime' }
  | { kind: 'verify-public-health'; healthUrl: string; readinessUrl: string };

export type RecoveryAction =
  | { kind: 'quiesce-worker-scaling'; maxCapacity: number }
  | { kind: 'stop-worker'; desiredCount: 0 }
  | { kind: 'stop-api'; desiredCount: 0 }
  | { kind: 'restore-previous-secret'; versionId: string }
  | { kind: 'restore-previous-worker-task-definition'; taskDefinition: string }
  | { kind: 'restore-previous-api-task-definition'; taskDefinition: string }
  | {
      kind: 'restore-previous-desired-counts';
      apiDesiredCount: number;
      workerDesiredCount: number;
    }
  | { kind: 'wait-api-stable' }
  | { kind: 'wait-worker-stable' }
  | { kind: 'invalidate-cloudfront'; distributionId: string }
  | {
      kind: 'restore-previous-worker-scaling';
      minCapacity: number;
      maxCapacity: number;
      suspendedState: ScalingSuspendedState;
      scheduledActions: ScheduledScalingAction[];
      policies: ScalingPolicyConfiguration[];
    }
  | { kind: 'verify-public-health'; healthUrl: string; readinessUrl: string };

export class RollbackSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RollbackSafetyError';
  }
}

export function parseRollbackManifest(input: unknown): RollbackManifest {
  return rollbackManifestSchema.parse(input);
}

export function assertRollbackAuthorization(
  manifest: RollbackManifest,
  options: { apply: boolean; confirmation?: string },
): void {
  if (!options.apply) {
    return;
  }

  if (options.confirmation !== manifest.confirmationToken) {
    throw new RollbackSafetyError('Rollback confirmation token does not match');
  }
}

export function evaluateRollbackPreconditions(
  manifest: RollbackManifest,
  observation: RollbackObservation,
): string[] {
  const errors: string[] = [];

  if (observation.accountId !== manifest.aws.accountId) {
    errors.push('AWS account does not match the checkpoint manifest');
  }
  if (observation.region !== manifest.aws.region) {
    errors.push('AWS region does not match the checkpoint manifest');
  }

  evaluateImage(
    'API',
    'checkpoint',
    manifest.aws.ecrImages.api.digest,
    observation.ecrDigests.api.checkpoint,
    errors,
  );
  evaluateImage(
    'API',
    'release',
    manifest.aws.ecrImages.api.digest,
    observation.ecrDigests.api.release,
    errors,
  );
  evaluateImage(
    'Worker',
    'checkpoint',
    manifest.aws.ecrImages.worker.digest,
    observation.ecrDigests.worker.checkpoint,
    errors,
  );
  evaluateImage(
    'Worker',
    'release',
    manifest.aws.ecrImages.worker.digest,
    observation.ecrDigests.worker.release,
    errors,
  );
  evaluateTaskDefinition(
    'API',
    manifest.aws.services.api,
    observation.taskDefinitions.api,
    errors,
  );
  evaluateTaskDefinition(
    'Worker',
    manifest.aws.services.worker,
    observation.taskDefinitions.worker,
    errors,
  );

  if (observation.checkpointSecretVersionId !== manifest.aws.secret.versionId) {
    errors.push('Checkpoint Secret version does not match');
  }

  const queuedMessageCount =
    observation.queue.visibleMessages +
    observation.queue.inFlightMessages +
    observation.queue.delayedMessages;
  if (queuedMessageCount > 0) {
    errors.push('Generation queue must be empty before rollback');
  }
  if (observation.activeGenerationJobs > 0) {
    errors.push('Active generation jobs must be zero before rollback');
  }

  const supportedMigrations = new Set([
    ...manifest.database.checkpointMigrations,
    ...manifest.database.allowedForwardCompatibleMigrations,
  ]);
  const appliedMigrations = new Set(observation.appliedMigrations);
  for (const filename of manifest.database.checkpointMigrations) {
    if (!appliedMigrations.has(filename)) {
      errors.push(`Required database migration is missing: ${filename}`);
    }
  }
  for (const filename of observation.appliedMigrations) {
    if (!supportedMigrations.has(filename)) {
      errors.push(`Unsupported database migration: ${filename}`);
    }
  }

  return errors;
}

export function evaluateCheckpointRuntime(
  manifest: RollbackManifest,
  observation: CheckpointRuntimeObservation,
): string[] {
  const errors: string[] = [];

  evaluateImage(
    'API',
    'checkpoint',
    manifest.aws.ecrImages.api.digest,
    observation.ecrDigests.api.checkpoint,
    errors,
  );
  evaluateImage(
    'API',
    'release',
    manifest.aws.ecrImages.api.digest,
    observation.ecrDigests.api.release,
    errors,
  );
  evaluateImage(
    'Worker',
    'checkpoint',
    manifest.aws.ecrImages.worker.digest,
    observation.ecrDigests.worker.checkpoint,
    errors,
  );
  evaluateImage(
    'Worker',
    'release',
    manifest.aws.ecrImages.worker.digest,
    observation.ecrDigests.worker.release,
    errors,
  );

  evaluateRuntimeTaskDefinition(
    'API',
    observation.api.taskDefinition,
    manifest.aws.services.api.taskDefinition,
    errors,
  );
  if (
    observation.api.desiredCount !== manifest.aws.services.api.desiredCount ||
    observation.api.runningCount !== manifest.aws.services.api.desiredCount
  ) {
    errors.push('API running count does not match the checkpoint');
  }

  evaluateRuntimeTaskDefinition(
    'Worker',
    observation.worker.taskDefinition,
    manifest.aws.services.worker.taskDefinition,
    errors,
  );
  const workerMinimum = manifest.aws.workerScaling.minCapacity;
  const workerMaximum = manifest.aws.workerScaling.maxCapacity;
  if (
    observation.worker.desiredCount < workerMinimum ||
    observation.worker.desiredCount > workerMaximum
  ) {
    errors.push('Worker desired count is outside checkpoint scaling bounds');
  }
  if (
    observation.worker.runningCount < workerMinimum ||
    observation.worker.runningCount > workerMaximum
  ) {
    errors.push('Worker running count is outside checkpoint scaling bounds');
  }

  if (observation.secretCurrentVersionId !== manifest.aws.secret.versionId) {
    errors.push('Secret AWSCURRENT does not match the checkpoint version');
  }
  if (
    observation.workerScaling.minCapacity !== manifest.aws.workerScaling.minCapacity ||
    observation.workerScaling.maxCapacity !== manifest.aws.workerScaling.maxCapacity ||
    !sameScalingSuspendedState(
      observation.workerScaling.suspendedState,
      manifest.aws.workerScaling.suspendedState,
    )
  ) {
    errors.push('Worker scaling target does not match the checkpoint');
  }
  if (
    !sameScheduledScalingActions(
      observation.workerScaling.scheduledActions,
      manifest.aws.workerScaling.scheduledActions,
    )
  ) {
    errors.push('Worker scheduled actions do not match the checkpoint');
  }
  if (
    !sameScalingPolicyConfigurations(
      observation.workerScaling.policies,
      manifest.aws.workerScaling.policies,
    )
  ) {
    errors.push('Worker scaling policies do not match the checkpoint');
  }

  return errors;
}

export function buildRollbackActions(manifest: RollbackManifest): RollbackAction[] {
  return [
    { kind: 'quiesce-worker-scaling', maxCapacity: manifest.aws.workerScaling.maxCapacity },
    { kind: 'stop-worker', desiredCount: 0 },
    { kind: 'wait-worker-stopped' },
    { kind: 'stop-api', desiredCount: 0 },
    { kind: 'wait-api-stopped' },
    { kind: 'verify-generation-quiescence' },
    { kind: 'activate-checkpoint-secret', versionId: manifest.aws.secret.versionId },
    {
      kind: 'update-worker-task-definition',
      taskDefinition: manifest.aws.services.worker.taskDefinition,
    },
    {
      kind: 'update-api-task-definition',
      taskDefinition: manifest.aws.services.api.taskDefinition,
      desiredCount: manifest.aws.services.api.desiredCount,
    },
    { kind: 'wait-api-stable' },
    {
      kind: 'invalidate-cloudfront',
      distributionId: manifest.aws.cloudFront.distributionId,
    },
    {
      kind: 'restore-checkpoint-worker-scaling',
      minCapacity: manifest.aws.workerScaling.minCapacity,
      maxCapacity: manifest.aws.workerScaling.maxCapacity,
      suspendedState: { ...manifest.aws.workerScaling.suspendedState },
      policies: cloneScalingPolicies(manifest.aws.workerScaling.policies),
    },
    {
      kind: 'start-checkpoint-worker',
      desiredCount: manifest.aws.services.worker.desiredCount,
    },
    { kind: 'wait-worker-stable' },
    { kind: 'verify-checkpoint-runtime' },
    {
      kind: 'verify-public-health',
      healthUrl: manifest.aws.cloudFront.healthUrl,
      readinessUrl: manifest.aws.cloudFront.readinessUrl,
    },
  ];
}

export function buildRecoveryActions(
  manifest: RollbackManifest,
  snapshot: ProductionSnapshot,
): RecoveryAction[] {
  return [
    { kind: 'quiesce-worker-scaling', maxCapacity: snapshot.workerScaling.maxCapacity },
    { kind: 'stop-worker', desiredCount: 0 },
    { kind: 'stop-api', desiredCount: 0 },
    { kind: 'restore-previous-secret', versionId: snapshot.secretCurrentVersionId },
    {
      kind: 'restore-previous-worker-task-definition',
      taskDefinition: snapshot.workerTaskDefinition,
    },
    {
      kind: 'restore-previous-api-task-definition',
      taskDefinition: snapshot.apiTaskDefinition,
    },
    {
      kind: 'restore-previous-desired-counts',
      apiDesiredCount: snapshot.apiDesiredCount,
      workerDesiredCount: snapshot.workerDesiredCount,
    },
    { kind: 'wait-api-stable' },
    { kind: 'wait-worker-stable' },
    {
      kind: 'restore-previous-worker-scaling',
      minCapacity: snapshot.workerScaling.minCapacity,
      maxCapacity: snapshot.workerScaling.maxCapacity,
      suspendedState: { ...snapshot.workerScaling.suspendedState },
      scheduledActions: cloneScheduledActions(snapshot.workerScaling.scheduledActions),
      policies: cloneScalingPolicies(snapshot.workerScaling.policies),
    },
    {
      kind: 'invalidate-cloudfront',
      distributionId: manifest.aws.cloudFront.distributionId,
    },
    {
      kind: 'verify-public-health',
      healthUrl: manifest.aws.cloudFront.healthUrl,
      readinessUrl: manifest.aws.cloudFront.readinessUrl,
    },
  ];
}

export function createRollbackReceipt(
  manifest: RollbackManifest,
  snapshot: ProductionSnapshot,
): RollbackReceipt {
  return {
    schemaVersion: 1,
    checkpointId: manifest.checkpointId,
    createdAt: snapshot.capturedAt,
    previous: {
      capturedAt: snapshot.capturedAt,
      apiTaskDefinition: snapshot.apiTaskDefinition,
      workerTaskDefinition: snapshot.workerTaskDefinition,
      apiDesiredCount: snapshot.apiDesiredCount,
      workerDesiredCount: snapshot.workerDesiredCount,
      secretCurrentVersionId: snapshot.secretCurrentVersionId,
      workerScaling: {
        minCapacity: snapshot.workerScaling.minCapacity,
        maxCapacity: snapshot.workerScaling.maxCapacity,
        suspendedState: { ...snapshot.workerScaling.suspendedState },
        scheduledActions: cloneScheduledActions(snapshot.workerScaling.scheduledActions),
        policies: cloneScalingPolicies(snapshot.workerScaling.policies),
      },
    },
  };
}

function evaluateImage(
  label: 'API' | 'Worker',
  tagKind: 'checkpoint' | 'release',
  expectedDigest: string,
  observedDigest: string,
  errors: string[],
): void {
  if (observedDigest !== expectedDigest) {
    errors.push(`${label} ${tagKind} image digest does not match`);
  }
}

function evaluateTaskDefinition(
  label: 'API' | 'Worker',
  expected: RollbackManifest['aws']['services']['api'],
  observed: ObservedTaskDefinition,
  errors: string[],
): void {
  if (observed.status !== 'ACTIVE') {
    errors.push(`${label} checkpoint task definition is not ACTIVE`);
  }
  if (observed.containerName !== expected.containerName) {
    errors.push(`${label} checkpoint container name does not match`);
  }
  if (observed.imageUri !== expected.imageUri) {
    errors.push(`${label} checkpoint task image does not match`);
  }
  if (observed.cpuArchitecture !== expected.cpuArchitecture) {
    errors.push(`${label} checkpoint CPU architecture does not match`);
  }
}

function evaluateRuntimeTaskDefinition(
  label: 'API' | 'Worker',
  actual: string,
  expected: string,
  errors: string[],
): void {
  if (actual !== expected && !actual.endsWith(`/${expected}`)) {
    errors.push(`${label} task definition does not match the checkpoint`);
  }
}

function sameScalingSuspendedState(
  actual: ScalingSuspendedState,
  expected: ScalingSuspendedState,
): boolean {
  return (
    actual.dynamicScalingInSuspended === expected.dynamicScalingInSuspended &&
    actual.dynamicScalingOutSuspended === expected.dynamicScalingOutSuspended &&
    actual.scheduledScalingSuspended === expected.scheduledScalingSuspended
  );
}

function sameScheduledScalingActions(
  actual: ScheduledScalingAction[],
  expected: ScheduledScalingAction[],
): boolean {
  const canonicalize = (values: ScheduledScalingAction[]): ScheduledScalingAction[] =>
    [...values]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((value) => ({
        name: value.name,
        schedule: value.schedule,
        minCapacity: value.minCapacity,
        maxCapacity: value.maxCapacity,
      }));
  return JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected));
}

function sameScalingPolicyConfigurations(
  actual: ScalingPolicyConfiguration[],
  expected: ScalingPolicyConfiguration[],
): boolean {
  const canonicalize = (
    values: ScalingPolicyConfiguration[],
  ): ScalingPolicyConfiguration[] =>
    [...values]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((value) => ({
        name: value.name,
        policyType: value.policyType,
        adjustmentType: value.adjustmentType,
        cooldown: value.cooldown,
        metricAggregationType: value.metricAggregationType,
        stepAdjustments: value.stepAdjustments.map((step) => ({
          ...(step.metricIntervalLowerBound === undefined
            ? {}
            : { metricIntervalLowerBound: step.metricIntervalLowerBound }),
          ...(step.metricIntervalUpperBound === undefined
            ? {}
            : { metricIntervalUpperBound: step.metricIntervalUpperBound }),
          scalingAdjustment: step.scalingAdjustment,
        })),
      }));
  return JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected));
}

function cloneScheduledActions(actions: ScheduledScalingAction[]): ScheduledScalingAction[] {
  return actions.map((action) => ({
    name: action.name,
    schedule: action.schedule,
    minCapacity: action.minCapacity,
    maxCapacity: action.maxCapacity,
  }));
}

function cloneScalingPolicies(
  policies: ScalingPolicyConfiguration[],
): ScalingPolicyConfiguration[] {
  return policies.map((policy) => ({
    name: policy.name,
    policyType: policy.policyType,
    adjustmentType: policy.adjustmentType,
    cooldown: policy.cooldown,
    metricAggregationType: policy.metricAggregationType,
    stepAdjustments: policy.stepAdjustments.map((step) => ({
      ...(step.metricIntervalLowerBound === undefined
        ? {}
        : { metricIntervalLowerBound: step.metricIntervalLowerBound }),
      ...(step.metricIntervalUpperBound === undefined
        ? {}
        : { metricIntervalUpperBound: step.metricIntervalUpperBound }),
      scalingAdjustment: step.scalingAdjustment,
    })),
  }));
}
