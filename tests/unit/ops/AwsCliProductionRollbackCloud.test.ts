import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AwsCliProductionRollbackCloud,
  buildDatabasePreflightScript,
  type AwsCliRunner,
} from '../../../src/ops/AwsCliProductionRollbackCloud.js';
import { parseRollbackManifest } from '../../../src/ops/ProductionRollback.js';

const manifest = parseRollbackManifest(
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'ops', 'rollback', 'checkpoints', '2026-07-14T1500-jst.json'),
      'utf8',
    ),
  ) as unknown,
);

class RecordingRunner implements AwsCliRunner {
  public readonly runCalls: string[][] = [];

  public async json(): Promise<unknown> {
    throw new Error('Unexpected JSON command');
  }

  public async run(args: string[]): Promise<void> {
    this.runCalls.push([...args]);
  }
}

class CheckpointStateRunner implements AwsCliRunner {
  public readonly runCalls: string[][] = [];
  public secretVersionId = manifest.aws.secret.versionId;

  public async json(args: string[]): Promise<unknown> {
    const command = args.slice(0, 2).join(' ');
    switch (command) {
      case 'ecr describe-images':
        return { imageDetails: [{ imageDigest: manifest.aws.ecrImages.api.digest }] };
      case 'ecs describe-services':
        return {
          failures: [],
          services: [
            serviceState('api', manifest.aws.services.api),
            serviceState('worker', manifest.aws.services.worker),
          ],
        };
      case 'secretsmanager list-secret-version-ids':
        return {
          Versions: [{ VersionId: this.secretVersionId, VersionStages: ['AWSCURRENT'] }],
        };
      case 'application-autoscaling describe-scalable-targets':
        return {
          ScalableTargets: [
            {
              MinCapacity: manifest.aws.workerScaling.minCapacity,
              MaxCapacity: manifest.aws.workerScaling.maxCapacity,
              SuspendedState: {
                DynamicScalingInSuspended: false,
                DynamicScalingOutSuspended: false,
                ScheduledScalingSuspended: false,
              },
            },
          ],
        };
      case 'application-autoscaling describe-scheduled-actions':
        return {
          ScheduledActions: manifest.aws.workerScaling.scheduledActions.map((action) => ({
            ScheduledActionName: action.name,
            Schedule: action.schedule,
            ScalableTargetAction: {
              MinCapacity: action.minCapacity,
              MaxCapacity: action.maxCapacity,
            },
          })),
        };
      case 'application-autoscaling describe-scaling-policies':
        return {
          ScalingPolicies: manifest.aws.workerScaling.policies.map((policy) => ({
            PolicyName: policy.name,
            PolicyType: policy.policyType,
            StepScalingPolicyConfiguration: {
              AdjustmentType: policy.adjustmentType,
              Cooldown: policy.cooldown,
              MetricAggregationType: policy.metricAggregationType,
              StepAdjustments: policy.stepAdjustments.map((step) => ({
                ...(step.metricIntervalLowerBound === undefined
                  ? {}
                  : { MetricIntervalLowerBound: step.metricIntervalLowerBound }),
                ...(step.metricIntervalUpperBound === undefined
                  ? {}
                  : { MetricIntervalUpperBound: step.metricIntervalUpperBound }),
                ScalingAdjustment: step.scalingAdjustment,
              })),
            },
          })),
        };
      default:
        throw new Error(`Unexpected JSON command: ${command}`);
    }
  }

  public async run(args: string[]): Promise<void> {
    this.runCalls.push([...args]);
  }
}

function serviceState(
  kind: 'api' | 'worker',
  checkpoint: typeof manifest.aws.services.api,
): Record<string, unknown> {
  return {
    serviceName: checkpoint.serviceName,
    taskDefinition: `arn:aws:ecs:ap-northeast-1:452284481392:task-definition/${checkpoint.taskDefinition}`,
    desiredCount: checkpoint.desiredCount,
    runningCount: checkpoint.desiredCount,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [`subnet-${kind}`],
        securityGroups: [`sg-${kind}`],
        assignPublicIp: 'ENABLED',
      },
    },
  };
}

