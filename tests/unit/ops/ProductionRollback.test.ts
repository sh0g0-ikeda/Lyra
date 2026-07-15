import { describe, expect, it } from 'vitest';
import {
  assertRollbackAuthorization,
  buildRecoveryActions,
  buildRollbackActions,
  createRollbackReceipt,
  evaluateCheckpointRuntime,
  evaluateRollbackPreconditions,
  parseRollbackManifest,
  type CheckpointRuntimeObservation,
  type ProductionSnapshot,
  type RollbackManifest,
  type RollbackObservation,
} from '../../../src/ops/ProductionRollback.js';

const manifest = parseRollbackManifest({
  schemaVersion: 1,
  checkpointId: '20260714T1500JST',
  confirmationToken: '20260714T1500JST',
  capturedAt: '2026-07-14T15:00:00+09:00',
  git: {
    commit: 'bfea1329f151d76a335d8bbbc59c624c54b7f4e3',
  },
  aws: {
    accountId: '452284481392',
    region: 'ap-northeast-1',
    clusterName: 'lyra-prod',
    services: {
      api: {
        serviceName: 'lyra-prod-api',
        taskDefinition: 'lyra-prod-api:75',
        containerName: 'api',
        desiredCount: 1,
        imageUri:
          '452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api:continuity-v3-bfea132-20260714',
      },
      worker: {
        serviceName: 'lyra-prod-worker',
        taskDefinition: 'lyra-prod-worker:48',
        containerName: 'worker',
        desiredCount: 1,
        imageUri:
          '452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-worker:continuity-v3-bfea132-20260714',
      },
    },
    ecrImages: {
      api: {
        repositoryName: 'lyra-prod-api',
        releaseTag: 'continuity-v3-bfea132-20260714',
        checkpointTag: 'checkpoint-20260714-1500-jst',
        digest: 'sha256:7b0562f727e0eeca712a255dc08d15f94c2f8e5ef2d996e321517b98f210ac19',
      },
      worker: {
        repositoryName: 'lyra-prod-worker',
        releaseTag: 'continuity-v3-bfea132-20260714',
        checkpointTag: 'checkpoint-20260714-1500-jst',
        digest: 'sha256:7b0562f727e0eeca712a255dc08d15f94c2f8e5ef2d996e321517b98f210ac19',
      },
    },
    secret: {
      secretId: 'lyra/prod/app',
      versionId: '6982a44b-0425-406a-8704-f0b73f9dfefb',
      checkpointStage: 'LYRA_CHECKPOINT_20260714_1500_JST',
    },
    queue: {
      name: 'lyra-prod-generation',
    },
    cloudFront: {
      distributionId: 'E3B8V7G1NPTTMS',
      healthUrl: 'https://app.lyra-editor.com/healthz',
      readinessUrl: 'https://app.lyra-editor.com/readyz',
    },
    workerScaling: {
      serviceNamespace: 'ecs',
      scalableDimension: 'ecs:service:DesiredCount',
      resourceId: 'service/lyra-prod/lyra-prod-worker',
      minCapacity: 1,
      maxCapacity: 3,
      suspendedState: {
        dynamicScalingInSuspended: false,
        dynamicScalingOutSuspended: false,
        scheduledScalingSuspended: false,
      },
      policies: [
        {
          name: 'lyra-worker-scale-out-on-queue',
          policyType: 'StepScaling',
          adjustmentType: 'ChangeInCapacity',
          cooldown: 60,
          metricAggregationType: 'Average',
          stepAdjustments: [
            {
              metricIntervalLowerBound: 0,
              scalingAdjustment: 1,
            },
          ],
        },
        {
          name: 'lyra-worker-scale-in-when-empty',
          policyType: 'StepScaling',
          adjustmentType: 'ExactCapacity',
          cooldown: 300,
          metricAggregationType: 'Average',
          stepAdjustments: [
            {
              metricIntervalUpperBound: 0,
              scalingAdjustment: 0,
            },
          ],
        },
      ],
      scheduledActions: [
        {
          name: 'lyra-worker-jst-0900-min1',
          schedule: 'cron(0 0 * * ? *)',
          minCapacity: 1,
          maxCapacity: 3,
        },
        {
          name: 'lyra-worker-jst-midnight-min0',
          schedule: 'cron(0 15 * * ? *)',
          minCapacity: 0,
          maxCapacity: 3,
        },
      ],
    },
  },
  database: {
    checkpointMigrations: ['001_initial_schema.sql', '023_merge_creator_role_into_editor.sql'],
    allowedForwardCompatibleMigrations: [
      '024_add_generation_job_cancellation.sql',
      '025_include_cancelled_jobs_in_retention_index.sql',
    ],
  },
});

