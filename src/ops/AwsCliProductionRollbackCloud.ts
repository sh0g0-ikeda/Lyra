import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RollbackSafetyError,
  evaluateCheckpointRuntime,
  type ProductionSnapshot,
  type RecoveryAction,
  type RollbackAction,
  type RollbackManifest,
  type RollbackObservation,
  type RollbackReceipt,
  type ScalingPolicyConfiguration,
  type ScalingSuspendedState,
  type ScheduledScalingAction,
} from './ProductionRollback.js';
import type {
  ProductionRollbackCloudPort,
  RollbackReceiptStore,
} from './ProductionRollbackOrchestrator.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const ECS_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
const HEALTH_ATTEMPTS = 12;
const HEALTH_RETRY_DELAY_MS = 5_000;
const DATABASE_LOG_MARKER = 'LYRA_ROLLBACK_DATABASE=';

interface DatabasePreflightState {
  appliedMigrations: string[];
  activeGenerationJobs: number;
}

export function buildDatabasePreflightScript(): string {
  return [
    "const secret = await import('./dist/src/lib/runtimeSecretEnv.js');",
    'await secret.loadRuntimeSecretEnv();',
    "const database = await import('./dist/src/lib/db.js');",
    'try {',
    'const state = await database.db.transaction(async (client) => {',
    "await client.query('SET TRANSACTION READ ONLY');",
    `await client.query("SET LOCAL statement_timeout = '15s'");`,
    "const migrations = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');",
    "const activeJobs = await client.query(\"SELECT COUNT(*)::int AS count FROM generation_jobs WHERE status IN ('queued', 'processing')\");",
    'return { appliedMigrations: migrations.rows.map((row) => row.filename), activeGenerationJobs: Number(activeJobs.rows[0]?.count ?? 0) };',
    '});',
    `console.log('${DATABASE_LOG_MARKER}' + JSON.stringify(state));`,
    '} finally { await database.closeDatabasePool(); }',
  ].join(' ');
}

export interface AwsCliRunner {
  json(args: string[], timeoutMs?: number): Promise<unknown>;
  run(args: string[], timeoutMs?: number): Promise<void>;
}

export class ExecFileAwsCliRunner implements AwsCliRunner {
  private readonly executable: string;
  private readonly profile: string;
  private readonly region: string;

  public constructor(options: { executable: string; profile: string; region: string }) {
    this.executable = options.executable;
    this.profile = options.profile;
    this.region = options.region;
  }

  public async json(args: string[], timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<unknown> {
    const stdout = await this.execute([...args, '--output', 'json'], timeoutMs);
    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      throw new RollbackSafetyError(`AWS CLI returned invalid JSON for ${commandLabel(args)}`);
    }
  }

