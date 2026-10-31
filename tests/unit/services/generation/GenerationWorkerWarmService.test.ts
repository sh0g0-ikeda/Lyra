import { describe, expect, it } from 'vitest';
import { getGenerationWorkerWarmFloor } from '../../../../src/domain/generation/GenerationWorkerWarmPolicy.js';

/* Design: Unified Spec 4/6/7/9. Pre-wake and durable enqueue request a shared
 * twenty-minute lease, without charging credits or creating a preview job.
 * One transactional controller owns the minimum floor, never desired/max count.
 * JST 13:00-01:00 stays warm; queued/processing work prevents scale-in.
 * AWS is mocked throughout. Production configuration remains unchanged.
 */
describe('generation worker warm policy', () => {
  it('日本時間13時から翌1時未満は最低1台になる', () => {
    expect(getGenerationWorkerWarmFloor(new Date('2026-10-31T04:00:00Z'), null, false)).toBe(1);
    expect(getGenerationWorkerWarmFloor(new Date('2026-10-31T15:59:59Z'), null, false)).toBe(1);
  });
  it('日本時間1時から13時未満に利用も処理もない場合は0台になる', () => {
    expect(getGenerationWorkerWarmFloor(new Date('2026-10-31T16:00:00Z'), null, false)).toBe(0);
    expect(getGenerationWorkerWarmFloor(new Date('2026-10-31T03:59:59Z'), null, false)).toBe(0);
  });
  it('常駐時間外でも期限内の予熱または処理中ジョブがあれば最低1台になる', () => {
    const now = new Date('2026-10-31T18:00:00Z');
    expect(getGenerationWorkerWarmFloor(now, new Date('2026-10-31T18:20:00Z'), false)).toBe(1);
    expect(getGenerationWorkerWarmFloor(now, null, true)).toBe(1);
    expect(getGenerationWorkerWarmFloor(now, now, false)).toBe(0);
  });
});

import { GenerationWorkerWarmService, type GenerationWorkerFloorPort, type GenerationWorkerWarmRepository, type LockedWorkerWarmState } from '../../../../src/services/generation/GenerationWorkerWarmService.js';

class MemoryWarmRepository implements GenerationWorkerWarmRepository {
  public leaseUntil: Date | null = null;
  public appliedFloor: 0 | 1 | null = null;
  public active = false;
  public now = new Date('2026-10-31T18:00:00Z');
  private tail: Promise<void> = Promise.resolve();
  public async withLock<T>(_resource: string, work: (state: LockedWorkerWarmState) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      const locked: LockedWorkerWarmState = {
        now: this.now,
        leaseUntil: this.leaseUntil,
        lastAppliedFloor: this.appliedFloor,
        hasActiveJobs: async () => this.active,
        extendLease: async (seconds: number) => {
          this.leaseUntil = new Date(Math.max(this.leaseUntil?.getTime() ?? 0, this.now.getTime() + seconds * 1000));
          locked.leaseUntil = this.leaseUntil;
        },
        recordAppliedFloor: async (floor: 0 | 1) => { this.appliedFloor = floor; },
      };
      return await work(locked);
    } finally { unlock(); }
  }
}
class MemoryFloor implements GenerationWorkerFloorPort {
  public calls: Array<0 | 1> = [];
  public error = false;
  public async applyFloor(_resource: string, floor: 0 | 1, _previous: 0 | 1 | null): Promise<void> {
    this.calls.push(floor);
    if (this.error) throw new Error('simulated failure');
  }
}

