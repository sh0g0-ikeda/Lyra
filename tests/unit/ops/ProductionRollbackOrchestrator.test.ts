import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ProductionSnapshot,
  RecoveryAction,
  RollbackAction,
  RollbackManifest,
  RollbackObservation,
  RollbackReceipt,
} from '../../../src/ops/ProductionRollback.js';
import {
  runProductionRollback,
  type ProductionRollbackCloudPort,
  type RollbackReceiptStore,
} from '../../../src/ops/ProductionRollbackOrchestrator.js';
import { parseRollbackManifest } from '../../../src/ops/ProductionRollback.js';

const manifest: RollbackManifest = parseRollbackManifest(
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'ops', 'rollback', 'checkpoints', '2026-07-14T1500-jst.json'),
      'utf8',
    ),
  ) as unknown,
);

function observation(): RollbackObservation {
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
        cpuArchitecture: manifest.aws.services.api.cpuArchitecture,
      },
      worker: {
        status: 'ACTIVE',
        containerName: manifest.aws.services.worker.containerName,
        imageUri: manifest.aws.services.worker.imageUri,
        cpuArchitecture: manifest.aws.services.worker.cpuArchitecture,
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
  };
}

function snapshot(): ProductionSnapshot {
  return {
    capturedAt: '2026-07-16T00:00:00.000Z',
    apiTaskDefinition: 'lyra-prod-api:79',
    workerTaskDefinition: 'lyra-prod-worker:52',
    apiDesiredCount: 1,
    workerDesiredCount: 0,
    secretCurrentVersionId: 'c5c3da8a-c006-49d9-93f4-91a47d34cb00',
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

class FakeCloud implements ProductionRollbackCloudPort {
  public readonly events: string[] = [];
  public failRollbackAt: RollbackAction['kind'] | null = null;
  public observation: RollbackObservation = observation();

  public async collectObservation(): Promise<RollbackObservation> {
    this.events.push('observe');
    return this.observation;
  }

  public async captureSnapshot(): Promise<ProductionSnapshot> {
    this.events.push('snapshot');
    return snapshot();
  }

  public async executeRollbackAction(action: RollbackAction): Promise<void> {
    this.events.push(`apply:${action.kind}`);
    if (action.kind === this.failRollbackAt) {
      throw new Error('simulated apply failure');
    }
  }

  public async executeRecoveryAction(action: RecoveryAction): Promise<void> {
    this.events.push(`recover:${action.kind}`);
  }
}

class FakeReceiptStore implements RollbackReceiptStore {
  public readonly receipts: RollbackReceipt[] = [];
  public readonly events: string[];

  public constructor(events: string[]) {
    this.events = events;
  }

  public async save(receipt: RollbackReceipt): Promise<string> {
    this.events.push('receipt');
    this.receipts.push(receipt);
    return '.rollback-receipts/test.json';
  }
}

describe('ProductionRollbackOrchestrator', () => {
  it('dry-runの場合にAWS変更とreceipt保存を行わない', async () => {
    const cloud = new FakeCloud();
    const receipts = new FakeReceiptStore(cloud.events);

    const result = await runProductionRollback({
      manifest,
      options: { apply: false },
      cloud,
      receiptStore: receipts,
    });

    expect(result.mode).toBe('dry-run');
    expect(cloud.events).toEqual(['observe']);
    expect(receipts.receipts).toHaveLength(0);
  });

  it('前提条件違反の場合にsnapshot取得前に停止する', async () => {
    const cloud = new FakeCloud();
    cloud.observation = {
      ...observation(),
      queue: { visibleMessages: 1, inFlightMessages: 0, delayedMessages: 0 },
    };
    const receipts = new FakeReceiptStore(cloud.events);

    await expect(
      runProductionRollback({
        manifest,
        options: { apply: true, confirmation: manifest.confirmationToken },
        cloud,
        receiptStore: receipts,
      }),
    ).rejects.toThrow('Generation queue must be empty before rollback');
    expect(cloud.events).toEqual(['observe']);
  });

  it('applyの場合にreceiptを最初の変更より前に保存する', async () => {
    const cloud = new FakeCloud();
    const receipts = new FakeReceiptStore(cloud.events);

    const result = await runProductionRollback({
      manifest,
      options: { apply: true, confirmation: manifest.confirmationToken },
      cloud,
      receiptStore: receipts,
    });

    expect(result.mode).toBe('applied');
    expect(cloud.events.slice(0, 4)).toEqual([
      'observe',
      'snapshot',
      'receipt',
      'apply:quiesce-worker-scaling',
    ]);
  });

  it('切替途中で失敗した場合に全復旧操作を実行する', async () => {
    const cloud = new FakeCloud();
    cloud.failRollbackAt = 'update-api-task-definition';
    const receipts = new FakeReceiptStore(cloud.events);

    await expect(
      runProductionRollback({
        manifest,
        options: { apply: true, confirmation: manifest.confirmationToken },
        cloud,
        receiptStore: receipts,
      }),
    ).rejects.toThrow('Rollback failed and the previous production state was restored');

    expect(cloud.events.filter((event) => event.startsWith('recover:'))).toEqual([
      'recover:quiesce-worker-scaling',
      'recover:stop-worker',
      'recover:stop-api',
      'recover:restore-previous-secret',
      'recover:restore-previous-worker-task-definition',
      'recover:restore-previous-api-task-definition',
      'recover:restore-previous-desired-counts',
      'recover:wait-api-stable',
      'recover:wait-worker-stable',
      'recover:restore-previous-worker-scaling',
      'recover:invalidate-cloudfront',
      'recover:verify-public-health',
    ]);
  });
});