  public async run(args: string[], timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<void> {
    await this.execute(args, timeoutMs);
  }

  private async execute(args: string[], timeoutMs: number): Promise<string> {
    const completeArgs = [
      ...args,
      '--region',
      this.region,
      '--profile',
      this.profile,
      '--no-cli-pager',
    ];

    return new Promise<string>((resolve, reject) => {
      execFile(
        this.executable,
        completeArgs,
        {
          encoding: 'utf8',
          env: { ...process.env, AWS_PAGER: '' },
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            const detail = sanitizeCommandError(stderr);
            reject(
              new RollbackSafetyError(
                `AWS CLI command failed (${commandLabel(args)})${
                  detail === '' ? '' : `: ${detail}`
                }`,
              ),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

export class FileRollbackReceiptStore implements RollbackReceiptStore {
  private readonly directory: string;

  public constructor(directory = join(process.cwd(), '.rollback-receipts')) {
    this.directory = directory;
  }

  public async save(receipt: RollbackReceipt): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const timestamp = receipt.createdAt.replace(/[^0-9A-Za-z_-]/gu, '-');
    const path = join(this.directory, `${receipt.checkpointId}-${timestamp}.json`);
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return path;
  }
}

interface ServiceState {
  serviceName: string;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: string[];
      securityGroups: string[];
      assignPublicIp: string;
    };
  };
}

export class AwsCliProductionRollbackCloud implements ProductionRollbackCloudPort {
  private readonly runner: AwsCliRunner;
  private readonly manifest: RollbackManifest;
  private readonly log: (message: string) => void;

  public constructor(options: {
    runner: AwsCliRunner;
    manifest: RollbackManifest;
    log?: (message: string) => void;
  }) {
    this.runner = options.runner;
    this.manifest = options.manifest;
    this.log = options.log ?? (() => undefined);
  }

  public async collectObservation(manifest: RollbackManifest): Promise<RollbackObservation> {
    this.assertSameManifest(manifest);
    this.log('AWS、ECR、ECS、Secret、SQS の前提条件を確認しています。');

    const [
      accountId,
      apiCheckpointDigest,
      apiReleaseDigest,
      workerCheckpointDigest,
      workerReleaseDigest,
      apiTaskDefinition,
      workerTaskDefinition,
      checkpointSecretVersionId,
      queue,
      services,
    ] = await Promise.all([
      this.readAccountId(),
      this.readCheckpointImageDigest(
        manifest.aws.ecrImages.api.repositoryName,
        manifest.aws.ecrImages.api.checkpointTag,
      ),
      this.readCheckpointImageDigest(
        manifest.aws.ecrImages.api.repositoryName,
        manifest.aws.ecrImages.api.releaseTag,
      ),
      this.readCheckpointImageDigest(
        manifest.aws.ecrImages.worker.repositoryName,
        manifest.aws.ecrImages.worker.checkpointTag,
      ),
      this.readCheckpointImageDigest(
        manifest.aws.ecrImages.worker.repositoryName,
        manifest.aws.ecrImages.worker.releaseTag,
      ),
      this.readTaskDefinition(
        manifest.aws.services.api.taskDefinition,
        manifest.aws.services.api.containerName,
      ),
      this.readTaskDefinition(
        manifest.aws.services.worker.taskDefinition,
        manifest.aws.services.worker.containerName,
      ),
      this.readSecretVersionForStage(manifest.aws.secret.checkpointStage),
      this.readQueueState(),
      this.describeServices(),
    ]);

    await Promise.all([this.verifyCloudFront(), this.verifyScalingPolicies()]);
    this.log('一時Fargate taskでDB migrationと実行中ジョブを読み取り専用確認しています。');
    const databaseState = await this.readDatabasePreflightState(services);

    return {
      accountId,
      region: manifest.aws.region,
      ecrDigests: {
        api: {
          checkpoint: apiCheckpointDigest,
          release: apiReleaseDigest,
        },
        worker: {
          checkpoint: workerCheckpointDigest,
          release: workerReleaseDigest,
        },
      },
      taskDefinitions: {
        api: apiTaskDefinition,
        worker: workerTaskDefinition,
      },
      checkpointSecretVersionId,
      queue,
      appliedMigrations: databaseState.appliedMigrations,
      activeGenerationJobs: databaseState.activeGenerationJobs,
    };
  }

  public async captureSnapshot(manifest: RollbackManifest): Promise<ProductionSnapshot> {
    this.assertSameManifest(manifest);
    const [services, secretCurrentVersionId, workerScaling, scheduledActions, policies] =
      await Promise.all([
        this.describeServices(),
        this.readSecretVersionForStage('AWSCURRENT'),
        this.readWorkerScalingTarget(),
        this.readScheduledActions(),
        this.readScalingPolicies(),
      ]);
    if (secretCurrentVersionId === null) {
      throw new RollbackSafetyError('Secret AWSCURRENT version was not found');
    }

    const apiService = findService(services, manifest.aws.services.api.serviceName);
    const workerService = findService(services, manifest.aws.services.worker.serviceName);
    return {
      capturedAt: new Date().toISOString(),
      apiTaskDefinition: apiService.taskDefinition,
      workerTaskDefinition: workerService.taskDefinition,
      apiDesiredCount: apiService.desiredCount,
      workerDesiredCount: workerService.desiredCount,
      secretCurrentVersionId,
      workerScaling: {
        minCapacity: workerScaling.minCapacity,
        maxCapacity: workerScaling.maxCapacity,
        suspendedState: { ...workerScaling.suspendedState },
        scheduledActions,
        policies,
      },
    };
  }

  public async executeRollbackAction(action: RollbackAction): Promise<void> {
    this.log(`ロールバック工程: ${action.kind}`);
    switch (action.kind) {
      case 'quiesce-worker-scaling':
        await this.quiesceWorkerScaling(action.maxCapacity);
        return;
      case 'stop-worker':
        await this.updateServiceDesiredCount(this.manifest.aws.services.worker.serviceName, 0);
        return;
      case 'wait-worker-stopped':
        await this.waitForServiceStable(this.manifest.aws.services.worker.serviceName);
        return;
      case 'stop-api':
        await this.updateServiceDesiredCount(this.manifest.aws.services.api.serviceName, 0);
        return;
      case 'wait-api-stopped':
        await this.waitForServiceStable(this.manifest.aws.services.api.serviceName);
        return;
      case 'verify-generation-quiescence':
        await this.verifyGenerationQuiescence();
        return;
      case 'activate-checkpoint-secret':
        await this.moveSecretCurrentVersion(action.versionId);
        return;
      case 'update-worker-task-definition':
        await this.updateServiceTaskDefinition(
          this.manifest.aws.services.worker.serviceName,
          action.taskDefinition,
        );
        return;
      case 'update-api-task-definition':
        await this.updateServiceTaskDefinition(
          this.manifest.aws.services.api.serviceName,
          action.taskDefinition,
          action.desiredCount,
        );
        return;
      case 'wait-api-stable':
        await this.waitForServiceStable(this.manifest.aws.services.api.serviceName);
        return;
      case 'verify-checkpoint-runtime':
        await this.verifyCheckpointRuntime();
        return;
      case 'invalidate-cloudfront':
        await this.invalidateCloudFront(action.distributionId);
        return;
      case 'restore-checkpoint-worker-scaling':
        await this.reconcileWorkerScaling(
          action.minCapacity,
          action.maxCapacity,
          action.suspendedState,
          this.manifest.aws.workerScaling.scheduledActions,
          action.policies,
        );
        return;
      case 'start-checkpoint-worker':
        await this.updateServiceDesiredCount(
          this.manifest.aws.services.worker.serviceName,
          action.desiredCount,
        );
        return;
      case 'wait-worker-stable':
        await this.waitForServiceStable(this.manifest.aws.services.worker.serviceName);
        return;
      case 'verify-public-health':
        await this.verifyPublicHealth(action.healthUrl, action.readinessUrl);
        return;
    }
  }

  public async executeRecoveryAction(action: RecoveryAction): Promise<void> {
    this.log(`自動復旧工程: ${action.kind}`);
    switch (action.kind) {
      case 'quiesce-worker-scaling':
        await this.quiesceWorkerScaling(action.maxCapacity);
        return;
      case 'stop-worker':
        await this.updateServiceDesiredCount(this.manifest.aws.services.worker.serviceName, 0);
        await this.waitForServiceStable(this.manifest.aws.services.worker.serviceName);
        return;
      case 'stop-api':
        await this.updateServiceDesiredCount(this.manifest.aws.services.api.serviceName, 0);
        await this.waitForServiceStable(this.manifest.aws.services.api.serviceName);
        return;
      case 'restore-previous-secret':
        await this.moveSecretCurrentVersion(action.versionId);
        return;
      case 'restore-previous-worker-task-definition':
        await this.updateServiceTaskDefinition(
          this.manifest.aws.services.worker.serviceName,
          action.taskDefinition,
        );
        return;
      case 'restore-previous-api-task-definition':
        await this.updateServiceTaskDefinition(
          this.manifest.aws.services.api.serviceName,
          action.taskDefinition,
        );
        return;
      case 'wait-api-stable':
        await this.waitForServiceStable(this.manifest.aws.services.api.serviceName);
        return;
      case 'invalidate-cloudfront':
        await this.invalidateCloudFront(action.distributionId);
        return;
      case 'restore-previous-worker-scaling':
        await this.reconcileWorkerScaling(
          action.minCapacity,
          action.maxCapacity,
          action.suspendedState,
          action.scheduledActions,
          action.policies,
        );
        return;
      case 'restore-previous-desired-counts':
        await this.updateServiceDesiredCount(
          this.manifest.aws.services.api.serviceName,
          action.apiDesiredCount,
        );
        await this.updateServiceDesiredCount(
          this.manifest.aws.services.worker.serviceName,
          action.workerDesiredCount,
        );
        return;
      case 'verify-public-health':
        await this.verifyPublicHealth(action.healthUrl, action.readinessUrl);
        return;
    }
  }

  private assertSameManifest(manifest: RollbackManifest): void {
    if (manifest.checkpointId !== this.manifest.checkpointId) {
      throw new RollbackSafetyError('Rollback cloud adapter received a different checkpoint manifest');
    }
  }

  private async readAccountId(): Promise<string> {
    const output = asRecord(await this.runner.json(['sts', 'get-caller-identity']), 'STS identity');
    return requiredString(output.Account, 'STS Account');
  }

  private async readCheckpointImageDigest(
    repositoryName: string,
    checkpointTag: string,
  ): Promise<string> {
    const output = asRecord(
      await this.runner.json([
        'ecr',
        'describe-images',
        '--repository-name',
        repositoryName,
        '--image-ids',
        `imageTag=${checkpointTag}`,
      ]),
      'ECR describe-images',
    );
    const details = asArray(output.imageDetails, 'ECR imageDetails');
    const detail = asRecord(details[0], 'ECR checkpoint image');
    return requiredString(detail.imageDigest, 'ECR imageDigest');
  }

  private async readTaskDefinition(
    taskDefinitionName: string,
    expectedContainerName: string,
  ): Promise<RollbackObservation['taskDefinitions']['api']> {
    const output = asRecord(
      await this.runner.json([
        'ecs',
        'describe-task-definition',
        '--task-definition',
        taskDefinitionName,
      ]),
      'ECS task definition response',
    );
    const taskDefinition = asRecord(output.taskDefinition, 'ECS taskDefinition');
    const containers = asArray(taskDefinition.containerDefinitions, 'ECS containerDefinitions');
    const container = containers
      .map((value) => asRecord(value, 'ECS container definition'))
      .find((value) => value.name === expectedContainerName);
    if (container === undefined) {
      throw new RollbackSafetyError(
        `ECS task definition does not contain container ${expectedContainerName}`,
      );
    }
    const runtimePlatform = asRecord(taskDefinition.runtimePlatform, 'ECS runtimePlatform');
    return {
      status: requiredString(taskDefinition.status, 'ECS task definition status'),
      containerName: requiredString(container.name, 'ECS container name'),
      imageUri: requiredString(container.image, 'ECS container image'),
      cpuArchitecture: requiredString(
        runtimePlatform.cpuArchitecture,
        'ECS CPU architecture',
      ),
    };
  }

  private async readSecretVersionForStage(stage: string): Promise<string | null> {
    const output = asRecord(
      await this.runner.json([
        'secretsmanager',
        'list-secret-version-ids',
        '--secret-id',
        this.manifest.aws.secret.secretId,
        '--include-deprecated',
        '--max-results',
        '100',
      ]),
      'Secrets Manager versions',
    );
    const versions = asArray(output.Versions, 'Secrets Manager Versions');
    for (const value of versions) {
      const version = asRecord(value, 'Secrets Manager version');
      const stages = optionalStringArray(version.VersionStages, 'Secrets Manager VersionStages');
      if (stages.includes(stage)) {
        return requiredString(version.VersionId, 'Secrets Manager VersionId');
      }
    }
    return null;
  }

  private async readQueueState(): Promise<RollbackObservation['queue']> {
    const queueUrlOutput = asRecord(
      await this.runner.json([
        'sqs',
        'get-queue-url',
        '--queue-name',
        this.manifest.aws.queue.name,
      ]),
      'SQS queue URL',
    );
    const queueUrl = requiredString(queueUrlOutput.QueueUrl, 'SQS QueueUrl');
    const output = asRecord(
      await this.runner.json([
        'sqs',
        'get-queue-attributes',
        '--queue-url',
        queueUrl,
        '--attribute-names',
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed',
      ]),
      'SQS queue attributes',
    );
    const attributes = asRecord(output.Attributes, 'SQS Attributes');
    return {
      visibleMessages: numericString(attributes.ApproximateNumberOfMessages, 'visible messages'),
      inFlightMessages: numericString(
        attributes.ApproximateNumberOfMessagesNotVisible,
        'in-flight messages',
      ),
      delayedMessages: numericString(
        attributes.ApproximateNumberOfMessagesDelayed,
        'delayed messages',
      ),
    };
  }

  private async describeServices(): Promise<ServiceState[]> {
    const output = asRecord(
      await this.runner.json([
        'ecs',
        'describe-services',
        '--cluster',
        this.manifest.aws.clusterName,
        '--services',
        this.manifest.aws.services.api.serviceName,
        this.manifest.aws.services.worker.serviceName,
      ]),
      'ECS services',
    );
    const failures = asArray(output.failures, 'ECS service failures');
    if (failures.length > 0) {
      throw new RollbackSafetyError('One or more ECS services could not be described');
    }
    return asArray(output.services, 'ECS services').map((value) => parseServiceState(value));
  }

  private async verifyCloudFront(): Promise<void> {
    const output = asRecord(
      await this.runner.json([
        'cloudfront',
        'get-distribution',
        '--id',
        this.manifest.aws.cloudFront.distributionId,
      ]),
      'CloudFront distribution',
    );
    const distribution = asRecord(output.Distribution, 'CloudFront Distribution');
    const config = asRecord(distribution.DistributionConfig, 'CloudFront DistributionConfig');
    if (distribution.Status !== 'Deployed' || config.Enabled !== true) {
      throw new RollbackSafetyError('CloudFront distribution is not deployed and enabled');
    }
  }

  private async verifyScalingPolicies(): Promise<void> {
    const policyNames = new Set((await this.readScalingPolicies()).map((policy) => policy.name));
    for (const expectedPolicy of this.manifest.aws.workerScaling.policies) {
      const expectedPolicyName = expectedPolicy.name;
      if (!policyNames.has(expectedPolicyName)) {
        throw new RollbackSafetyError(`Worker scaling policy is missing: ${expectedPolicyName}`);
      }
    }
  }

  private async readDatabasePreflightState(
    services: ServiceState[],
  ): Promise<DatabasePreflightState> {
    const apiService = findService(services, this.manifest.aws.services.api.serviceName);
    const dbScript = buildDatabasePreflightScript();
    const overrides = JSON.stringify({
      containerOverrides: [
        {
          name: this.manifest.aws.services.api.containerName,
          command: ['bun', '--eval', dbScript],
        },
      ],
    });
    const networkConfiguration = JSON.stringify(apiService.networkConfiguration);
    const runOutput = asRecord(
      await this.runner.json([
        'ecs',
        'run-task',
        '--cluster',
        this.manifest.aws.clusterName,
        '--launch-type',
        'FARGATE',
        '--task-definition',
        apiService.taskDefinition,
        '--network-configuration',
        networkConfiguration,
        '--overrides',
        overrides,
        '--started-by',
        'lyra-rollback-preflight',
      ]),
      'ECS database preflight task',
    );
    const failures = asArray(runOutput.failures, 'ECS run-task failures');
    if (failures.length > 0) {
      throw new RollbackSafetyError('Database preflight task could not be started');
    }
    const tasks = asArray(runOutput.tasks, 'ECS run-task tasks');
    const task = asRecord(tasks[0], 'ECS database preflight task');
    const taskArn = requiredString(task.taskArn, 'ECS preflight taskArn');

    await this.runner.run(
      [
        'ecs',
        'wait',
        'tasks-stopped',
        '--cluster',
        this.manifest.aws.clusterName,
        '--tasks',
        taskArn,
      ],
      ECS_WAIT_TIMEOUT_MS,
    );

    const stoppedTask = await this.readStoppedTask(taskArn);
    if (stoppedTask.exitCode !== 0) {
      throw new RollbackSafetyError(
        `Database preflight task failed with exit code ${stoppedTask.exitCode}: ${stoppedTask.reason}`,
      );
    }
    return this.readDatabasePreflightLog(stoppedTask.logGroupName, stoppedTask.logStreamName);
  }

  private async verifyGenerationQuiescence(): Promise<void> {
    this.log('API停止後にSQSとDBの生成処理が空であることを再確認しています。');
    const [queue, services] = await Promise.all([this.readQueueState(), this.describeServices()]);
    const databaseState = await this.readDatabasePreflightState(services);
    const queuedMessageCount =
      queue.visibleMessages + queue.inFlightMessages + queue.delayedMessages;
    if (queuedMessageCount > 0 || databaseState.activeGenerationJobs > 0) {
      throw new RollbackSafetyError(
        'Generation activity appeared after preflight; rollback was stopped before version switch',
      );
    }
  }

  private async verifyCheckpointRuntime(): Promise<void> {
    this.log('切替後のECS、Secret、worker scalingをmanifestと照合しています。');
    const [
      services,
      currentSecretVersionId,
      scalingTarget,
      scheduledActions,
      policies,
      apiCheckpointDigest,
      apiReleaseDigest,
      workerCheckpointDigest,
      workerReleaseDigest,
    ] = await Promise.all([
        this.describeServices(),
        this.readSecretVersionForStage('AWSCURRENT'),
        this.readWorkerScalingTarget(),
        this.readScheduledActions(),
        this.readScalingPolicies(),
        this.readCheckpointImageDigest(
          this.manifest.aws.ecrImages.api.repositoryName,
          this.manifest.aws.ecrImages.api.checkpointTag,
        ),
        this.readCheckpointImageDigest(
          this.manifest.aws.ecrImages.api.repositoryName,
          this.manifest.aws.ecrImages.api.releaseTag,
        ),
        this.readCheckpointImageDigest(
          this.manifest.aws.ecrImages.worker.repositoryName,
          this.manifest.aws.ecrImages.worker.checkpointTag,
        ),
        this.readCheckpointImageDigest(
          this.manifest.aws.ecrImages.worker.repositoryName,
          this.manifest.aws.ecrImages.worker.releaseTag,
        ),
      ]);
    const api = findService(services, this.manifest.aws.services.api.serviceName);
    const worker = findService(services, this.manifest.aws.services.worker.serviceName);
    const errors = evaluateCheckpointRuntime(this.manifest, {
      ecrDigests: {
        api: { checkpoint: apiCheckpointDigest, release: apiReleaseDigest },
        worker: { checkpoint: workerCheckpointDigest, release: workerReleaseDigest },
      },
      api,
      worker,
      secretCurrentVersionId: currentSecretVersionId,
      workerScaling: {
        minCapacity: scalingTarget.minCapacity,
        maxCapacity: scalingTarget.maxCapacity,
        suspendedState: scalingTarget.suspendedState,
        scheduledActions,
        policies,
      },
    });
    if (errors.length > 0) {
      throw new RollbackSafetyError(errors.join('\n'));
    }
  }

  private async readStoppedTask(taskArn: string): Promise<{
    exitCode: number;
    reason: string;
    logGroupName: string;
    logStreamName: string;
  }> {
    const output = asRecord(
      await this.runner.json([
        'ecs',
        'describe-tasks',
        '--cluster',
        this.manifest.aws.clusterName,
        '--tasks',
        taskArn,
      ]),
      'ECS stopped task',
    );
    const task = asRecord(asArray(output.tasks, 'ECS stopped tasks')[0], 'ECS stopped task');
    const containers = asArray(task.containers, 'ECS stopped task containers');
    const container = containers
      .map((value) => asRecord(value, 'ECS stopped task container'))
      .find((value) => value.name === this.manifest.aws.services.api.containerName);
    if (container === undefined) {
      throw new RollbackSafetyError('Database preflight container result was not found');
    }
    const logLocation = await this.readTaskLogLocation(
      requiredString(task.taskDefinitionArn, 'ECS preflight taskDefinitionArn'),
      requiredString(container.name, 'ECS preflight container name'),
      taskArn,
      optionalString(container.logStreamName),
    );
    return {
      exitCode: requiredNumber(container.exitCode, 'ECS preflight exitCode'),
      reason: optionalString(container.reason) ?? optionalString(task.stoppedReason) ?? 'No reason reported',
      logGroupName: logLocation.logGroupName,
      logStreamName: logLocation.logStreamName,
    };
  }

  private async readTaskLogLocation(
    taskDefinitionArn: string,
    containerName: string,
    taskArn: string,
    reportedLogStreamName: string | undefined,
  ): Promise<{ logGroupName: string; logStreamName: string }> {
    const output = asRecord(
      await this.runner.json([
        'ecs',
        'describe-task-definition',
        '--task-definition',
        taskDefinitionArn,
      ]),
      'ECS preflight task definition',
    );
    const taskDefinition = asRecord(output.taskDefinition, 'ECS preflight taskDefinition');
    const containerDefinition = asArray(
      taskDefinition.containerDefinitions,
      'ECS preflight containerDefinitions',
    )
      .map((value) => asRecord(value, 'ECS preflight containerDefinition'))
      .find((value) => value.name === containerName);
    if (containerDefinition === undefined) {
      throw new RollbackSafetyError('ECS preflight log container definition was not found');
    }
    const logConfiguration = asRecord(
      containerDefinition.logConfiguration,
      'ECS preflight logConfiguration',
    );
    const options = asRecord(logConfiguration.options, 'ECS preflight log options');
    const logGroupName = requiredString(options['awslogs-group'], 'ECS awslogs-group');
    if (reportedLogStreamName !== undefined) {
      return { logGroupName, logStreamName: reportedLogStreamName };
    }
    const streamPrefix = requiredString(options['awslogs-stream-prefix'], 'ECS awslogs-stream-prefix');
    const taskId = taskArn.split('/').at(-1);
    if (taskId === undefined || taskId === '') {
      throw new RollbackSafetyError('ECS preflight task ID could not be derived');
    }
    return {
      logGroupName,
      logStreamName: `${streamPrefix}/${containerName}/${taskId}`,
    };
  }

  private async readDatabasePreflightLog(
    logGroupName: string,
    logStreamName: string,
  ): Promise<DatabasePreflightState> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const output = asRecord(
        await this.runner.json([
          'logs',
          'get-log-events',
          '--log-group-name',
          logGroupName,
          '--log-stream-name',
          logStreamName,
          '--start-from-head',
        ]),
        'CloudWatch database preflight logs',
      );
      const events = asArray(output.events, 'CloudWatch log events');
      for (const value of events) {
        const event = asRecord(value, 'CloudWatch log event');
        const message = requiredString(event.message, 'CloudWatch log message');
        const markerIndex = message.indexOf(DATABASE_LOG_MARKER);
        if (markerIndex < 0) {
          continue;
        }
        const encoded = message.slice(markerIndex + DATABASE_LOG_MARKER.length).trim();
        return parseDatabasePreflightJson(encoded);
      }
      await sleep(1_000);
    }
    throw new RollbackSafetyError('Database preflight result was not found in CloudWatch Logs');
  }

  private async readWorkerScalingTarget(): Promise<{
    minCapacity: number;
    maxCapacity: number;
    suspendedState: ScalingSuspendedState;
  }> {
    const scaling = this.manifest.aws.workerScaling;
    const output = asRecord(
      await this.runner.json([
        'application-autoscaling',
        'describe-scalable-targets',
        '--service-namespace',
        scaling.serviceNamespace,
        '--resource-ids',
        scaling.resourceId,
        '--scalable-dimension',
        scaling.scalableDimension,
      ]),
      'Application Auto Scaling target',
    );
    const target = asRecord(
      asArray(output.ScalableTargets, 'ScalableTargets')[0],
      'worker scalable target',
    );
    const suspendedState = asRecord(target.SuspendedState, 'worker SuspendedState');
    return {
      minCapacity: requiredNumber(target.MinCapacity, 'worker MinCapacity'),
      maxCapacity: requiredNumber(target.MaxCapacity, 'worker MaxCapacity'),
      suspendedState: {
        dynamicScalingInSuspended: requiredBoolean(
          suspendedState.DynamicScalingInSuspended,
          'DynamicScalingInSuspended',
        ),
        dynamicScalingOutSuspended: requiredBoolean(
          suspendedState.DynamicScalingOutSuspended,
          'DynamicScalingOutSuspended',
        ),
        scheduledScalingSuspended: requiredBoolean(
          suspendedState.ScheduledScalingSuspended,
          'ScheduledScalingSuspended',
        ),
      },
    };
  }

  private async readScheduledActions(): Promise<ScheduledScalingAction[]> {
    const scaling = this.manifest.aws.workerScaling;
    const output = asRecord(
      await this.runner.json([
        'application-autoscaling',
        'describe-scheduled-actions',
        '--service-namespace',
        scaling.serviceNamespace,
        '--resource-id',
        scaling.resourceId,
        '--scalable-dimension',
        scaling.scalableDimension,
      ]),
      'Application Auto Scaling scheduled actions',
    );
    return asArray(output.ScheduledActions, 'ScheduledActions').map((value) => {
      const action = asRecord(value, 'scheduled action');
      const target = asRecord(action.ScalableTargetAction, 'scheduled ScalableTargetAction');
      return {
        name: requiredString(action.ScheduledActionName, 'ScheduledActionName'),
        schedule: requiredString(action.Schedule, 'scheduled Schedule'),
        minCapacity: requiredNumber(target.MinCapacity, 'scheduled MinCapacity'),
        maxCapacity: requiredNumber(target.MaxCapacity, 'scheduled MaxCapacity'),
      };
    });
  }

  private async readScalingPolicies(): Promise<ScalingPolicyConfiguration[]> {
    const scaling = this.manifest.aws.workerScaling;
    const output = asRecord(
      await this.runner.json([
        'application-autoscaling',
        'describe-scaling-policies',
        '--service-namespace',
        scaling.serviceNamespace,
        '--resource-id',
        scaling.resourceId,
        '--scalable-dimension',
        scaling.scalableDimension,
      ]),
      'Application Auto Scaling policies',
    );
    return asArray(output.ScalingPolicies, 'ScalingPolicies').map((value) => {
      const policy = asRecord(value, 'Scaling policy');
      const policyType = requiredString(policy.PolicyType, 'Scaling PolicyType');
      if (policyType !== 'StepScaling') {
        throw new RollbackSafetyError(`Unsupported worker scaling policy type: ${policyType}`);
      }
      const configuration = asRecord(
        policy.StepScalingPolicyConfiguration,
        'StepScalingPolicyConfiguration',
      );
      const adjustmentType = parseAdjustmentType(configuration.AdjustmentType);
      const metricAggregationType = parseMetricAggregationType(
        configuration.MetricAggregationType,
      );
      const stepAdjustments = asArray(
        configuration.StepAdjustments,
        'StepScaling StepAdjustments',
      ).map((stepValue) => {
        const step = asRecord(stepValue, 'StepScaling StepAdjustment');
        const lowerBound = optionalNumber(step.MetricIntervalLowerBound);
        const upperBound = optionalNumber(step.MetricIntervalUpperBound);
        return {
          ...(lowerBound === undefined ? {} : { metricIntervalLowerBound: lowerBound }),
          ...(upperBound === undefined ? {} : { metricIntervalUpperBound: upperBound }),
          scalingAdjustment: requiredNumber(
            step.ScalingAdjustment,
            'StepScaling ScalingAdjustment',
          ),
        };
      });
      return {
        name: requiredString(policy.PolicyName, 'Scaling PolicyName'),
        policyType,
        adjustmentType,
        cooldown: requiredNumber(configuration.Cooldown, 'StepScaling Cooldown'),
        metricAggregationType,
        stepAdjustments,
      };
    });
  }

  private async quiesceWorkerScaling(maxCapacity: number): Promise<void> {
    await this.registerWorkerScalingTarget(0, Math.max(1, maxCapacity), {
      dynamicScalingInSuspended: true,
      dynamicScalingOutSuspended: true,
      scheduledScalingSuspended: true,
    });
  }

  private async moveSecretCurrentVersion(targetVersionId: string): Promise<void> {
    const currentVersionId = await this.readSecretVersionForStage('AWSCURRENT');
    if (currentVersionId === null) {
      throw new RollbackSafetyError('Secret AWSCURRENT version was not found');
    }
    if (currentVersionId === targetVersionId) {
      return;
    }
    await this.runner.run([
      'secretsmanager',
      'update-secret-version-stage',
      '--secret-id',
      this.manifest.aws.secret.secretId,
      '--version-stage',
      'AWSCURRENT',
      '--move-to-version-id',
      targetVersionId,
      '--remove-from-version-id',
      currentVersionId,
    ]);
  }

  private async updateServiceDesiredCount(serviceName: string, desiredCount: number): Promise<void> {
    await this.runner.run([
      'ecs',
      'update-service',
      '--cluster',
      this.manifest.aws.clusterName,
      '--service',
      serviceName,
      '--desired-count',
      String(desiredCount),
    ]);
  }

  private async updateServiceTaskDefinition(
    serviceName: string,
    taskDefinition: string,
    desiredCount?: number,
  ): Promise<void> {
    const args = [
      'ecs',
      'update-service',
      '--cluster',
      this.manifest.aws.clusterName,
      '--service',
      serviceName,
      '--task-definition',
      taskDefinition,
      '--force-new-deployment',
    ];
    if (desiredCount !== undefined) {
      args.push('--desired-count', String(desiredCount));
    }
    await this.runner.run(args);
  }

  private async waitForServiceStable(serviceName: string): Promise<void> {
    await this.runner.run(
      [
        'ecs',
        'wait',
        'services-stable',
        '--cluster',
        this.manifest.aws.clusterName,
        '--services',
        serviceName,
      ],
      ECS_WAIT_TIMEOUT_MS,
    );
  }

  private async invalidateCloudFront(distributionId: string): Promise<void> {
    const output = asRecord(
      await this.runner.json([
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        distributionId,
        '--paths',
        '/*',
      ]),
      'CloudFront invalidation',
    );
    const invalidation = asRecord(output.Invalidation, 'CloudFront Invalidation');
    const invalidationId = requiredString(invalidation.Id, 'CloudFront invalidation ID');
    await this.runner.run(
      [
        'cloudfront',
        'wait',
        'invalidation-completed',
        '--distribution-id',
        distributionId,
        '--id',
        invalidationId,
      ],
      ECS_WAIT_TIMEOUT_MS,
    );
  }

  private async reconcileWorkerScaling(
    minCapacity: number,
    maxCapacity: number,
    suspendedState: ScalingSuspendedState,
    scheduledActions: ScheduledScalingAction[],
    policies: ScalingPolicyConfiguration[],
  ): Promise<void> {
    const suspendedDuringReconciliation: ScalingSuspendedState = {
      dynamicScalingInSuspended: true,
      dynamicScalingOutSuspended: true,
      scheduledScalingSuspended: true,
    };
    await this.registerWorkerScalingTarget(
      minCapacity,
      maxCapacity,
      suspendedDuringReconciliation,
    );
    const currentActions = await this.readScheduledActions();
    const desiredNames = new Set(scheduledActions.map((action) => action.name));
    for (const currentAction of currentActions) {
      if (!desiredNames.has(currentAction.name)) {
        await this.deleteScheduledAction(currentAction.name);
      }
    }
    for (const action of scheduledActions) {
      await this.putScheduledAction(action);
    }
    const currentPolicies = await this.readScalingPolicies();
    const desiredPolicyNames = new Set(policies.map((policy) => policy.name));
    for (const currentPolicy of currentPolicies) {
      if (!desiredPolicyNames.has(currentPolicy.name)) {
        await this.deleteScalingPolicy(currentPolicy.name);
      }
    }
    for (const policy of policies) {
      await this.putScalingPolicy(policy);
    }
    await this.registerWorkerScalingTarget(minCapacity, maxCapacity, suspendedState);
  }

  private async registerWorkerScalingTarget(
    minCapacity: number,
    maxCapacity: number,
    suspendedState: ScalingSuspendedState,
  ): Promise<void> {
    const scaling = this.manifest.aws.workerScaling;
    await this.runner.run([
      'application-autoscaling',
      'register-scalable-target',
      '--service-namespace',
      scaling.serviceNamespace,
      '--resource-id',
      scaling.resourceId,
      '--scalable-dimension',
      scaling.scalableDimension,
      '--min-capacity',
      String(minCapacity),
      '--max-capacity',
      String(maxCapacity),
      '--suspended-state',
      [
        `DynamicScalingInSuspended=${suspendedState.dynamicScalingInSuspended}`,
        `DynamicScalingOutSuspended=${suspendedState.dynamicScalingOutSuspended}`,
        `ScheduledScalingSuspended=${suspendedState.scheduledScalingSuspended}`,
      ].join(','),
    ]);
  }

  private async deleteScheduledAction(name: string): Promise<void> {
    const scaling = this.manifest.aws.workerScaling;
    await this.runner.run([
      'application-autoscaling',
      'delete-scheduled-action',
      '--service-namespace',
      scaling.serviceNamespace,
      '--resource-id',
      scaling.resourceId,
      '--scalable-dimension',
      scaling.scalableDimension,
      '--scheduled-action-name',
      name,
    ]);
  }

  private async putScheduledAction(action: ScheduledScalingAction): Promise<void> {
    const scaling = this.manifest.aws.workerScaling;
    await this.runner.run([
      'application-autoscaling',
      'put-scheduled-action',
      '--service-namespace',
      scaling.serviceNamespace,
      '--resource-id',
      scaling.resourceId,
      '--scalable-dimension',
      scaling.scalableDimension,
      '--scheduled-action-name',
      action.name,
      '--schedule',
      action.schedule,
      '--scalable-target-action',
      `MinCapacity=${action.minCapacity},MaxCapacity=${action.maxCapacity}`,
    ]);
  }

  private async deleteScalingPolicy(name: string): Promise<void> {
    const scaling = this.manifest.aws.workerScaling;
    await this.runner.run([
      'application-autoscaling',
      'delete-scaling-policy',
      '--policy-name',
      name,
      '--service-namespace',
      scaling.serviceNamespace,
      '--resource-id',
      scaling.resourceId,
      '--scalable-dimension',
      scaling.scalableDimension,
    ]);
  }

  private async putScalingPolicy(policy: ScalingPolicyConfiguration): Promise<void> {
    const scaling = this.manifest.aws.workerScaling;
    const configuration = JSON.stringify({
      AdjustmentType: policy.adjustmentType,
      StepAdjustments: policy.stepAdjustments.map((step) => ({
        ...(step.metricIntervalLowerBound === undefined
          ? {}
          : { MetricIntervalLowerBound: step.metricIntervalLowerBound }),
        ...(step.metricIntervalUpperBound === undefined
          ? {}
          : { MetricIntervalUpperBound: step.metricIntervalUpperBound }),
        ScalingAdjustment: step.scalingAdjustment,
      })),
      Cooldown: policy.cooldown,
      MetricAggregationType: policy.metricAggregationType,
    });
    await this.runner.run([
      'application-autoscaling',
      'put-scaling-policy',
      '--policy-name',
      policy.name,
      '--service-namespace',
      scaling.serviceNamespace,
      '--resource-id',
      scaling.resourceId,
      '--scalable-dimension',
      scaling.scalableDimension,
      '--policy-type',
      policy.policyType,
      '--step-scaling-policy-configuration',
      configuration,
    ]);
  }

  private async verifyPublicHealth(healthUrl: string, readinessUrl: string): Promise<void> {
    await this.verifyUrl(healthUrl);
    await this.verifyUrl(readinessUrl);
  }

  private async verifyUrl(url: string): Promise<void> {
    let lastStatus: number | null = null;
    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { 'cache-control': 'no-cache' },
          signal: AbortSignal.timeout(10_000),
        });
        lastStatus = response.status;
        if (response.ok) {
          return;
        }
      } catch {
        lastStatus = null;
      }
      await sleep(HEALTH_RETRY_DELAY_MS);
    }
    throw new RollbackSafetyError(
      `Public health verification failed for ${url} (last status: ${lastStatus ?? 'unavailable'})`,
    );
  }
}

