import { GENERATION_WORKER_WARM_IDLE_SECONDS, getGenerationWorkerWarmFloor } from '../../domain/generation/GenerationWorkerWarmPolicy.js';

export interface LockedWorkerWarmState {
  now: Date;
  leaseUntil: Date | null;
  lastAppliedFloor: 0 | 1 | null;
  hasActiveJobs(): Promise<boolean>;
  extendLease(seconds: number): Promise<void>;
  recordAppliedFloor(floor: 0 | 1): Promise<void>;
}
export interface GenerationWorkerWarmRepository {
  withLock<T>(resourceId: string, work: (state: LockedWorkerWarmState) => Promise<T>): Promise<T>;
}
export interface GenerationWorkerFloorPort {
  applyFloor(resourceId: string, floor: 0 | 1, previousFloor: 0 | 1 | null): Promise<void>;
}
export interface GenerationWorkerWarmPort {
  requestWarm(): Promise<void>;
}

/** A transaction serializes replicas, expiry and wake requests. Only minimum
 * capacity changes; desired/max capacity remain under existing AWS policies. */
export class GenerationWorkerWarmService implements GenerationWorkerWarmPort {
  public constructor(
    private readonly repository: GenerationWorkerWarmRepository,
    private readonly floor: GenerationWorkerFloorPort,
    private readonly resourceId: string,
    private readonly reportFailure: () => void = () => console.warn('[generation-worker-warm] capacity update failed; durable queue fallback remains active'),
  ) {}

  public async requestWarm(): Promise<void> {
    await this.repository.withLock(this.resourceId, async (state) => {
      await state.extendLease(GENERATION_WORKER_WARM_IDLE_SECONDS);
      await this.apply(state, 1, true);
    });
  }

  public async reconcile(): Promise<void> {
    await this.repository.withLock(this.resourceId, async (state) => {
      const active = await state.hasActiveJobs();
      if (active) await state.extendLease(GENERATION_WORKER_WARM_IDLE_SECONDS);
      const floor = getGenerationWorkerWarmFloor(state.now, state.leaseUntil, active);
      await this.apply(state, floor, true);
    });
  }

  private async apply(state: LockedWorkerWarmState, floor: 0 | 1, verify = false): Promise<void> {
    if (!verify && state.lastAppliedFloor === floor) return;
    try {
      await this.floor.applyFloor(this.resourceId, floor, state.lastAppliedFloor);
      await state.recordAppliedFloor(floor);
    } catch {
      // Keep the committed lease on failure. A subsequent reconcile retries;
      // waking must never turn an accepted job into a refund or lose its queue.
      this.reportFailure();
    }
  }
}