describe('AwsCliProductionRollbackCloud', () => {
  it('DB事前検査を短いtimeout付きの読み取り専用transactionに限定する', () => {
    const script = buildDatabasePreflightScript();

    expect(script).toContain('database.db.transaction');
    expect(script).toContain('SET TRANSACTION READ ONLY');
    expect(script).toContain("SET LOCAL statement_timeout = '15s'");
    expect(script).not.toContain('INSERT ');
    expect(script).not.toContain('UPDATE ');
    expect(script).not.toContain('DELETE ');
  });

  it('APIのtask definition切替時に基準desired countも同時に復元する', async () => {
    const runner = new RecordingRunner();
    const cloud = new AwsCliProductionRollbackCloud({ runner, manifest });

    await cloud.executeRollbackAction({
      kind: 'update-api-task-definition',
      taskDefinition: manifest.aws.services.api.taskDefinition,
      desiredCount: manifest.aws.services.api.desiredCount,
    });

    expect(runner.runCalls).toEqual([
      [
        'ecs',
        'update-service',
        '--cluster',
        manifest.aws.clusterName,
        '--service',
        manifest.aws.services.api.serviceName,
        '--task-definition',
        manifest.aws.services.api.taskDefinition,
        '--force-new-deployment',
        '--desired-count',
        String(manifest.aws.services.api.desiredCount),
      ],
    ]);
  });

  it('workerとAPIの停止操作を対象serviceのdesired count 0に限定する', async () => {
    const runner = new RecordingRunner();
    const cloud = new AwsCliProductionRollbackCloud({ runner, manifest });

    await cloud.executeRollbackAction({ kind: 'stop-worker', desiredCount: 0 });
    await cloud.executeRollbackAction({ kind: 'stop-api', desiredCount: 0 });

    expect(runner.runCalls.map((args) => [args[5], args[7]])).toEqual([
      [manifest.aws.services.worker.serviceName, '0'],
      [manifest.aws.services.api.serviceName, '0'],
    ]);
  });

  it('切替後のAWS実状態がmanifestと一致する場合に検証を通過する', async () => {
    const runner = new CheckpointStateRunner();
    const cloud = new AwsCliProductionRollbackCloud({ runner, manifest });

    await expect(
      cloud.executeRollbackAction({ kind: 'verify-checkpoint-runtime' }),
    ).resolves.toBeUndefined();

    runner.secretVersionId = '00000000-0000-4000-8000-000000000000';
    await expect(
      cloud.executeRollbackAction({ kind: 'verify-checkpoint-runtime' }),
    ).rejects.toThrow('Secret AWSCURRENT does not match the checkpoint version');
  });

  it('worker scalingを停止中に詳細設定し最後に基準状態へ戻す', async () => {
    const runner = new CheckpointStateRunner();
    const cloud = new AwsCliProductionRollbackCloud({ runner, manifest });

    await cloud.executeRollbackAction({
      kind: 'restore-checkpoint-worker-scaling',
      minCapacity: manifest.aws.workerScaling.minCapacity,
      maxCapacity: manifest.aws.workerScaling.maxCapacity,
      suspendedState: manifest.aws.workerScaling.suspendedState,
      policies: manifest.aws.workerScaling.policies,
    });

    const registerCalls = runner.runCalls.filter(
      (args) => args[0] === 'application-autoscaling' && args[1] === 'register-scalable-target',
    );
    expect(registerCalls).toHaveLength(2);
    expect(registerCalls[0]).toContain(
      'DynamicScalingInSuspended=true,DynamicScalingOutSuspended=true,ScheduledScalingSuspended=true',
    );
    expect(registerCalls[1]).toContain(
      'DynamicScalingInSuspended=false,DynamicScalingOutSuspended=false,ScheduledScalingSuspended=false',
    );

    const policyCalls = runner.runCalls.filter(
      (args) => args[0] === 'application-autoscaling' && args[1] === 'put-scaling-policy',
    );
    expect(policyCalls).toHaveLength(manifest.aws.workerScaling.policies.length);
    for (const [index, call] of policyCalls.entries()) {
      const configurationIndex = call.indexOf('--step-scaling-policy-configuration');
      const configuration = JSON.parse(call[configurationIndex + 1] ?? '') as {
        Cooldown: number;
        AdjustmentType: string;
      };
      expect(configuration.Cooldown).toBe(manifest.aws.workerScaling.policies[index]?.cooldown);
      expect(configuration.AdjustmentType).toBe(
        manifest.aws.workerScaling.policies[index]?.adjustmentType,
      );
    }
  });
});