function validObservation(overrides: Partial<RollbackObservation> = {}): RollbackObservation {
  return {
    accountId: manifest.aws.accountId,
    region: manifest.aws.region,
    ecrDigests: {
      api: {
        checkpoint: manifest.aws.ecrImages.api.digest,
        release: manifest.aws.ecrImages.api.digest,
      },
      worker: {
        checkpoint: manifest.aws.ecrImages.worker.digest,
        release: manifest.aws.ecrImages.worker.digest,
      },
    },
    taskDefinitions: {
      api: {
        status: 'ACTIVE',
        containerName: manifest.aws.services.api.containerName,
        imageUri: manifest.aws.services.api.imageUri,
        cpuArchitecture: 'ARM64',
      },
      worker: {
        status: 'ACTIVE',
        containerName: manifest.aws.services.worker.containerName,
        imageUri: manifest.aws.services.worker.imageUri,
        cpuArchitecture: 'ARM64',
      },
    },
    checkpointSecretVersionId: manifest.aws.secret.versionId,
    queue: {
      visibleMessages: 0,
      inFlightMessages: 0,
      delayedMessages: 0,
    },
    appliedMigrations: [
      ...manifest.database.checkpointMigrations,
      ...manifest.database.allowedForwardCompatibleMigrations,
    ],
    activeGenerationJobs: 0,
    ...overrides,
  };
}

function productionSnapshot(): ProductionSnapshot {
  return {
    capturedAt: '2026-07-16T12:00:00.000Z',
    apiTaskDefinition: 'lyra-prod-api:79',
    workerTaskDefinition: 'lyra-prod-worker:52',
    apiDesiredCount: 1,
    workerDesiredCount: 0,
    secretCurrentVersionId: 'current-version-id',
    workerScaling: {
      minCapacity: 0,
      maxCapacity: 3,
      suspendedState: {
        dynamicScalingInSuspended: false,
        dynamicScalingOutSuspended: false,
        scheduledScalingSuspended: false,
      },
      scheduledActions: manifest.aws.workerScaling.scheduledActions,
      policies: manifest.aws.workerScaling.policies,
    },
  };
}

function checkpointRuntimeObservation(): CheckpointRuntimeObservation {
  return {
    ecrDigests: {
      api: {
        checkpoint: manifest.aws.ecrImages.api.digest,
        release: manifest.aws.ecrImages.api.digest,
      },
      worker: {
        checkpoint: manifest.aws.ecrImages.worker.digest,
        release: manifest.aws.ecrImages.worker.digest,
      },
    },
    api: {
      taskDefinition: manifest.aws.services.api.taskDefinition,
      desiredCount: manifest.aws.services.api.desiredCount,
      runningCount: manifest.aws.services.api.desiredCount,
    },
    worker: {
      taskDefinition: manifest.aws.services.worker.taskDefinition,
      desiredCount: manifest.aws.services.worker.desiredCount,
      runningCount: manifest.aws.services.worker.desiredCount,
    },
    secretCurrentVersionId: manifest.aws.secret.versionId,
    workerScaling: {
      minCapacity: manifest.aws.workerScaling.minCapacity,
      maxCapacity: manifest.aws.workerScaling.maxCapacity,
      suspendedState: manifest.aws.workerScaling.suspendedState,
      scheduledActions: manifest.aws.workerScaling.scheduledActions,
      policies: manifest.aws.workerScaling.policies,
    },
  };
}