describe('GenerationWorkerWarmService', () => {
  it('起動要求を共有20分leaseへまとめて最大台数や現在台数を操作しない', async () => {
    const repository = new MemoryWarmRepository();
    const floor = new MemoryFloor();
    const service = new GenerationWorkerWarmService(repository, floor, 'service/test/worker', () => undefined);
    await Promise.all([service.requestWarm(), service.requestWarm()]);
    expect(repository.leaseUntil?.toISOString()).toBe('2026-10-31T18:20:00.000Z');
    expect(floor.calls.every((value) => value === 1)).toBe(true);
  });
  it('期限前は停止せず期限後に仕事がなければ最低台数を0にする', async () => {
    const repository = new MemoryWarmRepository();
    const floor = new MemoryFloor();
    const service = new GenerationWorkerWarmService(repository, floor, 'service/test/worker', () => undefined);
    await service.requestWarm();
    repository.now = new Date('2026-10-31T18:19:59Z');
    await service.reconcile();
    expect(floor.calls).not.toContain(0);
    repository.now = new Date('2026-10-31T18:20:00Z');
    await service.reconcile();
    expect(floor.calls.at(-1)).toBe(0);
  });
  it('キュー表示が空でもqueuedやprocessingがあればleaseを延長する', async () => {
    const repository = new MemoryWarmRepository();
    repository.active = true;
    const floor = new MemoryFloor();
    const service = new GenerationWorkerWarmService(repository, floor, 'service/test/worker', () => undefined);
    await service.reconcile();
    expect(floor.calls).toEqual([1]);
    expect(repository.leaseUntil?.toISOString()).toBe('2026-10-31T18:20:00.000Z');
  });
  it('AWS起動失敗でもleaseを残して次の照合で再試行できる', async () => {
    const repository = new MemoryWarmRepository();
    const floor = new MemoryFloor();
    floor.error = true;
    const service = new GenerationWorkerWarmService(repository, floor, 'service/test/worker', () => undefined);
    await service.requestWarm();
    expect(repository.leaseUntil).not.toBeNull();
    expect(repository.appliedFloor).toBeNull();
    floor.error = false;
    await service.reconcile();
    expect(repository.appliedFloor).toBe(1);
  });
  it('停止照合と新規起動要求が競合しても最後は起動状態になる', async () => {
    const repository = new MemoryWarmRepository();
    repository.appliedFloor = 1;
    const floor = new MemoryFloor();
    const service = new GenerationWorkerWarmService(repository, floor, 'service/test/worker', () => undefined);
    await Promise.all([service.reconcile(), service.requestWarm()]);
    expect(repository.appliedFloor).toBe(1);
    expect(floor.calls).toEqual([0, 1]);
  });
});

import { DescribeScalableTargetsCommand, RegisterScalableTargetCommand } from '@aws-sdk/client-application-auto-scaling';
import { AwsGenerationWorkerFloor, type WorkerScalingClient } from '../../../../src/infrastructure/aws/AwsGenerationWorkerFloor.js';

describe('generation worker scaling ownership handoff', () => {
  it('schedule停止済みの既存1台を引き継ぎdriftを即修復し期限後に0へ戻す', async () => {
    let actualMinimum = 1;
    const writes: number[] = [];
    const client: WorkerScalingClient = { send: async (command) => {
      if (command instanceof DescribeScalableTargetsCommand) return {
        ScalableTargets: [{ ResourceId: 'service/test/worker', MinCapacity: actualMinimum, MaxCapacity: 5, SuspendedState: { ScheduledScalingSuspended: true } }],
      };
      if (command instanceof RegisterScalableTargetCommand) {
        actualMinimum = command.input.MinCapacity ?? actualMinimum;
        writes.push(actualMinimum);
      }
      return {};
    } };
    const repository = new MemoryWarmRepository();
    const service = new GenerationWorkerWarmService(repository, new AwsGenerationWorkerFloor(client), 'service/test/worker');
    await service.requestWarm();
    expect(repository.appliedFloor).toBe(1);
    expect(writes).toEqual([]);
    actualMinimum = 0;
    await service.requestWarm();
    expect(actualMinimum).toBe(1);
    repository.now = new Date('2026-10-31T18:20:00Z');
    await service.reconcile();
    expect(writes).toEqual([1, 0]);
  });
});