function parseServiceState(input: unknown): ServiceState {
  const service = asRecord(input, 'ECS service');
  const networkConfiguration = asRecord(
    service.networkConfiguration,
    'ECS service networkConfiguration',
  );
  const awsvpc = asRecord(
    networkConfiguration.awsvpcConfiguration,
    'ECS service awsvpcConfiguration',
  );
  return {
    serviceName: requiredString(service.serviceName, 'ECS serviceName'),
    taskDefinition: requiredString(service.taskDefinition, 'ECS taskDefinition'),
    desiredCount: requiredNumber(service.desiredCount, 'ECS desiredCount'),
    runningCount: requiredNumber(service.runningCount, 'ECS runningCount'),
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: requiredStringArray(awsvpc.subnets, 'ECS subnets'),
        securityGroups: requiredStringArray(awsvpc.securityGroups, 'ECS securityGroups'),
        assignPublicIp: requiredString(awsvpc.assignPublicIp, 'ECS assignPublicIp'),
      },
    },
  };
}

function findService(services: ServiceState[], serviceName: string): ServiceState {
  const service = services.find((candidate) => candidate.serviceName === serviceName);
  if (service === undefined) {
    throw new RollbackSafetyError(`ECS service was not found: ${serviceName}`);
  }
  return service;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RollbackSafetyError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RollbackSafetyError(`${label} must be an array`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RollbackSafetyError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RollbackSafetyError(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredNumber(value, 'optional numeric value');
}

function parseAdjustmentType(
  value: unknown,
): ScalingPolicyConfiguration['adjustmentType'] {
  if (
    value === 'ChangeInCapacity' ||
    value === 'ExactCapacity' ||
    value === 'PercentChangeInCapacity'
  ) {
    return value;
  }
  throw new RollbackSafetyError('Unsupported StepScaling adjustment type');
}

function parseMetricAggregationType(
  value: unknown,
): ScalingPolicyConfiguration['metricAggregationType'] {
  if (value === 'Average' || value === 'Minimum' || value === 'Maximum') {
    return value;
  }
  throw new RollbackSafetyError('Unsupported StepScaling metric aggregation type');
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RollbackSafetyError(`${label} must be a boolean`);
  }
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  return asArray(value, label).map((item) => requiredString(item, label));
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  return requiredStringArray(value, label);
}

function numericString(value: unknown, label: string): number {
  const parsed = Number(requiredString(value, label));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RollbackSafetyError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseDatabasePreflightJson(value: string): DatabasePreflightState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new RollbackSafetyError('database preflight log is not valid JSON');
  }
  const record = asRecord(parsed, 'database preflight log');
  const activeGenerationJobs = requiredNumber(
    record.activeGenerationJobs,
    'database activeGenerationJobs',
  );
  if (!Number.isInteger(activeGenerationJobs) || activeGenerationJobs < 0) {
    throw new RollbackSafetyError('database activeGenerationJobs must be a non-negative integer');
  }
  return {
    appliedMigrations: requiredStringArray(
      record.appliedMigrations,
      'database appliedMigrations',
    ),
    activeGenerationJobs,
  };
}

function sanitizeCommandError(stderr: string): string {
  return stderr
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1500);
}

function commandLabel(args: string[]): string {
  return args.slice(0, 2).join(' ');
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