describe('ProductionRollback', () => {
  it('正しい観測結果の場合にロールバック前提条件を満たす', () => {
    expect(evaluateRollbackPreconditions(manifest, validObservation())).toEqual([]);
  });

  it('AWSアカウントまたはイメージdigestが異なる場合に拒否する', () => {
    const errors = evaluateRollbackPreconditions(
      manifest,
      validObservation({
        accountId: '000000000000',
        ecrDigests: {
          api: {
            checkpoint: 'sha256:wrong',
            release: manifest.aws.ecrImages.api.digest,
          },
          worker: {
            checkpoint: manifest.aws.ecrImages.worker.digest,
            release: manifest.aws.ecrImages.worker.digest,
          },
        },
      }),
    );

    expect(errors).toContain('AWS account does not match the checkpoint manifest');
    expect(errors).toContain('API checkpoint image digest does not match');
  });

  it('ECSが実際に参照するrelease tagのdigestが異なる場合に拒否する', () => {
    const errors = evaluateRollbackPreconditions(
      manifest,
      validObservation({
        ecrDigests: {
          api: {
            checkpoint: manifest.aws.ecrImages.api.digest,
            release: 'sha256:wrong',
          },
          worker: {
            checkpoint: manifest.aws.ecrImages.worker.digest,
            release: manifest.aws.ecrImages.worker.digest,
          },
        },
      }),
    );

    expect(errors).toContain('API release image digest does not match');
  });

  it('生成キューに処理対象が残る場合に拒否する', () => {
    const errors = evaluateRollbackPreconditions(
      manifest,
      validObservation({
        queue: {
          visibleMessages: 1,
          inFlightMessages: 2,
          delayedMessages: 0,
        },
      }),
    );

    expect(errors).toContain('Generation queue must be empty before rollback');
  });

  it('未承認の将来migrationが存在する場合に拒否する', () => {
    const errors = evaluateRollbackPreconditions(
      manifest,
      validObservation({
        appliedMigrations: [
          ...manifest.database.checkpointMigrations,
          ...manifest.database.allowedForwardCompatibleMigrations,
          '026_destructive_contract_change.sql',
        ],
      }),
    );

    expect(errors).toContain('Unsupported database migration: 026_destructive_contract_change.sql');
  });

  it('DBに処理中の生成ジョブが残る場合に拒否する', () => {
    const errors = evaluateRollbackPreconditions(
      manifest,
      validObservation({ activeGenerationJobs: 1 }),
    );

    expect(errors).toContain('Active generation jobs must be zero before rollback');
  });

  it('本番適用時に完全一致する確認文字列がない場合に拒否する', () => {
    expect(() =>
      assertRollbackAuthorization(manifest, {
        apply: true,
        confirmation: 'wrong',
      }),
    ).toThrow('Rollback confirmation token does not match');

    expect(() =>
      assertRollbackAuthorization(manifest, {
        apply: false,
      }),
    ).not.toThrow();
  });

  it('ロールバック操作をworker停止からhealth確認まで安全な順序で作る', () => {
    const actions = buildRollbackActions(manifest);
    expect(actions.map((action) => action.kind)).toEqual([
      'quiesce-worker-scaling',
      'stop-worker',
      'wait-worker-stopped',
      'stop-api',
      'wait-api-stopped',
      'verify-generation-quiescence',
      'activate-checkpoint-secret',
      'update-worker-task-definition',
      'update-api-task-definition',
      'wait-api-stable',
      'invalidate-cloudfront',
      'restore-checkpoint-worker-scaling',
      'start-checkpoint-worker',
      'wait-worker-stable',
      'verify-checkpoint-runtime',
      'verify-public-health',
    ]);
    expect(actions).toContainEqual({
      kind: 'update-api-task-definition',
      taskDefinition: manifest.aws.services.api.taskDefinition,
      desiredCount: manifest.aws.services.api.desiredCount,
    });
    expect(actions).toContainEqual(
      expect.objectContaining({
        kind: 'restore-checkpoint-worker-scaling',
        policies: manifest.aws.workerScaling.policies,
      }),
    );
  });

  it('切替後のAPI、Secret、worker設定が基準と一致する場合に完了と判定する', () => {
    expect(evaluateCheckpointRuntime(manifest, checkpointRuntimeObservation())).toEqual([]);
  });

  it('切替後にworkerが許容範囲内で自動スケールした場合に失敗扱いしない', () => {
    const observation = checkpointRuntimeObservation();
    observation.worker.desiredCount = 2;
    observation.worker.runningCount = 2;

    expect(evaluateCheckpointRuntime(manifest, observation)).toEqual([]);
  });

  it('切替後のtask definition、Secret、scaling policyが異なる場合に拒否する', () => {
    const observation = checkpointRuntimeObservation();
    observation.ecrDigests.worker.release = 'sha256:unexpected';
    observation.api.taskDefinition = 'lyra-prod-api:999';
    observation.secretCurrentVersionId = 'unexpected-secret-version';
    observation.workerScaling.policies = [];

    expect(evaluateCheckpointRuntime(manifest, observation)).toEqual([
      'Worker release image digest does not match',
      'API task definition does not match the checkpoint',
      'Secret AWSCURRENT does not match the checkpoint version',
      'Worker scaling policies do not match the checkpoint',
    ]);
  });

  it('復旧操作をSecretとtask definitionを切替前へ戻す順序で作る', () => {
    expect(buildRecoveryActions(manifest, productionSnapshot()).map((action) => action.kind)).toEqual([
      'quiesce-worker-scaling',
      'stop-worker',
      'stop-api',
      'restore-previous-secret',
      'restore-previous-worker-task-definition',
      'restore-previous-api-task-definition',
      'restore-previous-desired-counts',
      'wait-api-stable',
      'wait-worker-stable',
      'restore-previous-worker-scaling',
      'invalidate-cloudfront',
      'verify-public-health',
    ]);
  });

  it('receiptにSecret値や未知の入力項目を保存しない', () => {
    const snapshotWithSecretValue: ProductionSnapshot & { secretValue: string } = {
      ...productionSnapshot(),
      secretValue: 'must-not-be-persisted',
    };
    const receipt = createRollbackReceipt(manifest, snapshotWithSecretValue);
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toContain('must-not-be-persisted');
    expect(receipt.previous.secretCurrentVersionId).toBe('current-version-id');
  });

  it('manifestのaccount IDやURLが不正な場合に読み込みを拒否する', () => {
    const invalidManifest: unknown = {
      ...manifest,
      aws: {
        ...manifest.aws,
        accountId: 'not-an-account',
        cloudFront: {
          ...manifest.aws.cloudFront,
          healthUrl: 'http://not-secure.example.test/healthz',
        },
      },
    } satisfies RollbackManifest;

    expect(() => parseRollbackManifest(invalidManifest)).toThrow();
  });
});
